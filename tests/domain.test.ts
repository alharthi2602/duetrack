import { describe, it, expect, vi } from "vitest";
import {
  paymentSchema,
  minorUnits,
  totals,
  status,
  sorted,
  dateSchema,
  Row,
  money,
  today,
} from "../src/payments/model";
import { nextDate, generate, occurrenceId } from "../src/recurrence/rules";
import { queue, reconcile } from "../src/sync/store";
import { metadata } from "../src/attachments/service";
import { inspectBackup } from "../src/backup/service";
import { zipSync, strToU8 } from "fflate";
const typeId = "11111111-1111-4111-a111-111111111111",
  id = "22222222-2222-4222-a222-222222222222";
const p = {
  typeId,
  amount: 101,
  currency: "AED",
  due: "2026-10-01",
  invoice: "",
  reference: "",
  description: "",
  paid: false,
  paymentDate: "",
  recurrence: "none" as const,
};
const row: Row = { id, kind: "payment", version: 1, deleted: false, data: p };
describe("Payments and money", () => {
  it("requires amount and due date", () => {
    expect(paymentSchema.safeParse(p).success).toBe(true);
    expect(paymentSchema.safeParse({ ...p, amount: 0 }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...p, due: "" }).success).toBe(false);
  });
  it("parses decimal money without floating point multiplication", () => {
    expect(minorUnits("0.29", "AED")).toBe(29);
    expect(minorUnits("123.456", "KWD")).toBe(123456);
    expect(minorUnits("123", "JPY")).toBe(123);
    expect(() => minorUnits("1.001", "USD")).toThrow();
    expect(() => minorUnits("0", "USD")).toThrow();
  });
  it("totals paid/unpaid separately for each currency", () => {
    expect(
      totals([
        row,
        {
          ...row,
          id: crypto.randomUUID(),
          data: { ...p, paid: true, amount: 202 },
        },
        { ...row, data: { ...p, currency: "USD", amount: 500 } },
        { ...row, deleted: true },
      ]),
    ).toEqual({
      AED: { paid: 202n, unpaid: 101n },
      USD: { paid: 0n, unpaid: 500n },
    });
  });
  it("requires payment date on paid transition and permits unpaid reversal", () => {
    expect(paymentSchema.safeParse({ ...p, paid: true }).success).toBe(false);
    expect(
      paymentSchema.parse({ ...p, paid: true, paymentDate: "2026-10-02" }).paid,
    ).toBe(true);
    expect(paymentSchema.parse(p).paymentDate).toBe("");
  });
  it("compares date-only due dates", () => {
    expect(status(p, "2026-10-01")).toBe("Due today");
    expect(status(p, "2026-10-02")).toBe("Overdue");
    expect(status(p, "2026-09-30")).toBe("Upcoming");
    expect(status({ ...p, paid: true }, "2026-10-02")).toBe("Paid");
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
  });
  it("sorts unpaid first then date", () => {
    const paid = {
      ...row,
      id: "paid",
      data: { ...p, paid: true, due: "2026-01-01" },
    };
    expect(sorted([paid, row])[0].id).toBe(id);
  });
});
describe("Precision and account dates", () => {
  it("keeps very large totals exact", () => {
    const records = Array.from({ length: 10000 }, () => ({
      ...row,
      data: { ...p, amount: 999999999999 },
    }));
    expect(totals(records).AED.unpaid).toBe(9999999999990000n);
    expect(money(29, "AED")).toContain("0.29");
  });
  it("uses account time zone at the midnight boundary", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
      expect(today("Asia/Dubai")).toBe("2026-10-01");
      expect(today("America/New_York")).toBe("2026-09-30");
    } finally {
      vi.useRealTimers();
    }
  });
});
describe("Recurrence", () => {
  it("clamps month end and returns to original anchor", () => {
    expect(nextDate("2025-01-31", "monthly", 1)).toBe("2025-02-28");
    expect(nextDate("2025-01-31", "monthly", 2)).toBe("2025-03-31");
    expect(nextDate("2024-01-31", "monthly", 1)).toBe("2024-02-29");
  });
  it("clamps leap years", () => {
    expect(nextDate("2024-02-29", "yearly", 1)).toBe("2025-02-28");
    expect(nextDate("2024-02-29", "yearly", 4)).toBe("2028-02-29");
  });
  it("has stable IDs and never copies payment state or receipts", async () => {
    const data = {
      ...p,
      seriesId: typeId,
      recurrence: "monthly" as const,
      paid: true,
      paymentDate: "2026-10-01",
      attachment: {
        id,
        name: "receipt.pdf",
        mime: "application/pdf" as const,
        size: 10,
      },
    };
    const [r] = await generate(data, 1);
    expect(r.data.paid).toBe(false);
    expect(r.data.paymentDate).toBe("");
    expect(r.data.attachment).toBeUndefined();
    expect(r.id).toBe(await occurrenceId(typeId, "2026-11-01"));
  });
});
describe("Offline queue and conflicts", () => {
  it("coalesces edits preserving original version and stable record", () => {
    const s = queue(
      { rows: [row], pending: [] },
      { ...row, data: { ...p, amount: 200 } },
    );
    const next = queue(s, { ...row, data: { ...p, amount: 300 } });
    expect(next.pending).toHaveLength(1);
    expect(next.pending[0].base).toBe(1);
    expect(next.rows[0].data.amount).toBe(300);
  });
  it("preserves pending deletion on refresh", () => {
    const s = queue({ rows: [row], pending: [] }, { ...row, deleted: true });
    expect(reconcile(s, [row]).rows[0].deleted).toBe(true);
  });
  it("resolves conflicts against remote version", () => {
    const s = {
      rows: [row],
      pending: [
        {
          id,
          row,
          base: 1,
          mutation: crypto.randomUUID(),
          remote: { ...row, version: 3 },
        },
      ],
    };
    expect(queue(s, { ...row, version: 3 }).pending[0].base).toBe(3);
  });
  it("merges refreshed cloud data without overwriting pending edits", () => {
    const s = queue(
      { rows: [row], pending: [] },
      { ...row, data: { ...p, description: "Offline edit" } },
    );
    expect(
      reconcile(s, [{ ...row, version: 2 }]).rows[0].data.description,
    ).toBe("Offline edit");
  });
});
describe("Attachments and backup", () => {
  it("rejects invalid receipt types and large files", () => {
    expect(() =>
      metadata(new File(["a"], "a.exe", { type: "application/octet-stream" })),
    ).toThrow();
    const a = metadata(new File(["abc"], "r.pdf", { type: "application/pdf" }));
    expect(a.size).toBe(3);
    expect(() =>
      metadata(
        new File([new Uint8Array(10485761)], "r.pdf", {
          type: "application/pdf",
        }),
      ),
    ).toThrow();
  });
  it("validates version, duplicates and relationships", () => {
    const type: Row = {
      id: typeId,
      kind: "type",
      version: 1,
      deleted: false,
      data: { name: "Mortgage", order: 0 },
    };
    const pack = (rows: Row[], version = 1) =>
      zipSync({
        "backup.json": strToU8(
          JSON.stringify({ format: "duetrack", version, rows }),
        ),
      });
    expect(inspectBackup(pack([type, row])).backup.rows).toHaveLength(2);
    expect(() => inspectBackup(pack([row]))).toThrow("Payment type missing");
    expect(() => inspectBackup(pack([type, row, row]))).toThrow("Duplicate");
    expect(() => inspectBackup(pack([type, row], 3))).toThrow("Unsupported");
  });
  it("requires receipt bytes and relationships", () => {
    const r = {
      ...row,
      data: {
        ...p,
        attachment: { id, name: "r.pdf", mime: "application/pdf", size: 10 },
      },
    };
    expect(() =>
      inspectBackup(
        zipSync({
          "backup.json": strToU8(
            JSON.stringify({ format: "duetrack", version: 1, rows: [r] }),
          ),
        }),
      ),
    ).toThrow("Receipt missing");
  });
});
