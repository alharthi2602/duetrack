import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
let db: PGlite;
const alice = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  bob = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  type = "11111111-1111-4111-a111-111111111111",
  id = "22222222-2222-4222-a222-222222222222";
const payment = {
  typeId: type,
  amount: 100,
  currency: "AED",
  due: "2026-10-01",
  invoice: "",
  reference: "",
  description: "",
  paid: false,
  paymentDate: "",
  recurrence: "none",
};
async function user(id: string) {
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`,
  );
}
async function change(
  record: string,
  kind: string,
  data: any,
  base: number,
  deleted = false,
  mutation = crypto.randomUUID(),
) {
  const result = await db.query<{ result: any }>(
    "select public.apply_change($1,$2,$3::jsonb,$4,$5,$6) as result",
    [record, kind, JSON.stringify(data), deleted, base, mutation],
  );
  return result.rows[0].result;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;grant usage on schema auth,storage to authenticated;grant select,insert on storage.objects to authenticated;insert into auth.users values('${alice}'),('${bob}');`,
  );
  const migration = readFileSync(
    "supabase/migrations/001_duetrack.sql",
    "utf8",
  ).replace(
    "alter publication supabase_realtime add table public.records;",
    "",
  );
  await db.exec(migration);
}, 30000);
afterAll(async () => await db.close());
describe.sequential("PostgreSQL migration and authorization", () => {
  it("accepts names containing spaces and digits for creation and renaming", async () => {
    await user(alice);
    const record = crypto.randomUUID();
    let version = 0;
    for (const name of [
      "Bin Ghatti 3",
      "BinGhatti3",
      "test",
      "test123",
      "Bin Ghatti 3",
    ]) {
      const result = await change(record, "type", { name, order: 9 }, version);
      expect(result.row.data.name).toBe(name);
      version = result.row.version;
    }
  });

  it("creates owner-scoped types and payments", async () => {
    await user(alice);
    expect(
      (await change(type, "type", { name: "Mortgage", order: 0 }, 0)).row
        .version,
    ).toBe(1);
    expect((await change(id, "payment", payment, 0)).row.owner).toBe(alice);
  });
  it("proves another account cannot read or modify records", async () => {
    await user(bob);
    expect((await db.query("select * from records")).rows).toHaveLength(0);
    await expect(change(id, "payment", payment, 1)).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      change(crypto.randomUUID(), "payment", payment, 0),
    ).rejects.toThrow("Payment type unavailable");
  });
  it("blocks direct writes that bypass version checks", async () => {
    await user(alice);
    await expect(
      db.exec(`update records set deleted=true where id='${id}'`),
    ).rejects.toThrow("permission denied");
  });
  it("detects conflicts and deduplicates repeated mutations", async () => {
    await user(alice);
    const mutation = crypto.randomUUID();
    const first = await change(
      id,
      "payment",
      { ...payment, amount: 200 },
      1,
      false,
      mutation,
    );
    expect(first.row.version).toBe(2);
    expect(
      await change(
        id,
        "payment",
        { ...payment, amount: 200 },
        1,
        false,
        mutation,
      ),
    ).toEqual(first);
    const stale = await change(id, "payment", { ...payment, amount: 300 }, 1);
    expect(stale.conflict).toBe(true);
    expect(stale.row.data.amount).toBe(200);
  });
  it("rejects missing validation fields and fractional amounts", async () => {
    await user(alice);
    await expect(change(crypto.randomUUID(), "payment", {}, 0)).rejects.toThrow(
      "fields required",
    );
    await expect(
      change(crypto.randomUUID(), "payment", { ...payment, amount: 1.5 }, 0),
    ).rejects.toThrow("Invalid amount");
  });
  it("requires paid dates and supports paid/unpaid changes", async () => {
    await user(alice);
    await expect(
      change(id, "payment", { ...payment, paid: true }, 2),
    ).rejects.toThrow("Payment date required");
    expect(
      (
        await change(
          id,
          "payment",
          { ...payment, paid: true, paymentDate: "2026-10-02" },
          2,
        )
      ).row.data.paid,
    ).toBe(true);
    expect((await change(id, "payment", payment, 3)).row.data.paid).toBe(false);
  });
  it("enforces private file ownership", async () => {
    await user(alice);
    await db.exec(
      `insert into storage.objects(bucket_id,name) values('receipts','${alice}/33333333-3333-4333-a333-333333333333')`,
    );
    await user(bob);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await expect(
      db.exec(
        `insert into storage.objects(bucket_id,name) values('receipts','${alice}/44444444-4444-4444-a444-444444444444')`,
      ),
    ).rejects.toThrow("row-level security");
    await user(alice);
    await expect(
      db.exec(`delete from storage.objects where bucket_id='receipts'`),
    ).rejects.toThrow("permission denied");
  });
  it("keeps old receipt if replacement metadata save fails and queues cleanup after removal", async () => {
    await user(alice);
    const attachment = {
      id: "33333333-3333-4333-a333-333333333333",
      name: "receipt.pdf",
      mime: "application/pdf",
      size: 10,
    };
    expect(
      (await change(id, "payment", { ...payment, attachment }, 4)).row.data
        .attachment.id,
    ).toBe(attachment.id);
    await expect(
      change(
        id,
        "payment",
        {
          ...payment,
          attachment: {
            ...attachment,
            id: "55555555-5555-4555-a555-555555555555",
          },
        },
        5,
      ),
    ).rejects.toThrow("Upload receipt before saving");
    expect(
      (await db.query<any>("select data from records where id=$1", [id]))
        .rows[0].data.attachment.id,
    ).toBe(attachment.id);
    await change(id, "payment", payment, 5);
    await db.exec("reset role");
    expect((await db.query("select * from receipt_gc")).rows).toHaveLength(1);
  });
  it("prevents deleting a type containing records; persists tombstones and rejects stale resurrection", async () => {
    await user(alice);
    await expect(
      change(type, "type", { name: "Mortgage", order: 0 }, 1, true),
    ).rejects.toThrow("Delete or move");
    expect((await change(id, "payment", payment, 6, true)).row.deleted).toBe(
      true,
    );
    const stale = await change(id, "payment", payment, 6);
    expect(stale.conflict).toBe(true);
    expect(stale.row.deleted).toBe(true);
    expect(
      (await change(type, "type", { name: "Mortgage", order: 0 }, 1, true)).row
        .deleted,
    ).toBe(true);
  });
});
