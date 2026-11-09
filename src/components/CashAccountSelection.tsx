import { Row } from "../payments/model";

export function CashAccountSelection({accounts, selected, onChange}: {accounts: Row[]; selected: string[]; onChange: (ids: string[]) => void}) {
  return <fieldset className="cash-account-selection">
    <legend>Cash accounts</legend>
    <div className="actions">
      <button type="button" disabled={!accounts.length} onClick={() => onChange(accounts.map(a => a.id))}>Select all</button>
      <button type="button" disabled={!selected.length} onClick={() => onChange([])}>Clear</button>
    </div>
    {accounts.map(a => <label className="check" key={a.id}>
      <input type="checkbox" checked={selected.includes(a.id)} onChange={e => onChange(e.target.checked ? [...selected, a.id] : selected.filter(id => id !== a.id))} />
      <span>{a.data.name} · {a.data.currency}</span>
    </label>)}
    {!accounts.length && <p>Create a cash account in Cash ledger first.</p>}
    {!!accounts.length && !selected.length && <p role="status">Select at least one cash account to calculate the forecast.</p>}
  </fieldset>;
}
