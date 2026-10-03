import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  Row,
  money,
  signedMinorUnits,
  typeSchema,
} from "../src/payments/model";
import { cashBalance, forecast, validateCashLinks } from "../src/cash/rules";
import { inspectBackup, restorePlan } from "../src/backup/service";
const make = (kind: Row["kind"], data: any): Row => ({
  id: crypto.randomUUID(),
  kind,
  data,
  version: 1,
  deleted: false,
});
const mortgage = make("type", { name: "Mortgage", order: 0 });
const rent = make("type", { name: "Flat 1", order: 1, direction: "income" });
const account = make("cash_account", {
  name: "Savings",
  currency: "AED",
  openingDate: "2026-10-01",
  openingBalance: 100000000,
});
const payment = (
  typeId: string,
  amount: number,
  due = "2026-12-31",
  paid = false,
  currency = "AED",
) =>
  make("payment", {
    typeId,
    amount,
    due,
    paid,
    currency,
    paymentDate: paid ? "2026-10-01" : "",
    invoice: "",
    reference: "",
    description: "",
    recurrence: "none",
  });
const entry = (amount: number, direction = "in", date = "2026-10-02") =>
  make("cash_entry", {
    accountId: account.id,
    currency: "AED",
    amount,
    direction,
    date,
    category: "rent",
    description: "",
  });
const rows = [account, mortgage, rent];
describe("Manual cash and mortgage coverage", () => {
  it("defaults legacy types to expenses", () =>
    expect(typeSchema.parse(mortgage.data).direction).toBe("expense"));
  it("uses exact signed amounts including sub-unit negatives", () => {
    expect(signedMinorUnits("-0.29", "AED")).toBe(-29);
    expect(money(-29, "AED").replace(/[^0-9.,-]/g, "")).toBe("-0.29");
    expect(money(-123456, "AED").replace(/[^0-9.,-]/g, "")).toBe("-1,234.56");
    expect(signedMinorUnits("0.00", "AED")).toBe(0);
  });
  it("includes dated entries and ignores future, deleted and other-account entries", () => {
    const other = {
      ...entry(200),
      data: { ...entry(200).data, accountId: crypto.randomUUID() },
    };
    expect(
      cashBalance(
        account,
        [
          entry(10000),
          entry(2500, "out"),
          entry(999999, "in", "2027-01-01"),
          { ...entry(555), deleted: true },
          other,
        ],
        "2026-12-31",
      ),
    ).toBe(100007500n);
  });
  it("never posts money from paid/received transitions", () =>
    expect(
      cashBalance(
        account,
        [
          payment(rent.id, 50000, "2026-12-31", true),
          payment(mortgage.id, 70000, "2026-12-31", true),
        ],
        "2026-10-03",
      ),
    ).toBe(100000000n));
  it("counts inclusive dates, only selected unsettled payments and reports surplus", () => {
    const f = forecast(
      account,
      [
        ...rows,
        payment(rent.id, 20000000, "2026-10-03"),
        payment(mortgage.id, 50000000),
        payment(rent.id, 999, "2027-01-01"),
        payment(rent.id, 999, "2026-12-31", true),
      ],
      "2026-10-03",
      "2026-12-31",
      mortgage.id,
      [rent.id],
    );
    expect(f.closing).toBe(70000000n);
  });
  it("reports a shortfall and separates overdue amounts", () => {
    const data = [
      ...rows,
      payment(mortgage.id, 120000000),
      payment(rent.id, 50000, "2026-10-01"),
    ];
    const f = forecast(account, data, "2026-10-03", "2026-12-31", mortgage.id, [
      rent.id,
    ]);
    expect(f.closing).toBe(-20000000n);
    expect(f.overdueRent).toBe(50000n);
    expect(f.rent).toBe(0n);
    expect(
      forecast(
        account,
        data,
        "2026-10-03",
        "2026-12-31",
        mortgage.id,
        [rent.id],
        true,
      ).closing,
    ).toBe(-19950000n);
  });
  it("keeps currencies separate", () => {
    const f = forecast(
      account,
      [...rows, payment(rent.id, 10000, undefined, false, "USD")],
      "2026-10-03",
      "2026-12-31",
      mortgage.id,
      [rent.id],
    );
    expect(f.rent).toBe(0n);
    expect(f.otherCurrencies[0][0]).toBe("USD");
    expect(f.otherCurrencies[0][1].rent).toBe(10000n);
  });
  it("rejects backwards periods and non-income rent types", () => {
    expect(() =>
      forecast(account, rows, "2026-10-03", "2026-10-01", mortgage.id, [
        rent.id,
      ]),
    ).toThrow("End date");
    expect(() =>
      forecast(account, rows, "2026-10-03", "2026-12-31", mortgage.id, [
        mortgage.id,
      ]),
    ).toThrow("income types");
    expect(() => cashBalance(account, rows, "2026-09-30")).toThrow("opening");
  });
  it("validates cash account, currency, type and opening date relationships", () => {
    for (const data of [
      { accountId: crypto.randomUUID() },
      { currency: "USD" },
      { date: "2026-09-30" },
      { typeId: crypto.randomUUID() },
    ])
      expect(() =>
        validateCashLinks(
          { ...entry(1), data: { ...entry(1).data, ...data } },
          rows,
        ),
      ).toThrow();
  });
  it("restores v2 ledger and still reads v1 backups", () => {
    const pack = (records: Row[], version: number) =>
      zipSync({
        "backup.json": strToU8(
          JSON.stringify({ format: "duetrack", version, rows: records }),
        ),
      });
    expect(
      inspectBackup(pack([...rows, entry(100)], 2)).backup.rows,
    ).toHaveLength(4);
    expect(inspectBackup(pack([mortgage], 1)).backup.rows).toHaveLength(1);
    expect(() => inspectBackup(pack([...rows, entry(100)], 1))).toThrow(
      "version 1",
    );
    expect(() => inspectBackup(pack([entry(100)], 2))).toThrow(
      "account unavailable",
    );
  });
  it("restores parents first and deletes children before parents", () => {
    const e = entry(100);
    const plan = restorePlan([], [e, account, rent], "Merge");
    expect(plan[2].kind).toBe("cash_entry");
    const deleted = restorePlan([e, account, rent], [], "Replace");
    expect(deleted[0].kind).toBe("cash_entry");
  });
});
