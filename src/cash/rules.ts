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
export function cashBalances(accounts: Row[], rows: Row[], asOf: string) {
  const balances: Record<string, bigint> = {};
  const seen = new Set<string>();
  for (const account of accounts) {
    if (
      account.deleted ||
      account.kind !== "cash_account" ||
      seen.has(account.id)
    )
      continue;
    seen.add(account.id);
    if (asOf < account.data.openingDate)
      throw Error(
        `${account.data.name}: choose a balance date on or after ${account.data.openingDate}`,
      );
    balances[account.data.currency] =
      (balances[account.data.currency] || 0n) +
      cashBalance(account, rows, asOf);
  }
  return balances;
}
export function forecast(
  account: Row | Row[],
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
  const mortgageIds =
    mortgageId === "all"
      ? types.filter((t) => t.data.direction !== "income").map((t) => t.id)
      : [mortgageId];
  if (
    !mortgageIds.length ||
    mortgageIds.some(
      (id) => !types.some((r) => r.id === id && r.data.direction !== "income"),
    )
  )
    throw Error("Choose an expense type for the mortgage");
  if (incomeIds.some((id) => !isIncome(types, id)))
    throw Error("Choose income types for expected rent");
  const accounts = (Array.isArray(account) ? account : [account]).filter(
    (a) => !a.deleted && a.kind === "cash_account",
  );
  if (!accounts.length) throw Error("Choose at least one cash account");
  const balances = cashBalances(accounts, rows, from);
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
    const field = mortgageIds.includes(p.typeId)
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
  const currency = accounts[0].data.currency;
  for (const c of Object.keys(balances))
    groups[c] ??= {
      rent: 0n,
      mortgage: 0n,
      overdueRent: 0n,
      overdueMortgage: 0n,
    };
  const available = balances[currency];
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
    otherCurrencies: Object.entries(groups)
      .filter(([c]) => c !== currency)
      .map(
        ([c, g]) =>
          [
            c,
            {
              ...g,
              available: balances[c] || 0n,
              closing: (balances[c] || 0n) + g.rent - g.mortgage,
            },
          ] as const,
      ),
  };
}
