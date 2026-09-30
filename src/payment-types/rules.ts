import { Row, typeSchema } from "../payments/model";
export function renameType(row: Row, name: string): Row {
  return { ...row, data: typeSchema.parse({ ...row.data, name }) };
}
export function reorderTypes(
  types: Row[],
  index: number,
  direction: -1 | 1,
): Row[] {
  const target = index + direction;
  if (target < 0 || target >= types.length) return [];
  return [
    { ...types[index], data: { ...types[index].data, order: target } },
    { ...types[target], data: { ...types[target].data, order: index } },
  ];
}
export function canDeleteType(typeId: string, rows: Row[]) {
  return !rows.some(
    (r) => r.kind === "payment" && !r.deleted && r.data.typeId === typeId,
  );
}
