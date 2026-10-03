import { useState } from "react";
import {
  Row,
  money,
  amountInput,
  minorUnits,
  signedMinorUnits,
  cashAccountSchema,
  cashEntrySchema,
  cashCategories,
  errorMessage,
  displayDate,
} from "../payments/model";
import { cashBalances, forecast, validateCashLinks } from "../cash/rules";

export function CashWorkspace({
  rows,
  day,
  currency,
  change,
  forecastOnly = false,
}: {
  rows: Row[];
  day: string;
  currency: string;
  change: (r: Row[]) => Promise<void>;
  forecastOnly?: boolean;
}) {
  const accounts = rows.filter((r) => r.kind === "cash_account" && !r.deleted);
  const types = rows.filter((r) => r.kind === "type" && !r.deleted);
  const [selected, setSelected] = useState("");
  const account = accounts.find((r) => r.id === selected) || accounts[0];
  const [editor, setEditor] = useState<{
    kind: "cash_account" | "cash_entry";
    row?: Row;
  }>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [asOf, setAsOf] = useState(day);
  const [end, setEnd] = useState(day.slice(0, 4) + "-12-31");
  const [mortgage, setMortgage] = useState("");
  const [rents, setRents] = useState<string[]>([]);
  const [overdue, setOverdue] = useState(false);
  const entries = rows
    .filter(
      (r) =>
        r.kind === "cash_entry" &&
        !r.deleted &&
        r.data.accountId === account?.id,
    )
    .sort(
      (a, b) =>
        b.data.date.localeCompare(a.data.date) || a.id.localeCompare(b.id),
    );
  const allAccounts = forecastOnly && selected === "all";
  let balances: Record<string, bigint> = {},
    result: ReturnType<typeof forecast> | undefined,
    calculationError = "";
  try {
    if (account)
      balances = cashBalances(allAccounts ? accounts : [account], rows, asOf);
    if (account && forecastOnly && mortgage)
      result = forecast(
        allAccounts ? accounts : account,
        rows,
        asOf,
        end,
        mortgage,
        rents,
        overdue,
      );
  } catch (e) {
    calculationError = errorMessage(e);
  }
  async function remove(r: Row) {
    if (
      !confirm(
        `Delete ${r.kind === "cash_account" ? r.data.name : "this cash entry"}? This changes the ledger balance.`,
      )
    )
      return;
    setError("");
    try {
      if (r.kind === "cash_account" && entries.length)
        throw Error("Delete or move cash entries before deleting this account");
      await change([{ ...r, deleted: true }]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{forecastOnly ? "Coverage forecast" : "Cash ledger"}</h1>
          <p className="muted">
            {forecastOnly
              ? "Compare available cash, expected rent and unpaid mortgage installments."
              : "Record bank movements manually and keep their history."}
          </p>
        </div>
      </div>
      <p className="notice">
        Marking a payment paid or rent received does not change cash. Enter the
        actual bank movement once in the cash ledger. The opening balance
        includes earlier movements.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="settings-card">
        <div className="form-grid">
          <label>
            Cash account
            <select
              value={allAccounts ? "all" : account?.id || ""}
              onChange={(e) => {
                setSelected(e.target.value);
                setEditor(undefined);
              }}
            >
              <option value="" disabled>
                Choose an account
              </option>
              {forecastOnly && !!accounts.length && (
                <option value="all">All cash accounts</option>
              )}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.data.name} · {a.data.currency}
                </option>
              ))}
            </select>
          </label>
          <label>
            Balance date
            <input
              type="date"
              required
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
        </div>
        {Object.entries(balances).map(([c, balance]) => (
          <div className="total-card" key={c}>
            <span>
              {allAccounts ? "Combined available cash" : "Available cash"} · {c}
            </span>
            <strong>{money(balance, c)}</strong>
            <small>
              Opening balance plus entries through {displayDate(asOf)}. Later
              entries excluded.
            </small>
          </div>
        ))}
        {calculationError && (
          <p className="error" role="alert">
            {calculationError}
          </p>
        )}
        {!forecastOnly && (
          <div className="actions ledger-actions">
            <button onClick={() => setEditor({ kind: "cash_account" })}>
              Add cash account
            </button>
            {account && (
              <>
                <button
                  onClick={() =>
                    setEditor({ kind: "cash_account", row: account })
                  }
                >
                  Edit cash account
                </button>
                <button
                  onClick={() => void remove(account)}
                  disabled={!!entries.length}
                >
                  Delete cash account
                </button>
                <button
                  className="primary"
                  onClick={() => setEditor({ kind: "cash_entry" })}
                >
                  Add cash entry
                </button>
              </>
            )}
          </div>
        )}
        {forecastOnly && !account && (
          <p>Create a cash account in Cash ledger first.</p>
        )}
      </section>
      {editor && !forecastOnly && (
        <section
          className="settings-card"
          key={editor.kind + (editor.row?.id || "new")}
        >
          <h2>
            {editor.row ? "Edit" : "Add"}{" "}
            {editor.kind === "cash_account" ? "cash account" : "cash entry"}
          </h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (saving) return;
              const f = new FormData(e.currentTarget);
              setSaving(true);
              setError("");
              try {
                const c =
                  editor.kind === "cash_account"
                    ? String(f.get("currency"))
                    : account.data.currency;
                const data =
                  editor.kind === "cash_account"
                    ? cashAccountSchema.parse({
                        name: f.get("name"),
                        currency: c,
                        openingDate: f.get("openingDate"),
                        openingBalance: signedMinorUnits(
                          String(f.get("openingBalance")),
                          c,
                        ),
                      })
                    : cashEntrySchema.parse({
                        accountId: account.id,
                        currency: c,
                        direction: f.get("direction"),
                        amount: minorUnits(String(f.get("amount")), c),
                        date: f.get("date"),
                        category: f.get("category"),
                        typeId: f.get("typeId") || undefined,
                        description: f.get("description"),
                      });
                const latest =
                  editor.row && rows.find((r) => r.id === editor.row!.id);
                if (
                  editor.row &&
                  (!latest ||
                    latest.deleted ||
                    latest.version !== editor.row.version)
                )
                  throw Error(
                    "This record changed on another device. Reopen the editor.",
                  );
                const r: Row = {
                  ...(latest || {
                    id: crypto.randomUUID(),
                    version: 0,
                    deleted: false,
                  }),
                  kind: editor.kind,
                  data,
                };
                if (
                  r.kind === "cash_account" &&
                  latest &&
                  entries.length &&
                  ["currency", "openingDate", "openingBalance"].some(
                    (k) => latest.data[k] !== r.data[k],
                  )
                )
                  throw Error(
                    "Once entries exist, keep the opening balance unchanged and use an adjustment entry.",
                  );
                validateCashLinks(r, rows);
                await change([r]);
                setSelected(editor.kind === "cash_account" ? r.id : account.id);
                setEditor(undefined);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {editor.kind === "cash_account" ? (
              <>
                <label>
                  Account name
                  <input
                    name="name"
                    required
                    maxLength={60}
                    defaultValue={editor.row?.data.name || "Savings"}
                  />
                </label>
                <label>
                  Account currency
                  <select
                    name="currency"
                    defaultValue={editor.row?.data.currency || currency}
                  >
                    {[
                      "AED",
                      "USD",
                      "EUR",
                      "GBP",
                      "SAR",
                      "INR",
                      "JPY",
                      "KWD",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Opening balance date
                  <input
                    name="openingDate"
                    type="date"
                    required
                    defaultValue={editor.row?.data.openingDate || day}
                  />
                </label>
                <label>
                  Opening balance
                  <input
                    name="openingBalance"
                    inputMode="decimal"
                    required
                    defaultValue={
                      editor.row
                        ? amountInput(
                            editor.row.data.openingBalance,
                            editor.row.data.currency,
                          )
                        : "0.00"
                    }
                  />
                </label>
                <p className="muted">
                  Enter the bank balance on this date, including previously
                  received rent. Once entries exist, reconcile changes using an
                  Adjustment entry.
                </p>
              </>
            ) : (
              <>
                <label>
                  Money movement
                  <select
                    name="direction"
                    defaultValue={editor.row?.data.direction || "in"}
                  >
                    <option value="in">Money in</option>
                    <option value="out">Money out</option>
                  </select>
                </label>
                <label>
                  Cash amount · {account.data.currency}
                  <input
                    name="amount"
                    inputMode="decimal"
                    required
                    defaultValue={
                      editor.row
                        ? amountInput(
                            editor.row.data.amount,
                            account.data.currency,
                          )
                        : ""
                    }
                  />
                </label>
                <label>
                  Entry date
                  <input
                    name="date"
                    type="date"
                    required
                    min={account.data.openingDate}
                    defaultValue={editor.row?.data.date || day}
                  />
                </label>
                <label>
                  Category
                  <select
                    name="category"
                    defaultValue={editor.row?.data.category || "rent"}
                  >
                    {cashCategories.map((c) => (
                      <option value={c} key={c}>
                        {c.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Related asset or payment type
                  <select
                    name="typeId"
                    defaultValue={editor.row?.data.typeId || ""}
                  >
                    <option value="">None</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.data.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Cash description
                  <textarea
                    name="description"
                    maxLength={2000}
                    defaultValue={editor.row?.data.description || ""}
                  />
                </label>
                <p className="muted">
                  For bank reconciliation, choose Adjustment and enter only the
                  difference as money in or out. Future entries do not affect
                  today’s available cash.
                </p>
              </>
            )}
            <div className="actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditor(undefined)}
              >
                Cancel
              </button>
              <button className="primary" disabled={saving}>
                {saving
                  ? "Saving…"
                  : editor.kind === "cash_account"
                    ? "Save cash account"
                    : "Save cash entry"}
              </button>
            </div>
          </form>
        </section>
      )}
      {forecastOnly && account && (
        <section className="settings-card">
          <h2>Forecast period</h2>
          <p>
            The balance date is the start of the forecast. Dates are inclusive.
            Scheduled cash entries are excluded; future rent comes from the
            selected income payment records.
          </p>
          <label>
            Through date
            <input
              type="date"
              required
              min={asOf}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label>
            Mortgage expense type
            <select
              value={mortgage}
              onChange={(e) => setMortgage(e.target.value)}
            >
              <option value="">Choose mortgage type</option>
              <option value="all">All mortgages</option>
              {types
                .filter((t) => t.data.direction !== "income")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.data.name}
                  </option>
                ))}
            </select>
          </label>
          {mortgage === "all" && (
            <p className="muted">
              All mortgages includes every Expense payment type.
            </p>
          )}
          {allAccounts && (
            <p className="muted">
              Accounts are combined by currency for this forecast. Each account
              keeps its own cash ledger.
            </p>
          )}
          <fieldset>
            <legend>Rental income types</legend>
            {types
              .filter((t) => t.data.direction === "income")
              .map((t) => (
                <label className="check" key={t.id}>
                  <input
                    type="checkbox"
                    checked={rents.includes(t.id)}
                    onChange={(e) =>
                      setRents(
                        e.target.checked
                          ? [...rents, t.id]
                          : rents.filter((id) => id !== t.id),
                      )
                    }
                  />
                  {t.data.name}
                </label>
              ))}
            {!types.some((t) => t.data.direction === "income") && (
              <p>Add an Income payment type for each rental asset.</p>
            )}
          </fieldset>
          <label className="check">
            <input
              type="checkbox"
              checked={overdue}
              onChange={(e) => setOverdue(e.target.checked)}
            />
            Include overdue rent and mortgage installments before the balance
            date
          </label>
          {result &&
            (allAccounts
              ? [
                  result,
                  ...result.otherCurrencies.map(([c, g]) => ({
                    ...g,
                    currency: c,
                    otherCurrencies: [],
                  })),
                ]
              : [result]
            ).map((result) => (
              <section
                key={result.currency}
                aria-label={`Forecast in ${result.currency}`}
              >
                <div className="totals-grid forecast-totals">
                  {[
                    ["Available cash", result.available],
                    ["Expected rent", result.rent],
                    ["Unpaid mortgage", result.mortgage],
                  ].map(([label, value]) => (
                    <div className="total-card" key={String(label)}>
                      <span>
                        {String(label)} · {result.currency}
                      </span>
                      <strong>{money(value as bigint, result.currency)}</strong>
                    </div>
                  ))}
                </div>
                <div className="total-card">
                  <span>
                    {result.closing >= 0n
                      ? "Projected surplus"
                      : "Amount to cover"}
                  </span>
                  <strong
                    className={
                      result.closing >= 0n
                        ? "forecast-surplus"
                        : "forecast-shortfall"
                    }
                  >
                    {money(
                      result.closing < 0n ? -result.closing : result.closing,
                      result.currency,
                    )}
                  </strong>
                  <small>
                    Available cash + expected rent − unpaid mortgage.{" "}
                    {overdue
                      ? "Overdue amounts included."
                      : "Overdue amounts excluded."}
                  </small>
                </div>
                <p>
                  Overdue rent: {money(result.overdueRent, result.currency)} ·
                  Overdue mortgage:{" "}
                  {money(result.overdueMortgage, result.currency)}
                </p>
                {!allAccounts &&
                  result.otherCurrencies.map(([c, g]) => (
                    <p className="notice" key={c}>
                      {c} is separate: expected rent {money(g.rent, c)}, unpaid
                      mortgage {money(g.mortgage, c)}. Excluded from the{" "}
                      {result.currency} balance; select a {c} cash account for
                      its forecast.
                    </p>
                  ))}
              </section>
            ))}
        </section>
      )}
      {!forecastOnly && account && (
        <section className="settings-card">
          <h2>Cash history</h2>
          {entries.length ? (
            entries.map((r) => (
              <div className="ledger-entry" key={r.id}>
                <div>
                  <strong>
                    {r.data.direction === "in" ? "+" : "−"}
                    {money(r.data.amount, r.data.currency)}
                  </strong>
                  <p>
                    {displayDate(r.data.date)} ·{" "}
                    {r.data.category.replaceAll("_", " ")}
                    {r.data.date > day ? " · Scheduled" : ""}
                  </p>
                  <p>
                    {r.data.description}{" "}
                    {types.find((t) => t.id === r.data.typeId)?.data.name || ""}
                  </p>
                </div>
                <div className="actions">
                  <button
                    aria-label={`Edit cash entry ${r.data.description || r.data.date}`}
                    onClick={() => setEditor({ kind: "cash_entry", row: r })}
                  >
                    Edit
                  </button>
                  <button
                    aria-label={`Delete cash entry ${r.data.description || r.data.date}`}
                    onClick={() => void remove(r)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p>No entries yet. Your opening balance is the starting cash.</p>
          )}
        </section>
      )}
    </>
  );
}
