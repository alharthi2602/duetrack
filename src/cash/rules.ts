import {
  Row,
  CashAccount,
  CashEntry,
  dateSchema,
  isIncome,
} from "../payments/model";

export function cashBalance(account: Row, rows: Row[], asOf: string): bigint {
  dateSchema.parse(asOf);
  const data = account.data as CashAccount;
  if (
    account.deleted ||
    account.kind !== "cash_account" ||
    asOf < data.openingDate
  )
    throw Error("Choose a date on or after the opening balance date");
  return rows
    .filter(
      (r) =>
        r.kind === "cash_entry" &&
        !r.deleted &&
        r.data.accountId === account.id &&
        r.data.date <= asOf,
    )
    .reduce(
      (sum, r) =>
        sum + BigInt(r.data.amount) * (r.data.direction === "in" ? 1n : -1n),
      BigInt(data.openingBalance),
    );
}
export function validateCashLinks(row: Row, rows: Row[]) {
  if (row.deleted) return;
  if (row.kind === "cash_entry") {
    const e = row.data as CashEntry;
    const account = rows.find(
      (r) => r.kind === "cash_account" && !r.deleted && r.id === e.accountId,
    );
    if (!account) throw Error("Cash account unavailable");
    if (e.currency !== account.data.currency)
      throw Error("Entry currency must match its cash account");
    if (e.date < account.data.openingDate)
      throw Error("Entry date must be on or after the opening balance date");
    if (
      e.typeId &&
      !rows.some((r) => r.kind === "type" && !r.deleted && r.id === e.typeId)
    )
      throw Error("Associated payment type unavailable");
  }
}
export function forecast(
  account: Row,
  rows: Row[],
  from: string,
  through: string,
  mortgageId: string,
  incomeIds: string[],
  includeOverdue = false,
) {
  dateSchema.parse(from);
  dateSchema.parse(through);
  if (through < from)
    throw Error("End date must be on or after the balance date");
  const types = rows.filter((r) => r.kind === "type" && !r.deleted);
  if (!types.some((r) => r.id === mortgageId && r.data.direction !== "income"))
    throw Error("Choose an expense type for the mortgage");
  if (incomeIds.some((id) => !isIncome(types, id)))
    throw Error("Choose income types for expected rent");
  const available = cashBalance(account, rows, from);
  const groups: Record<
    string,
    {
      rent: bigint;
      mortgage: bigint;
      overdueRent: bigint;
      overdueMortgage: bigint;
    }
  > = {};
  for (const r of rows) {
    if (
      r.deleted ||
      r.kind !== "payment" ||
      r.data.paid ||
      r.data.due > through
    )
      continue;
    const p = r.data;
    const field =
      p.typeId === mortgageId
        ? "mortgage"
        : incomeIds.includes(p.typeId)
          ? "rent"
          : undefined;
    if (!field) continue;
    const g = (groups[p.currency] ??= {
      rent: 0n,
      mortgage: 0n,
      overdueRent: 0n,
      overdueMortgage: 0n,
    });
    if (p.due < from) {
      g[field === "rent" ? "overdueRent" : "overdueMortgage"] += BigInt(
        p.amount,
      );
      if (!includeOverdue) continue;
    }
    g[field] += BigInt(p.amount);
  }
  const currency = account.data.currency;
  groups[currency] ??= {
    rent: 0n,
    mortgage: 0n,
    overdueRent: 0n,
    overdueMortgage: 0n,
  };
  const current = groups[currency];
  return {
    available,
    currency,
    ...current,
    closing: available + current.rent - current.mortgage,
    otherCurrencies: Object.entries(groups).filter(([c]) => c !== currency),
  };
}
