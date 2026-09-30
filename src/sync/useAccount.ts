import { useEffect, useRef, useState } from "react";
import { cloud } from "../auth/client";
import { Row, Preferences, today, validateRow } from "../payments/model";
import {
  Snapshot,
  readAccount,
  saveAccount,
  queue,
  clearAccount,
  cleanLocalFiles,
} from "./store";
import { synchronize, fetchRows } from "./engine";
import { occurrenceId, replenish } from "../recurrence/rules";
import { defaults } from "../settings/preferences";
export function useAccount(owner: string) {
  const [state, setState] = useState<Snapshot>({ rows: [], pending: [] });
  const current = useRef(state),
    busy = useRef(false);
  const [ready, setReady] = useState(false),
    [syncing, setSyncing] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0);
  const mounted = useRef(true);
  const demo = owner === "demo";
  async function commit(s: Snapshot) {
    if (!mounted.current) return;
    await saveAccount(owner, s);
    if (!mounted.current) {
      await clearAccount(owner);
      return;
    }
    current.current = s;
    setState(s);
  }
  async function sync() {
    if (busy.current || !navigator.onLine || demo) return;
    busy.current = true;
    setSyncing(true);
    setError("");
    try {
      let next = await synchronize(owner, current.current, setProgress);
      if (!next.pending.length) {
        const preferences =
          next.rows.find((r) => r.kind === "preferences" && !r.deleted)?.data ||
          defaults;
        for (const r of await replenish(next.rows, today(preferences.timezone)))
          next = queue(next, r);
      }
      await commit(next);
      if (mounted.current) await cleanLocalFiles(owner, next.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setSyncing(false);
      setProgress(0);
    }
  }
  async function change(rows: Row[]) {
    if (busy.current) throw Error("Please wait until synchronization finishes");
    let s = current.current;
    for (const r of rows) s = queue(s, validateRow(r));
    if (demo) s = { rows: s.rows, pending: [] };
    await commit(s);
    void sync();
  }
  useEffect(() => {
    let live = true;
    mounted.current = true;
    readAccount(owner)
      .then(async (s) => {
        if (!live) return;
        if (!s.rows.length) {
          if (!demo && navigator.onLine && cloud) {
            try {
              s.rows = await fetchRows();
            } catch {
              setError("Could not load account. Reconnect and retry.");
              setReady(true);
              return;
            }
          }
          const types = await Promise.all(
            ["Mortgage", "Electricity"].map(async (name, order) => ({
              id: await occurrenceId(owner, name),
              kind: "type" as const,
              version: 0,
              deleted: false,
              data: { name, order },
            })),
          );
          if (!s.rows.length) s = types.reduce(queue, s);
          if (demo) s = { rows: s.rows, pending: [] };
          await commit(s);
        } else {
          current.current = s;
          setState(s);
        }
        setReady(true);
        void sync();
      })
      .catch(() => {
        setError(
          "Could not open private local storage. Check browser storage permissions and retry.",
        );
        setReady(true);
      });
    const refresh = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(refresh, 15000);
    const channel =
      cloud && !demo
        ? cloud
            .channel(`records:${owner}`)
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "records",
                filter: `owner=eq.${owner}`,
              },
              refresh,
            )
            .subscribe()
        : null;
    return () => {
      live = false;
      mounted.current = false;
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(interval);
      if (channel) void cloud?.removeChannel(channel);
    };
  }, [owner]);
  const prefs =
    (state.rows.find((r) => r.kind === "preferences" && !r.deleted)
      ?.data as Preferences) || defaults;
  async function signout() {
    if (busy.current) return false;
    if (
      current.current.pending.length &&
      !confirm(
        "Unsynchronized changes will be discarded on this device. Sign out?",
      )
    )
      return false;
    await clearAccount(owner);
    await cloud?.auth.signOut();
    return true;
  }
  return {
    state,
    ready,
    syncing,
    error,
    progress,
    prefs,
    change,
    sync,
    signout,
  };
}
