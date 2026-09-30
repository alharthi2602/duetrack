import { Payment, Row } from "../payments/model";
export function nextDate(
  anchor: string,
  frequency: "monthly" | "yearly",
  offset: number,
) {
  const [y, m, d] = anchor.split("-").map(Number);
  const month = frequency === "monthly" ? m - 1 + offset : m - 1;
  const year = frequency === "yearly" ? y + offset : y;
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export async function occurrenceId(seriesId: string, due: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${seriesId}:${due}`),
  );
  const h = Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function generate(p: Payment, count = 12): Promise<Row[]> {
  if (p.recurrence === "none") return [];
  const anchor = p.anchor || p.due,
    seriesId = p.seriesId!;
  const rows: Row[] = [];
  for (let i = 1; i <= count; i++) {
    const due = nextDate(anchor, p.recurrence, i);
    rows.push({
      id: await occurrenceId(seriesId, due),
      kind: "payment",
      version: 0,
      deleted: false,
      data: {
        ...p,
        due,
        invoice: "",
        paid: false,
        paymentDate: "",
        attachment: undefined,
        anchor,
      },
    });
  }
  return rows;
}
// Maintain a rolling window; tombstones count as existing occurrences.
export async function replenish(rows: Row[], day: string) {
  const series = new Map<string, Row>();
  for (const r of rows)
    if (
      r.kind === "payment" &&
      !r.deleted &&
      r.data.seriesId &&
      r.data.recurrence !== "none"
    ) {
      const old = series.get(r.data.seriesId);
      if (!old || r.data.due > old.data.due) series.set(r.data.seriesId, r);
    }
  const known = new Set(rows.map((r) => r.id)),
    out: Row[] = [];
  for (const template of series.values()) {
    const p = template.data as Payment,
      anchor = p.anchor || p.due;
    const [ay, am] = anchor.split("-").map(Number),
      [dy, dm] = day.split("-").map(Number);
    const offset = Math.max(
      1,
      p.recurrence === "monthly" ? (dy - ay) * 12 + dm - am : dy - ay,
    );
    for (let i = offset; i < offset + 12; i++) {
      const due = nextDate(anchor, p.recurrence as "monthly" | "yearly", i),
        id = await occurrenceId(p.seriesId!, due);
      if (
        due < day ||
        known.has(id) ||
        rows.some(
          (r) =>
            r.kind === "payment" &&
            r.data.seriesId === p.seriesId &&
            r.data.due === due,
        )
      )
        continue;
      out.push({
        id,
        kind: "payment",
        version: 0,
        deleted: false,
        data: {
          ...p,
          due,
          invoice: "",
          paid: false,
          paymentDate: "",
          attachment: undefined,
        },
      });
    }
  }
  return out;
}
export function planSeriesEdit(
  current: Row[],
  edit: Row,
  future: boolean,
): Row[] {
  const original = current.find((r) => r.id === edit.id);
  if (!original?.data.seriesId) return [edit];
  const changedSchedule =
    edit.data.due !== original.data.due ||
    edit.data.recurrence !== original.data.recurrence;
  if (!future) {
    if (edit.data.recurrence !== original.data.recurrence)
      throw Error("Choose future occurrences to change the repeat schedule.");
    if (
      current.some(
        (r) =>
          r.id !== edit.id &&
          r.kind === "payment" &&
          r.data.seriesId === edit.data.seriesId &&
          r.data.due === edit.data.due,
      )
    )
      throw Error(
        "Another occurrence uses this due date. Choose another date or apply the change to future occurrences.",
      );
    return [edit];
  }
  const series = current.filter(
    (r) =>
      r.kind === "payment" &&
      !r.deleted &&
      r.data.seriesId === original.data.seriesId,
  );
  const later = series
    .filter(
      (r) => r.id !== edit.id && r.data.due > original.data.due && !r.data.paid,
    )
    .sort((a, b) => a.data.due.localeCompare(b.data.due));
  const newSeries = changedSchedule ? crypto.randomUUID() : edit.data.seriesId;
  const first = {
    ...edit,
    data: {
      ...edit.data,
      seriesId: newSeries,
      anchor: changedSchedule ? edit.data.due : edit.data.anchor,
    },
  };
  const updated = later.map((r, index) => ({
    ...r,
    data: {
      ...r.data,
      amount: edit.data.amount,
      currency: edit.data.currency,
      typeId: edit.data.typeId,
      description: edit.data.description,
      reference: edit.data.reference,
      recurrence: edit.data.recurrence,
      seriesId: newSeries,
      anchor: first.data.anchor,
      due:
        changedSchedule && edit.data.recurrence !== "none"
          ? nextDate(edit.data.due, edit.data.recurrence, index + 1)
          : r.data.due,
    },
  }));
  // Retire the previous schedule while preserving dates, status, and receipts of history/paid records.
  const retired = changedSchedule
    ? series
        .filter((r) => r.id !== edit.id && !later.some((x) => x.id === r.id))
        .map((r) => ({ ...r, data: { ...r.data, recurrence: "none" } }))
    : [];
  return [first, ...updated, ...retired];
}
