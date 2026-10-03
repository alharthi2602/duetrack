import React, { useEffect, useRef, useState } from "react";

import {
  Plus,
  Wallet,
  Search,
  SlidersHorizontal,
  Settings,
  Home,
  Zap,
  Check,
  ChevronRight,
  Download,
  Upload,
  Repeat,
  FileText,
  LogOut,
  Cloud,
  ArrowUp,
  ArrowDown,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import { cloud, configured } from "../auth/client";
import { useAccount } from "../sync/useAccount";
import {
  Row,
  Payment,
  today,
  status,
  paymentStatus,
  isIncome,
  money,
  displayDate,
  totals,
  sorted,
  errorMessage,
} from "../payments/model";
import { CashWorkspace } from "./CashWorkspace";
import { PaymentTypeForm } from "./PaymentTypeForm";
import { PaymentForm } from "../components/PaymentForm";
import { receipt } from "../attachments/service";
import { useModal } from "../components/useModal";
import { fileGet, clearAccount } from "../sync/store";
import {
  exportBackup,
  inspectBackup,
  stageReceipts,
  restorePlan,
} from "../backup/service";
import {
  renameType,
  reorderTypes,
  canDeleteType,
} from "../payment-types/rules";
import {
  generate,
  nextDate,
  occurrenceId,
  planSeriesEdit,
} from "../recurrence/rules";
import "../styles.css";
function ConflictSummary({ row }: { row: Row }) {
  if (row.kind === "cash_entry")
    return (
      <dl>
        {[
          ["Amount", money(row.data.amount, row.data.currency)],
          ["Movement", row.data.direction === "in" ? "Money in" : "Money out"],
          ["Date", displayDate(row.data.date)],
          ["Category", row.data.category],
          ["Description", row.data.description || "—"],
          ["Account", row.data.accountId],
          ["Status", row.deleted ? "Deleted" : "Active"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    );
  if (row.kind === "cash_account")
    return (
      <dl>
        {[
          ["Name", row.data.name],
          [
            "Opening balance",
            money(row.data.openingBalance, row.data.currency),
          ],
          ["Opening date", displayDate(row.data.openingDate)],
          ["Status", row.deleted ? "Deleted" : "Active"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    );
  if (row.kind !== "payment")
    return (
      <p>
        {row.data.name ||
          `${row.data.currency} · ${row.data.timezone} · ${row.data.theme}`}
      </p>
    );
  const p = row.data as Payment;
  return (
    <dl>
      <div>
        <dt>Amount</dt>
        <dd>{money(p.amount, p.currency)}</dd>
      </div>
      <div>
        <dt>Due date</dt>
        <dd>{displayDate(p.due)}</dd>
      </div>
      <div>
        <dt>Description</dt>
        <dd>{p.description || "—"}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{row.deleted ? "Deleted" : p.paid ? "Paid" : "Unpaid"}</dd>
      </div>
      <div>
        <dt>Receipt</dt>
        <dd>{p.attachment?.name || "None"}</dd>
      </div>
    </dl>
  );
}
export function Dashboard({
  owner,
  leave,
}: {
  owner: string;
  leave: () => void;
}) {
  const a = useAccount(owner);
  const [tab, setTab] = useState("all"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [typeFilter, setTypeFilter] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [filters, setFilters] = useState(false),
    [form, setForm] = useState<Row | null | undefined>(undefined),
    [details, setDetails] = useState<Row | null>(null),
    [typeEditor, setTypeEditor] = useState<Row | null | undefined>(undefined),
    [panel, setPanel] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [offline, setOffline] = useState(!navigator.onLine),
    [backup, setBackup] = useState<ReturnType<typeof inspectBackup> | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [offlineFiles, setOfflineFiles] = useState<Set<string>>(new Set());
  useModal(
    form !== undefined
      ? "form"
      : details
        ? "details"
        : typeEditor !== undefined
          ? "type"
          : false,
    () => {
      setForm(undefined);
      setDetails(null);
      setTypeEditor(undefined);
    },
  );
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    const dark =
      a.prefs.theme === "dark" ||
      (a.prefs.theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [a.prefs.theme]);
  useEffect(() => {
    Promise.all(
      a.state.rows
        .filter((r) => r.data.attachment)
        .map(async (r) =>
          (await fileGet(owner, r.data.attachment.id))
            ? r.data.attachment.id
            : "",
        ),
    ).then((ids) => setOfflineFiles(new Set(ids.filter(Boolean))));
  }, [a.state.rows]);
  const types = a.state.rows
    .filter((r) => r.kind === "type" && !r.deleted)
    .sort((x, y) => x.data.order - y.data.order);
  const payments = a.state.rows.filter(
    (r) => r.kind === "payment" && !r.deleted,
  );
  const day = today(a.prefs.timezone);
  const filtered = sorted(
    payments.filter((r) => {
      const p = r.data as Payment;
      return (
        (tab === "all" || p.typeId === tab) &&
        (typeFilter === "all" || p.typeId === typeFilter) &&
        (filter === "all" ||
          (filter === "paid" && p.paid) ||
          (filter === "unpaid" && !p.paid) ||
          (filter === "overdue" && status(p, day) === "Overdue")) &&
        (!from || p.due >= from) &&
        (!to || p.due <= to) &&
        `${p.description} ${p.reference} ${types.find((t) => t.id === p.typeId)?.data.name}`
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    }),
  );
  const sums = totals(filtered);
  const incomeView = tab !== "all" && isIncome(types, tab);
  const detailsIncome = details && isIncome(types, details.data.typeId);
  const title =
    tab === "all"
      ? "All payments"
      : types.find((t) => t.id === tab)?.data.name || "All payments";
  const filteredLabel =
    query || filter !== "all" || typeFilter !== "all" || from || to
      ? "Current filtered view"
      : tab === "all"
        ? "All records"
        : "All records in this type";
  async function act(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function save(rows: Row[], future: boolean) {
    const edits = planSeriesEdit(payments, rows[0], future);
    await a.change([...edits, ...rows.slice(1)]);
  }
  async function viewReceipt(r: Row, download = false) {
    await act(async () => {
      const b = await receipt(owner, r.data.attachment),
        url = URL.createObjectURL(b);
      if (download) {
        const link = document.createElement("a");
        link.href = url;
        link.download = r.data.attachment.name;
        link.click();
      } else window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setOfflineFiles(new Set([...offlineFiles, r.data.attachment.id]));
    });
  }
  if (!a.ready) return <div className="loading">Loading your payments…</div>;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Check />
          </span>
          DueTrack
        </div>
        <p className="nav-label">YOUR WORKSPACE</p>
        <button
          className={panel === "" ? "nav active" : "nav"}
          onClick={() => setPanel("")}
        >
          <Wallet size={20} />
          Payments
        </button>
        <button
          className={panel === "types" ? "nav active" : "nav"}
          onClick={() => setPanel("types")}
        >
          <SlidersHorizontal size={20} />
          Payment types
        </button>
        <button
          className={panel === "settings" ? "nav active" : "nav"}
          onClick={() => setPanel("settings")}
        >
          <Settings size={20} />
          Settings & backup
        </button>
        <button
          className={panel === "cash" ? "nav active" : "nav"}
          onClick={() => setPanel("cash")}
        >
          <Wallet size={20} />
          Cash ledger
        </button>
        <button
          className={panel === "forecast" ? "nav active" : "nav"}
          onClick={() => setPanel("forecast")}
        >
          <Cloud size={20} />
          Coverage forecast
        </button>
        <div className="sidebar-bottom">
          <div className="sync-caption">
            <Cloud size={18} />
            {owner === "demo"
              ? "Local preview"
              : offline
                ? "Offline · edits saved locally"
                : a.syncing
                  ? "Synchronizing…"
                  : a.error || a.state.pending.some((p) => p.error)
                    ? "Sync failed"
                    : a.state.pending.length
                      ? "Pending sync"
                      : "Saved"}
          </div>
          <button
            className="nav"
            onClick={() =>
              void act(async () => {
                if (await a.signout()) leave();
              })
            }
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <span>YOUR PAYMENT WORKSPACE</span>
          <button
            onClick={() => setPanel(panel === "settings" ? "" : "settings")}
            aria-label="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
        <div className="mobile-brand brand">
          <span className="brand-icon">
            <Check />
          </span>
          DueTrack
          <button
            className="mobile-header-signout"
            onClick={() =>
              void act(async () => {
                if (await a.signout()) leave();
              })
            }
          >
            <LogOut size={18} aria-hidden="true" />
            Sign out
          </button>
        </div>
        {owner === "demo" && (
          <div className="preview-banner">
            Local preview · cloud accounts and cross-device sync require backend
            setup.
          </div>
        )}
        {offline && (
          <div className="notice">
            You’re offline. Changes stay on this device until you reconnect.
          </div>
        )}
        {(error || a.error || a.state.pending.some((p) => p.error)) && (
          <div className="error" role="alert">
            {error ||
              a.error ||
              "Some changes could not be saved. Retry or resolve the conflicting edits below."}
            <button onClick={() => void a.sync()}>Retry</button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice("")} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        )}
        {a.progress > 0 && (
          <div role="status">
            Uploading receipt: {a.progress}%
            <progress value={a.progress} max={100} />
          </div>
        )}
        {panel === "" ? (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">Stay one step ahead</span>
                <h1>Payments</h1>
                <p className="muted">
                  Everything that’s due. Everything you’ve paid.
                </p>
              </div>
              <button
                className="primary add-payment"
                disabled={a.syncing || !types.length}
                onClick={() => setForm(null)}
              >
                <Plus size={20} />
                Add payment
              </button>
            </div>
            <nav className="tabs" aria-label="Payment types">
              <button
                className={tab === "all" ? "selected" : ""}
                onClick={() => setTab("all")}
              >
                <Wallet size={18} />
                All payments<span>{payments.length}</span>
              </button>
              {types.map((t) => (
                <button
                  key={t.id}
                  className={tab === t.id ? "selected" : ""}
                  onClick={() => setTab(t.id)}
                >
                  {t.data.name === "Mortgage" ? (
                    <Home size={18} />
                  ) : t.data.name === "Electricity" ? (
                    <Zap size={18} />
                  ) : (
                    <FileText size={18} />
                  )}
                  {t.data.name}
                  <span>
                    {payments.filter((p) => p.data.typeId === t.id).length}
                  </span>
                </button>
              ))}
              <button
                onClick={() => setPanel("types")}
                aria-label="Manage payment types"
              >
                <Plus size={18} />
              </button>
            </nav>
            <div className="totals-label">
              {filteredLabel} · totals by currency
            </div>
            <div className="totals-grid">
              {Object.keys(sums).length ? (
                Object.entries(sums).map(([currency, t]) => (
                  <React.Fragment key={currency}>
                    <div className="total-card unpaid">
                      <div>
                        <span>
                          {incomeView ? "Expected rent" : "Total unpaid"} ·{" "}
                          {currency}
                        </span>
                        <span className="metric-icon">
                          <Wallet size={20} />
                        </span>
                      </div>
                      <strong>{money(t.unpaid, currency)}</strong>
                      <small>
                        {
                          filtered.filter(
                            (r) => !r.data.paid && r.data.currency === currency,
                          ).length
                        }{" "}
                        {incomeView ? "expected receipts" : "unpaid payments"}
                      </small>
                    </div>
                    <div className="total-card">
                      <div>
                        <span>
                          {incomeView ? "Total received" : "Total paid"} ·{" "}
                          {currency}
                        </span>
                        <span className="metric-icon success">
                          <Check size={20} />
                        </span>
                      </div>
                      <strong>{money(t.paid, currency)}</strong>
                      <small>
                        {
                          filtered.filter(
                            (r) => r.data.paid && r.data.currency === currency,
                          ).length
                        }{" "}
                        {incomeView ? "received payments" : "paid payments"}
                      </small>
                    </div>
                    <div className="total-card">
                      <span>Total value · {currency}</span>
                      <strong>{money(t.paid + t.unpaid, currency)}</strong>
                      <small>Paid / received + unpaid / expected</small>
                    </div>
                  </React.Fragment>
                ))
              ) : (
                <>
                  <div className="total-card unpaid">
                    <span>{incomeView ? "Expected rent" : "Total unpaid"}</span>
                    <strong>{money(0, a.prefs.currency)}</strong>
                    <small>No payments in this view</small>
                  </div>
                  <div className="total-card">
                    <span>{incomeView ? "Total received" : "Total paid"}</span>
                    <strong>{money(0, a.prefs.currency)}</strong>
                    <small>No payments in this view</small>
                  </div>
                  <div className="total-card">
                    <span>Total value</span>
                    <strong>{money(0, a.prefs.currency)}</strong>
                    <small>No payments in this view</small>
                  </div>
                </>
              )}
            </div>
            <section className="payment-list">
              <div className="list-heading">
                <div>
                  <h2>{title}</h2>
                  <span className="muted">
                    {filtered.length} payments · nearest unpaid first
                  </span>
                </div>
                <div className="search-tools">
                  <label className="search">
                    <Search size={18} />
                    <input
                      aria-label="Search payments"
                      placeholder="Search payments…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <button
                    className={
                      filters ? "filter-button selected" : "filter-button"
                    }
                    aria-label="Filters"
                    aria-expanded={filters}
                    onClick={() => setFilters(!filters)}
                  >
                    <SlidersHorizontal size={18} />
                    <span>Filters</span>
                  </button>
                </div>
              </div>
              {filters && (
                <div className="filters">
                  <label>
                    Type
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                    >
                      <option value="all">All types</option>
                      {types.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.data.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Status
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All statuses</option>
                      <option value="unpaid">Unpaid / expected</option>
                      <option value="paid">Paid / received</option>
                      <option value="overdue">Overdue</option>
                    </select>
                  </label>
                  <label>
                    Due from
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    Due through
                    <input
                      type="date"
                      value={to}
                      min={from}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <button
                    onClick={() => {
                      setFilter("all");
                      setTypeFilter("all");
                      setFrom("");
                      setTo("");
                      setQuery("");
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}
              <div className="table-heading">
                <span>PAYMENT</span>
                <span>DUE DATE</span>
                <span>STATUS</span>
                <span>AMOUNT</span>
                <span />
              </div>
              {filtered.length ? (
                filtered.map((r) => {
                  const p = r.data as Payment,
                    s = paymentStatus(p, day, types),
                    name = types.find((t) => t.id === p.typeId)?.data.name;
                  const pending = a.state.pending.find((x) => x.id === r.id);
                  return (
                    <button
                      className="payment-row"
                      key={r.id}
                      onClick={() => setDetails(r)}
                    >
                      <span className="payment-name">
                        <span
                          className={`type-icon ${name === "Electricity" ? "electricity" : ""}`}
                        >
                          {name === "Mortgage" ? (
                            <Home size={20} />
                          ) : name === "Electricity" ? (
                            <Zap size={20} />
                          ) : (
                            <FileText size={20} />
                          )}
                        </span>
                        <span>
                          <strong>{p.description || name}</strong>
                          <small>
                            {name}
                            {p.reference ? " · " + p.reference : ""}
                            {p.recurrence !== "none" ? " · Repeats" : ""}
                            {p.attachment ? " · Receipt" : ""}
                          </small>
                        </span>
                      </span>
                      <span className="due-date">
                        {displayDate(p.due)}
                        <small>
                          {pending
                            ? pending.error
                              ? "Sync failed"
                              : "Pending sync"
                            : owner === "demo"
                              ? "Local"
                              : "Saved"}
                        </small>
                      </span>
                      <span
                        className={`badge ${s.toLowerCase().replace(" ", "-")}`}
                      >
                        {(s === "Paid" || s === "Received") && (
                          <Check size={13} />
                        )}{" "}
                        {s}
                      </span>
                      <strong className="row-amount">
                        {money(p.amount, p.currency)}
                      </strong>
                      <ChevronRight size={18} />
                    </button>
                  );
                })
              ) : (
                <div className="empty">
                  <span className="empty-icon">
                    <Wallet size={28} />
                  </span>
                  <h3>
                    {payments.length
                      ? "No matching payments"
                      : "A fresh start for your payments"}
                  </h3>
                  <p>
                    {payments.length
                      ? "Try adjusting your search or filters."
                      : "Add your first payment to see what’s coming up."}
                  </p>
                  <button
                    className="primary"
                    disabled={!types.length || a.syncing}
                    onClick={() => setForm(null)}
                  >
                    <Plus size={18} />
                    Add payment
                  </button>
                </div>
              )}
            </section>
            <p className="page-foot">
              Dates follow {a.prefs.timezone}.{" "}
              {owner === "demo"
                ? "Preview data stays on this device."
                : a.state.pending.length
                  ? `${a.state.pending.length} changes pending`
                  : "Your payments are saved to your account."}
            </p>
          </>
        ) : panel === "cash" || panel === "forecast" ? (
          a.advanced ? (
            <CashWorkspace
              rows={a.state.rows}
              day={day}
              currency={a.prefs.currency}
              change={a.change}
              forecastOnly={panel === "forecast"}
            />
          ) : (
            <section className="settings-card">
              <h1>Backend update required</h1>
              <p>
                Apply <code>supabase/migrations/002_cash_and_income.sql</code>{" "}
                in your Supabase SQL Editor to enable cash and income tracking.
                Existing payments continue to work. The app checks again when
                online.
              </p>
              <a
                href="https://github.com/alharthi2602/duetrack/blob/main/supabase/migrations/002_cash_and_income.sql"
                target="_blank"
                rel="noreferrer"
              >
                Open migration SQL
              </a>
            </section>
          )
        ) : panel === "types" ? (
          <>
            <div className="page-heading">
              <div>
                <h1>Payment types</h1>
                <p className="muted">Organize your tabs to fit your life.</p>
              </div>
              <button
                className="primary"
                disabled={a.syncing}
                onClick={() => setTypeEditor(null)}
              >
                <Plus size={18} />
                Add type
              </button>
            </div>
            <div className="settings-card">
              {types.map((t, i) => (
                <div className="type-item" key={t.id}>
                  <strong>
                    {t.data.name}
                    <small className="type-direction">
                      {t.data.direction === "income" ? "Income" : "Expense"}
                    </small>
                  </strong>
                  <span>
                    {payments.filter((p) => p.data.typeId === t.id).length}{" "}
                    payments
                  </span>
                  <button
                    disabled={a.syncing || i === 0}
                    aria-label={`Move ${t.data.name} up`}
                    onClick={() =>
                      void act(() => a.change(reorderTypes(types, i, -1)))
                    }
                  >
                    <ArrowUp size={18} />
                  </button>
                  <button
                    disabled={a.syncing || i === types.length - 1}
                    aria-label={`Move ${t.data.name} down`}
                    onClick={() =>
                      void act(() => a.change(reorderTypes(types, i, 1)))
                    }
                  >
                    <ArrowDown size={18} />
                  </button>
                  <button
                    disabled={a.syncing}
                    aria-label={`Rename ${t.data.name}`}
                    onClick={() => setTypeEditor(t)}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    disabled={a.syncing}
                    aria-label={`Delete ${t.data.name}`}
                    onClick={() => {
                      if (!canDeleteType(t.id, a.state.rows)) {
                        setError(
                          "This type contains payments or cash entries. Move or delete those records before deleting the type.",
                        );
                        return;
                      }
                      if (confirm(`Delete ${t.data.name}?`))
                        void act(() => a.change([{ ...t, deleted: true }]));
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <h1>Settings & backup</h1>
                <p className="muted">
                  Make DueTrack yours. Keep a copy of your records.
                </p>
              </div>
            </div>
            <section className="settings-card">
              <h2>Preferences</h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const old = a.state.rows.find(
                    (r) => r.kind === "preferences" && !r.deleted,
                  );
                  void act(async () =>
                    a.change([
                      {
                        id:
                          old?.id || (await occurrenceId(owner, "preferences")),
                        kind: "preferences",
                        version: old?.version || 0,
                        deleted: false,
                        data: {
                          currency: f.get("currency"),
                          timezone: f.get("timezone"),
                          theme: f.get("theme"),
                        },
                      },
                    ]),
                  );
                }}
              >
                <label>
                  Default currency
                  <select name="currency" defaultValue={a.prefs.currency}>
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
                  <small>
                    Applies to new payments. Existing amounts retain their
                    currency.
                  </small>
                </label>
                <label>
                  Account time zone
                  <input
                    name="timezone"
                    defaultValue={a.prefs.timezone}
                    required
                    list="timezones"
                  />
                  <datalist id="timezones">
                    {[
                      "Asia/Dubai",
                      "Europe/London",
                      "America/New_York",
                      "Asia/Kolkata",
                      "UTC",
                    ].map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Theme
                  <select name="theme" defaultValue={a.prefs.theme}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">Use device setting</option>
                  </select>
                </label>
                <button className="primary" disabled={a.syncing}>
                  Save preferences
                </button>
              </form>
            </section>
            <section className="settings-card">
              <h2>Backup & restore</h2>
              <p className="muted">
                Download one ZIP with your payments, types, cash accounts, cash
                entries, preferences and receipts. Store it somewhere private.
                Maximum import size: 100 MB.
              </p>
              <div className="actions">
                <button
                  disabled={busy || a.syncing}
                  onClick={() =>
                    void act(async () => {
                      setBusy(true);
                      try {
                        const b = await exportBackup(
                            owner,
                            a.state.rows,
                            setNotice,
                          ),
                          u = URL.createObjectURL(b),
                          l = document.createElement("a");
                        l.href = u;
                        l.download = `duetrack-${day}.zip`;
                        l.click();
                        setTimeout(() => URL.revokeObjectURL(u), 60000);
                        setNotice("Backup downloaded.");
                      } finally {
                        setBusy(false);
                      }
                    })
                  }
                >
                  <Download size={18} />
                  Export backup
                </button>
                <label className="button">
                  <Upload size={18} />
                  Import backup
                  <input
                    className="visually-hidden"
                    type="file"
                    accept=".zip"
                    disabled={busy || a.syncing}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void act(async () => {
                          setBackup(
                            inspectBackup(
                              new Uint8Array(await f.arrayBuffer()),
                            ),
                          );
                        });
                    }}
                  />
                </label>
              </div>
              {backup && (
                <div className="notice">
                  <strong>Restore preview</strong>
                  <p>
                    {
                      backup.backup.rows.filter(
                        (r) => r.kind === "cash_account",
                      ).length
                    }{" "}
                    cash accounts ·{" "}
                    {
                      backup.backup.rows.filter((r) => r.kind === "cash_entry")
                        .length
                    }{" "}
                    cash entries
                  </p>
                  <p>
                    {
                      backup.backup.rows.filter((r) => r.kind === "payment")
                        .length
                    }{" "}
                    payments,{" "}
                    {backup.backup.rows.filter((r) => r.kind === "type").length}{" "}
                    types,{" "}
                    {backup.backup.rows.filter((r) => r.data.attachment).length}{" "}
                    receipts.
                  </p>
                  <p>
                    Merge updates matching IDs. Replace removes current records
                    missing from this backup. Changes synchronize after restore.
                  </p>
                  <div className="actions">
                    {["Merge", "Replace"].map((mode) => (
                      <button
                        key={mode}
                        disabled={busy || a.syncing}
                        onClick={() =>
                          void act(async () => {
                            if (
                              !confirm(
                                `${mode} these records? ${mode === "Replace" ? "Current records absent from the backup will be deleted." : ""}`,
                              )
                            )
                              return;
                            setBusy(true);
                            try {
                              setNotice("Restoring receipts and records…");
                              await stageReceipts(owner, backup);
                              const rows = restorePlan(
                                a.state.rows,
                                backup.backup.rows,
                                mode as "Merge" | "Replace",
                              );
                              await a.change(rows);
                              setBackup(null);
                              setNotice(
                                "Restore applied locally. Check sync status for cloud confirmation.",
                              );
                            } finally {
                              setBusy(false);
                            }
                          })
                        }
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
            <section className="settings-card">
              <h2>Install on your Samsung</h2>
              <p>
                Open this HTTPS page in Chrome, tap the ⋮ menu, then{" "}
                <strong>Add to Home screen → Install</strong>. In Samsung
                Internet, use the menu’s{" "}
                <strong>Add page to → Home screen</strong> option when
                available. Sign in with the same account on each device.
              </p>
              <p className="muted">
                Open the app online once to cache the interface and synchronize
                payments. Receipts you view or download are available offline on
                that device.
              </p>
            </section>
            <button
              className="mobile-signout"
              onClick={() =>
                void act(async () => {
                  if (await a.signout()) leave();
                })
              }
            >
              Sign out
            </button>
          </>
        )}
        {a.state.pending
          .filter((p) => p.remote)
          .map((p) => (
            <section className="conflict settings-card" key={p.id}>
              <h2>Resolve a conflicting edit</h2>
              <p>
                This record changed on another device. Choose which version to
                keep.
              </p>
              <div className="conflict-grid">
                <div>
                  <strong>Your edit</strong>
                  <ConflictSummary row={p.row} />
                </div>
                <div>
                  <strong>
                    Saved account version {p.remote?.deleted ? "(deleted)" : ""}
                  </strong>
                  <ConflictSummary row={p.remote!} />
                </div>
              </div>
              <button
                disabled={a.syncing}
                onClick={() => void act(() => a.change([{ ...p.remote! }]))}
              >
                Keep account version
              </button>
              <button
                disabled={a.syncing || p.remote?.deleted}
                onClick={() =>
                  void act(() =>
                    a.change([{ ...p.row, version: p.remote!.version }]),
                  )
                }
              >
                Keep my edit
              </button>
              {p.remote?.deleted && (
                <p>
                  The account record was deleted. Keep the deletion; add a new
                  payment if needed.
                </p>
              )}
            </section>
          ))}
      </main>
      <nav className="mobile-nav">
        <button
          className={panel === "cash" ? "active" : ""}
          onClick={() => setPanel("cash")}
        >
          <Wallet size={20} />
          Cash
        </button>
        <button
          className={panel === "forecast" ? "active" : ""}
          onClick={() => setPanel("forecast")}
        >
          <Cloud size={20} />
          Forecast
        </button>
        <button className={!panel ? "active" : ""} onClick={() => setPanel("")}>
          <Wallet size={20} />
          Payments
        </button>
        <button
          className={panel === "types" ? "active" : ""}
          onClick={() => setPanel("types")}
        >
          <SlidersHorizontal size={20} />
          Types
        </button>
        <button
          className={panel === "settings" ? "active" : ""}
          onClick={() => setPanel("settings")}
        >
          <Settings size={20} />
          Settings
        </button>
      </nav>
      {typeEditor !== undefined && (
        <PaymentTypeForm
          name={typeEditor?.data.name}
          direction={typeEditor?.data.direction || "expense"}
          incomeEnabled={a.advanced}
          directionLocked={
            !!typeEditor &&
            payments.some((p) => p.data.typeId === typeEditor.id)
          }
          syncing={a.syncing}
          onClose={() => setTypeEditor(undefined)}
          onSave={async (name, direction) => {
            if (typeEditor) {
              const latest = a.state.rows.find(
                (r) => r.id === typeEditor.id && !r.deleted,
              );
              if (!latest)
                throw Error(
                  "This type was deleted on another device. Close this form and add a new type.",
                );
              if (
                payments.some((p) => p.data.typeId === latest.id) &&
                direction !== (latest.data.direction || "expense")
              )
                throw Error("Direction is fixed while payments exist");
              const renamed = renameType(latest, name);
              await a.change([
                { ...renamed, data: { ...renamed.data, direction } },
              ]);
            } else {
              await a.change([
                {
                  id: crypto.randomUUID(),
                  kind: "type",
                  version: 0,
                  deleted: false,
                  data: { name, direction, order: types.length },
                },
              ]);
            }
          }}
        />
      )}
      {form !== undefined && (
        <PaymentForm
          row={form || undefined}
          types={types}
          prefs={a.prefs}
          owner={owner}
          onSave={save}
          onClose={() => setForm(undefined)}
        />
      )}
      {details && (
        <div className="overlay">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-title"
          >
            <header>
              <h2 id="detail-title">Payment details</h2>
              <button onClick={() => setDetails(null)} aria-label="Close">
                <X />
              </button>
            </header>
            <div className="detail-amount">
              {money(details.data.amount, details.data.currency)}
            </div>
            <dl>
              {[
                ["Due date", displayDate(details.data.due)],
                ["Invoice date", displayDate(details.data.invoice)],
                ["Reference code", details.data.reference || "—"],
                ["Description", details.data.description || "—"],
                ["Proof of payment", details.data.attachment?.name || "None"],
                ["Status", paymentStatus(details.data, day, types)],
                [
                  detailsIncome ? "Received date" : "Payment date",
                  displayDate(details.data.paymentDate),
                ],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {details.data.attachment && (
              <>
                <p className="muted">
                  {offlineFiles.has(details.data.attachment.id)
                    ? "Receipt available offline"
                    : "Receipt requires connectivity until viewed"}
                </p>
                <div className="actions">
                  <button onClick={() => void viewReceipt(details)}>
                    View receipt
                  </button>
                  <button onClick={() => void viewReceipt(details, true)}>
                    Download
                  </button>
                </div>
              </>
            )}
            <div className="actions detail-actions">
              <button
                disabled={a.syncing}
                className="primary"
                onClick={() => {
                  setForm(details);
                  setDetails(null);
                }}
              >
                <Pencil size={16} />
                Edit payment
              </button>
              <button
                disabled={a.syncing}
                onClick={() =>
                  void act(async () => {
                    if (details.data.paid) {
                      await a.change([
                        {
                          ...details,
                          data: {
                            ...details.data,
                            paid: false,
                            paymentDate: "",
                          },
                        },
                      ]);
                      setDetails(null);
                    } else {
                      setForm({
                        ...details,
                        data: { ...details.data, paid: true, paymentDate: day },
                      });
                      setDetails(null);
                    }
                  })
                }
              >
                {detailsIncome
                  ? details.data.paid
                    ? "Mark not received"
                    : "Mark received"
                  : details.data.paid
                    ? "Mark unpaid"
                    : "Mark paid"}
              </button>
              {details.data.seriesId && (
                <button
                  disabled={a.syncing}
                  onClick={() =>
                    void act(async () => {
                      const anchor = details.data.anchor || details.data.due;
                      const series = payments.filter(
                        (r) => r.data.seriesId === details.data.seriesId,
                      );
                      let offset = 1,
                        last = series.reduce(
                          (s, r) => (r.data.due > s ? r.data.due : s),
                          anchor,
                        );
                      while (
                        nextDate(anchor, details.data.recurrence, offset) <=
                        last
                      )
                        offset++;
                      const generated = await generate(
                        { ...details.data, due: anchor },
                        offset + 11,
                      );
                      await a.change(
                        generated.filter(
                          (r) =>
                            r.data.due > last &&
                            !a.state.rows.some((x) => x.id === r.id),
                        ),
                      );
                      setDetails(null);
                      setNotice("Added 12 future unpaid occurrences.");
                    })
                  }
                >
                  <Repeat size={16} />
                  Extend by 12
                </button>
              )}
              <button
                className="danger"
                disabled={a.syncing}
                onClick={() => {
                  if (
                    confirm(
                      "Delete this payment and its receipt? This also deletes it from your other devices.",
                    )
                  )
                    void act(async () => {
                      await a.change([{ ...details, deleted: true }]);
                      setDetails(null);
                    });
                }}
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
