import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { Row, validateRow } from "../payments/model";
import { filePut } from "../sync/store";
import { receipt } from "../attachments/service";
export interface Backup {
  format: "duetrack";
  version: 1;
  exportedAt: string;
  rows: Row[];
}
export async function exportBackup(
  owner: string,
  rows: Row[],
  progress: (s: string) => void,
) {
  const files: Record<string, Uint8Array> = {};
  const active = rows.filter((r) => !r.deleted);
  for (const r of active)
    if (r.data.attachment) {
      progress(`Collecting receipt: ${r.data.attachment.name}`);
      files[`receipts/${r.data.attachment.id}`] = new Uint8Array(
        await (await receipt(owner, r.data.attachment)).arrayBuffer(),
      );
    }
  files["backup.json"] = strToU8(
    JSON.stringify({
      format: "duetrack",
      version: 1,
      exportedAt: new Date().toISOString(),
      rows: active,
    }),
  );
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], {
    type: "application/zip",
  });
}
export function inspectBackup(bytes: Uint8Array) {
  if (bytes.length > 100 * 1024 * 1024) throw Error("Backup exceeds 100 MB");
  let expanded = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      expanded += f.originalSize;
      if (expanded > 100 * 1024 * 1024)
        throw Error("Expanded backup exceeds 100 MB");
      return true;
    },
  });
  if (!files["backup.json"]) throw Error("Missing backup manifest");
  const b = JSON.parse(strFromU8(files["backup.json"])) as Backup;
  if (
    b.format !== "duetrack" ||
    b.version !== 1 ||
    !Array.isArray(b.rows) ||
    b.rows.length > 10000
  )
    throw Error("Unsupported backup format");
  if (b.rows.filter((r) => r.kind === "preferences").length > 1)
    throw Error("Backup contains multiple preferences");
  const ids = new Set<string>();
  let size = 0;
  for (const f of Object.values(files)) {
    size += f.length;
    if (size > 100 * 1024 * 1024) throw Error("Expanded backup exceeds 100 MB");
  }
  for (const r of b.rows) {
    validateRow(r);
    if (r.deleted) throw Error("Backups must contain active records only");
    if (ids.has(r.id)) throw Error("Duplicate record in backup");
    ids.add(r.id);
    if (r.data.attachment) {
      const bytes = files[`receipts/${r.data.attachment.id}`];
      if (!bytes || bytes.length !== r.data.attachment.size)
        throw Error("Receipt missing or invalid");
    }
  }
  for (const r of b.rows)
    if (
      r.kind === "payment" &&
      !b.rows.some(
        (t) => t.kind === "type" && t.id === r.data.typeId && !t.deleted,
      )
    )
      throw Error("Payment type missing");
  return { backup: b, files };
}
export async function stageReceipts(
  owner: string,
  b: ReturnType<typeof inspectBackup>,
) {
  for (const r of b.backup.rows)
    if (r.data.attachment)
      await filePut(
        owner,
        r.data.attachment.id,
        new Blob(
          [
            b.files[
              `receipts/${r.data.attachment.id}`
            ] as Uint8Array<ArrayBuffer>,
          ],
          { type: r.data.attachment.mime },
        ),
      );
}
export function restorePlan(
  current: Row[],
  incoming: Row[],
  mode: "Merge" | "Replace",
) {
  const existingPrefs = current.find(
    (r) => r.kind === "preferences" && !r.deleted,
  );
  const rows = incoming.map((r) => {
    const id =
      r.kind === "preferences" && existingPrefs ? existingPrefs.id : r.id;
    return {
      ...r,
      id,
      version: current.find((x) => x.id === id)?.version || 0,
    };
  });

  if (mode === "Replace")
    rows.push(
      ...current
        .filter((r) => !r.deleted && !rows.some((x) => x.id === r.id))
        .map((r) => ({ ...r, deleted: true })),
    );
  return rows.sort((x, y) => {
    const rank = (r: Row) =>
      r.deleted ? (r.kind === "type" ? 3 : 2) : r.kind === "payment" ? 1 : 0;
    return rank(x) - rank(y);
  });
}
