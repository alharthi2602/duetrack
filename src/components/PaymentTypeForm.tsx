import { useState } from "react";
import { errorMessage, typeSchema } from "../payments/model";

export function PaymentTypeForm({
  name: initialName,
  syncing,
  onSave,
  onClose,
}: {
  name?: string;
  syncing: boolean;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="overlay">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="type-form-title"
      >
        <header>
          <h2 id="type-form-title">
            {initialName === undefined
              ? "Add payment type"
              : "Rename payment type"}
          </h2>
          <button aria-label="Close" disabled={saving} onClick={onClose}>
            ×
          </button>
        </header>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (syncing || saving) return;
            const parsed = typeSchema.safeParse({ name, order: 0 });
            if (!parsed.success) {
              setError(
                name.trim().length
                  ? "Use no more than 60 characters."
                  : "Enter a payment type name.",
              );
              return;
            }
            setSaving(true);
            setError("");
            try {
              await onSave(parsed.data.name);
              onClose();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          <label htmlFor="type-name">Payment type name</label>
          <input
            id="type-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            aria-invalid={!!error}
            aria-describedby="type-name-help"
          />
          <p id="type-name-help" className="muted">
            Up to 60 characters. Spaces and numbers are welcome.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {syncing && (
            <p role="status">
              Finishing synchronization… Your name stays here.
            </p>
          )}
          <div className="actions">
            <button type="button" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={saving || syncing}
              type="submit"
            >
              {saving ? "Saving…" : "Save type"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
