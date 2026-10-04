import { Row, validateRow } from "./model";

// Each copy is an independent payment. Reusing a recurring occurrence's
// series ID and due date would collide with the schedule's unique constraint.
// Receipt IDs refer to immutable bytes and can safely be shared by copies.
export function duplicatePayment(source: Row): Row {
  if (source.kind !== "payment" || source.deleted)
    throw Error("Choose an active payment to duplicate");
  const data = structuredClone(source.data);
  delete data.seriesId;
  delete data.anchor;
  data.recurrence = "none";
  return validateRow({
    id: crypto.randomUUID(),
    kind: "payment",
    version: 0,
    deleted: false,
    data,
  });
}
