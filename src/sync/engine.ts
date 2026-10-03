import { cloud } from "../auth/client";
import { Row } from "../payments/model";
import { Snapshot, reconcile } from "./store";
import { upload } from "../attachments/service";
export async function synchronize(
  owner: string,
  s: Snapshot,
  progress: (n: number) => void,
): Promise<Snapshot> {
  if (!cloud) throw Error("Cloud setup is required");
  let result: Snapshot = { rows: [...s.rows], pending: [] };
  for (const p of s.pending) {
    try {
      if (p.remote) {
        result.pending.push(p);
        continue;
      }
      if (p.row.data.attachment && !p.row.deleted) {
        const a = p.row.data.attachment;
        const { data: existing } = await cloud.storage
          .from("receipts")
          .info(`${owner}/${a.id}`);
        if (!existing) await upload(owner, a, progress);
      }
      const { data, error } = await cloud.rpc("apply_change", {
        p_id: p.id,
        p_kind: p.row.kind,
        p_data: p.row.data,
        p_deleted: p.row.deleted,
        p_base: p.base,
        p_mutation: p.mutation,
      });
      if (error) throw error;
      if (data.conflict) {
        result.pending.push({
          ...p,
          remote: data.row,
          error: "Changed on another device",
        });
        continue;
      }
      result.rows = result.rows.map((r) => (r.id === p.id ? data.row : r));
    } catch (e) {
      result.pending.push({
        ...p,
        error:
          e && typeof e === "object" && "message" in e
            ? String(e.message)
            : "Could not save. Check your connection and retry.",
      });
    }
  }
  return reconcile(result, await fetchRows());
}
export async function fetchRows(): Promise<Row[]> {
  if (!cloud) throw Error("Cloud setup is required");
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await cloud
      .from("records")
      .select("id,kind,data,version,deleted,updated_at")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw Error("Could not refresh payments");
    rows.push(...((data || []) as Row[]));
    if (!data || data.length < 1000) return rows;
  }
}
