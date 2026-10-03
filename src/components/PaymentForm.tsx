import { useState } from "react";
import {
  Row,
  Payment,
  paymentSchema,
  minorUnits,
  amountInput,
  today,
  errorMessage,
  isIncome,
} from "../payments/model";
import { generate } from "../recurrence/rules";
import { metadata } from "../attachments/service";
import { filePut } from "../sync/store";
export function PaymentForm({
  row,
  types,
  prefs,
  owner,
  onSave,
  onClose,
}: {
  row?: Row;
  types: Row[];
  prefs: any;
  owner: string;
  onSave: (r: Row[], future: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const p = row?.data as Payment | undefined;
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [attachment, setAttachment] = useState(p?.attachment),
    [future, setFuture] = useState(false),
    [paid, setPaid] = useState(p?.paid || false);
  const [typeId, setTypeId] = useState(p?.typeId || types[0]?.id || "");
  const income = isIncome(types, typeId);
  return (
    <div className="overlay">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-title"
      >
        <header>
          <h2 id="form-title">{row ? "Edit payment" : "Add payment"}</h2>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            try {
              const f = new FormData(e.currentTarget),
                currency = String(f.get("currency"));
              const data = paymentSchema.parse({
                typeId: f.get("type"),
                amount: minorUnits(String(f.get("amount")), currency),
                currency,
                due: f.get("due"),
                invoice: f.get("invoice"),
                reference: f.get("reference"),
                description: f.get("description"),
                attachment,
                paid,
                paymentDate: paid ? f.get("paymentDate") : "",
                recurrence: f.get("recurrence"),
                seriesId: p?.seriesId,
                anchor: p?.anchor,
              });
              if (data.recurrence !== "none" && !data.seriesId) {
                data.seriesId = crypto.randomUUID();
                data.anchor = data.due;
              }
              const item: Row = {
                id: row?.id || crypto.randomUUID(),
                kind: "payment",
                version: row?.version || 0,
                deleted: false,
                data,
              };
              const generated =
                !row || !p?.seriesId ? await generate(data) : [];
              await onSave([item, ...generated], future);
              onClose();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              Amount <span className="required">Required</span>
              <input
                autoFocus
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                required
                defaultValue={p ? amountInput(p.amount, p.currency) : ""}
              />
            </label>
            <label>
              Currency
              <select
                name="currency"
                defaultValue={p?.currency || prefs.currency}
              >
                {["AED", "USD", "EUR", "GBP", "SAR", "INR", "JPY", "KWD"].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          <label>
            Due date <span className="required">Required</span>
            <input
              name="due"
              type="date"
              required
              defaultValue={p?.due || today(prefs.timezone)}
            />
          </label>
          <label>
            Invoice date
            <input name="invoice" type="date" defaultValue={p?.invoice || ""} />
          </label>
          <label>
            Reference code
            <input
              name="reference"
              maxLength={200}
              defaultValue={p?.reference || ""}
              placeholder="e.g. INV-2026-104"
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              maxLength={2000}
              defaultValue={p?.description || ""}
              placeholder="What is this payment for?"
            />
          </label>
          <label>
            Proof of payment{" "}
            <small>Optional · JPG, PNG, WebP or PDF · up to 10 MB</small>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const a = metadata(f);
                  await filePut(owner, a.id, f);
                  setAttachment(a);
                  setError("");
                } catch {
                  setError("Select a JPG, PNG, WebP or PDF up to 10 MB.");
                }
              }}
            />
          </label>
          {attachment && (
            <div className="receipt-name">
              {attachment.name}
              <button type="button" onClick={() => setAttachment(undefined)}>
                Remove
              </button>
            </div>
          )}
          <label>
            Payment type
            <select
              name="type"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.data.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Repeat
            <select name="recurrence" defaultValue={p?.recurrence || "none"}>
              <option value="none">Does not repeat</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <small>
              Creates the next 12 occurrences and keeps the next year ready when
              the app synchronizes. Month-end dates use the last available day.
              Stopping a repeat keeps already created payments as one-off
              records.
            </small>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={paid}
              onChange={(e) => setPaid(e.target.checked)}
            />{" "}
            {income ? "Mark as received" : "Mark as paid"}
          </label>
          {paid && (
            <label>
              {income ? "Received date" : "Payment date"}
              <input
                type="date"
                name="paymentDate"
                required
                defaultValue={p?.paymentDate || today(prefs.timezone)}
              />
            </label>
          )}
          <p className="muted">
            This status does not update cash. Record the actual bank movement
            separately in Cash ledger.
          </p>
          {p?.seriesId && (
            <label className="check">
              <input
                type="checkbox"
                checked={future}
                onChange={(e) => setFuture(e.target.checked)}
              />
              Apply changes to this and future unpaid occurrences. Each keeps
              its own receipt and payment status.
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={saving}>
              {saving ? "Saving…" : "Save payment"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
