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
  await db.exec(
    readFileSync("supabase/migrations/002_cash_and_income.sql", "utf8"),
  );
  await db.exec(readFileSync("supabase/migrations/003_cash_attachments.sql", "utf8"));
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

describe.sequential("Cash backend protection", () => {
  const cash = crypto.randomUUID(),
    entryId = crypto.randomUUID();
  const data = {
    name: "Savings",
    currency: "AED",
    openingDate: "2026-10-01",
    openingBalance: 100000000,
  };
  const entry = {
    accountId: cash,
    currency: "AED",
    direction: "in",
    amount: 20000,
    date: "2026-10-03",
    category: "savings_profit",
    description: "Interest",
  };
  it("advertises capabilities and keeps legacy writes private", async () => {
    await user(alice);
    expect(
      (await db.query<any>("select duetrack_capabilities() as c")).rows[0].c
        .cash,
    ).toBe(true);
    await expect(
      db.query(
        "select apply_change_v1($1,'cash_account',$2::jsonb,false,0,$3)",
        [cash, JSON.stringify(data), crypto.randomUUID()],
      ),
    ).rejects.toThrow("permission denied");
  });
  it("creates owned accounts and entries with mutation idempotency", async () => {
    await user(alice);
    await change(cash, "cash_account", data, 0);
    const mutation = crypto.randomUUID();
    const first = await change(
      entryId,
      "cash_entry",
      entry,
      0,
      false,
      mutation,
    );
    expect(first.row.owner).toBe(alice);
    expect(
      await change(entryId, "cash_entry", entry, 0, false, mutation),
    ).toEqual(first);
  });
  it("isolates account links across users", async () => {
    await user(bob);
    await expect(
      change(crypto.randomUUID(), "cash_entry", entry, 0),
    ).rejects.toThrow("account unavailable");
    await expect(change(cash, "cash_account", data, 1)).rejects.toThrow(
      "Not authorized",
    );
    expect(
      (await db.query("select * from records where kind='cash_account'")).rows,
    ).toHaveLength(0);
  });
  it("rejects invalid currencies, dates, amounts and opening changes", async () => {
    await user(alice);
    for (const update of [
      { currency: "USD" },
      { date: "2026-09-30" },
      { amount: 0 },
      { amount: 1.5 },
      { category: "invalid" },
    ])
      await expect(
        change(crypto.randomUUID(), "cash_entry", { ...entry, ...update }, 0),
      ).rejects.toThrow();
    await expect(
      change(cash, "cash_account", { ...data, openingBalance: 200 }, 1),
    ).rejects.toThrow("Opening balance is fixed");
    await expect(change(cash, "cash_account", data, 1, true)).rejects.toThrow(
      "cash entries first",
    );
  });
  it("protects income direction and cash type links and checks stale deletions", async () => {
    await user(alice);
    const rental = crypto.randomUUID(),
      paymentId = crypto.randomUUID();
    const t = { name: "Flat rental", order: 50, direction: "income" };
    await change(rental, "type", t, 0);
    await change(paymentId, "payment", { ...payment, typeId: rental }, 0);
    await expect(
      change(rental, "type", { ...t, direction: "expense" }, 1),
    ).rejects.toThrow("Direction is fixed");
    await change(paymentId, "payment", { ...payment, typeId: rental }, 1, true);
    await change(entryId, "cash_entry", { ...entry, typeId: rental }, 1);
    await expect(change(rental, "type", t, 1, true)).rejects.toThrow(
      "cash entries first",
    );
    await change(entryId, "cash_entry", { ...entry, typeId: rental }, 2, true);
    expect((await change(entryId, "cash_entry", entry, 2)).conflict).toBe(true);
    await change(rental, "type", t, 1, true);
    await change(cash, "cash_account", data, 1, true);
  });
});

describe("Duplicate receipt ownership", () => {
  it("keeps a shared immutable receipt while an independent copy still references it", async () => {
    await user(alice);
    const t = crypto.randomUUID(),
      first = crypto.randomUUID(),
      copy = crypto.randomUUID();
    const attachment = {
      id: "33333333-3333-4333-a333-333333333333",
      name: "receipt.pdf",
      mime: "application/pdf",
      size: 10,
    };
    const data = {
      ...payment,
      typeId: t,
      paid: true,
      paymentDate: "2026-10-04",
      attachment,
    };
    await change(t, "type", { name: "Copy test", order: 99 }, 0);
    await change(first, "payment", data, 0);
    await change(copy, "payment", data, 0);
    await change(first, "payment", data, 1, true);
    await db.exec("reset role");
    const path = alice + "/" + attachment.id;
    expect(
      (
        await db.query<{ claimed: boolean }>(
          "select claim_receipt_cleanup($1,$2) as claimed",
          [alice, path],
        )
      ).rows[0].claimed,
    ).toBe(false);
    await user(alice);
    expect(
      (await db.query<any>("select data from records where id=$1", [copy]))
        .rows[0].data,
    ).toEqual(data);
  });
});

describe.sequential("Private cash attachments", () => {
  const accountId = crypto.randomUUID(), entryId = crypto.randomUUID();
  const first = crypto.randomUUID(), second = crypto.randomUUID(), foreign = crypto.randomUUID(), reserved = crypto.randomUUID();
  const attachment = (id: string) => ({id,name:"statement.pdf",mime:"application/pdf",size:10});
  const account = {name:"Attached savings",currency:"AED",openingDate:"2026-01-01",openingBalance:100000};
  const entry = {accountId,currency:"AED",direction:"out",amount:100,date:"2026-11-09",category:"maintenance",description:"Cash proof"};
  it("requires owned uploads before accepting metadata", async () => {
    await user(alice);
    await expect(change(accountId,"cash_account",{...account,attachment:attachment(first)},0)).rejects.toThrow("Upload attachment before saving");
    await user(bob);
    await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1)",[bob+"/"+foreign]);
    await user(alice);
    await expect(change(accountId,"cash_account",{...account,attachment:attachment(foreign)},0)).rejects.toThrow("Upload attachment before saving");
    for (const id of [first,second,reserved]) await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1)",[alice+"/"+id]);
  });
  it("advertises support and saves private account and entry attachments", async () => {
    await user(alice);
    expect((await db.query<any>("select duetrack_capabilities() as c")).rows[0].c.cashAttachments).toBe(true);
    expect((await change(accountId,"cash_account",{...account,attachment:attachment(first)},0)).row.data.attachment.id).toBe(first);
    expect((await change(entryId,"cash_entry",{...entry,attachment:attachment(second)},0)).row.data.attachment.id).toBe(second);
    await user(bob);
    await expect(change(accountId,"cash_account",account,1)).rejects.toThrow("Not authorized");
    expect((await db.query("select * from records where id=$1",[entryId])).rows).toHaveLength(0);
  });
  it("rejects invalid MIME, size and attachment field types without changing the record", async () => {
    await user(alice);
    for (const invalid of [{mime:"text/html"},{size:10485761},{size:1.5},{size:0},{name:123}]) await expect(change(accountId,"cash_account",{...account,attachment:{...attachment(first),...invalid}},1)).rejects.toThrow("Invalid cash attachment");
    expect((await db.query<any>("select version from records where id=$1",[accountId])).rows[0].version).toBe(1);
  });
  it("preserves the previous proof on failure and queues old proof on replacement", async () => {
    await user(alice);
    await expect(change(accountId,"cash_account",{...account,attachment:attachment(crypto.randomUUID())},1)).rejects.toThrow("Upload attachment");
    expect((await db.query<any>("select data from records where id=$1",[accountId])).rows[0].data.attachment.id).toBe(first);
    await change(accountId,"cash_account",{...account,attachment:attachment(second)},1);
    await db.exec("reset role");
    expect((await db.query("select * from receipt_gc where path=$1",[alice+"/"+first])).rows).toHaveLength(1);
    expect((await db.query<any>("select claim_receipt_cleanup($1,$2) as claimed",[alice,alice+"/"+second])).rows[0].claimed).toBe(false);
  });
  it("removes cash proof with a version check and preserves shared attachments during cleanup", async () => {
    await user(alice);
    await change(accountId,"cash_account",account,2);
    const stale=await change(accountId,"cash_account",{...account,attachment:attachment(first)},2);
    expect(stale.conflict).toBe(true);
    await db.exec("reset role");
    expect((await db.query<any>("select claim_receipt_cleanup($1,$2) as claimed",[alice,alice+"/"+second])).rows[0].claimed).toBe(false);
    await user(alice);
    await change(entryId,"cash_entry",entry,1,true);
    await db.exec("reset role");
    expect((await db.query<any>("select claim_receipt_cleanup($1,$2) as claimed",[alice,alice+"/"+second])).rows[0].claimed).toBe(true);
  });
  it("blocks a reserved object from being attached during cleanup", async () => {
    await db.exec("reset role");
    await db.query("select claim_receipt_cleanup($1,$2)",[alice,alice+"/"+reserved]);
    await user(alice);
    await expect(change(crypto.randomUUID(),"cash_account",{...account,attachment:attachment(reserved)},0)).rejects.toThrow("cleanup in progress");
  });
});
