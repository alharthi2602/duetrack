import { Payment } from "../payments/model";
type Attachment = NonNullable<Payment["attachment"]>;

export function CashAttachmentField({attachment, enabled}: {attachment?: Attachment; enabled: boolean}) {
  return <div className="cash-attachment">
    <label>Attachment
      <small>Optional · PDF, JPG, PNG or WebP · up to 10 MB. Selecting a file replaces the current attachment.</small>
      <input type="file" name="attachment" aria-label="Cash attachment" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={!enabled} />
    </label>
    {attachment && <>
      <p className="receipt-name">{attachment.name}</p>
      <label className="check"><input type="checkbox" name="removeAttachment" disabled={!enabled} />Remove current attachment</label>
    </>}
    {!enabled && <p className="notice">Cash attachments need the database update. <a href="https://github.com/alharthi2602/duetrack/blob/main/supabase/migrations/003_cash_attachments.sql" target="_blank" rel="noreferrer">Open migration 003</a>, run it in Supabase SQL Editor, then reconnect. Existing cash records remain usable.</p>}
  </div>;
}

export function CashAttachmentLinks({attachment, label, onView}: {attachment: Attachment; label: string; onView: (download: boolean) => void}) {
  return <section className="cash-attachment" aria-label={`Attachment for ${label}`}>
    <p className="receipt-name">{attachment.name}</p>
    <div className="actions">
      <button type="button" onClick={() => onView(false)}>View attachment</button>
      <button type="button" onClick={() => onView(true)}>Download attachment</button>
    </div>
  </section>;
}
