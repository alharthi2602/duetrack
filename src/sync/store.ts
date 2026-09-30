import { openDB } from "idb";
import { Row } from "../payments/model";
export interface Pending {
  id: string;
  row: Row;
  base: number;
  mutation: string;
  error?: string;
  remote?: Row;
}
export interface Snapshot {
  rows: Row[];
  pending: Pending[];
}
const db = () =>
  openDB("duetrack-v1", 1, {
    upgrade(db) {
      db.createObjectStore("accounts");
      db.createObjectStore("files");
    },
  });
export async function readAccount(id: string): Promise<Snapshot> {
  return (await (await db()).get("accounts", id)) || { rows: [], pending: [] };
}
export async function saveAccount(id: string, s: Snapshot) {
  await (await db()).put("accounts", s, id);
}
export async function filePut(owner: string, id: string, blob: Blob) {
  await (
    await db()
  ).put("files", { blob, storedAt: Date.now() }, `${owner}:${id}`);
}
export async function fileGet(
  owner: string,
  id: string,
): Promise<Blob | undefined> {
  const file = await (await db()).get("files", `${owner}:${id}`);
  return file instanceof Blob ? file : file?.blob;
}
export async function clearAccount(owner: string) {
  const d = await db();
  await d.delete("accounts", owner);
  for (const key of await d.getAllKeys("files"))
    if (String(key).startsWith(owner + ":")) await d.delete("files", key);
}
export function queue(s: Snapshot, row: Row): Snapshot {
  const old = s.pending.find((p) => p.id === row.id);
  const pending: Pending = {
    id: row.id,
    row,
    base: old?.remote ? row.version : (old?.base ?? row.version),
    mutation: crypto.randomUUID(),
  };
  return {
    rows: [...s.rows.filter((r) => r.id !== row.id), row],
    pending: [...s.pending.filter((p) => p.id !== row.id), pending],
  };
}
export function reconcile(s: Snapshot, remote: Row[]): Snapshot {
  const pendingIds = new Set(s.pending.map((p) => p.id));
  return {
    pending: s.pending,
    rows: [
      ...remote.filter((r) => !pendingIds.has(r.id)),
      ...s.rows.filter((r) => pendingIds.has(r.id)),
    ],
  };
}

export async function cleanLocalFiles(owner: string, rows: Row[]) {
  const d = await db(),
    live = new Set(
      rows.filter((r) => !r.deleted).map((r) => r.data.attachment?.id),
    );
  for (const key of await d.getAllKeys("files")) {
    if (
      !String(key).startsWith(owner + ":") ||
      live.has(String(key).slice(owner.length + 1))
    )
      continue;
    const file = await d.get("files", key);
    if (file.storedAt && file.storedAt < Date.now() - 86400000)
      await d.delete("files", key);
  }
}
