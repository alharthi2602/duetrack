import { useEffect, useRef, useState } from "react";
import { cloud } from "../auth/client";
import { Row, Preferences, today, validateRow } from "../payments/model";
import {
  Snapshot,
  readAccount,
  saveAccount,
  filePut,
  queue,
  clearAccount,
  cleanLocalFiles,
} from "./store";
import { synchronize, fetchRows } from "./engine";
import { occurrenceId, replenish } from "../recurrence/rules";
import { accountOperations } from "./operations";
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
  const operations = useRef(accountOperations());
  const initialized = useRef(false);
  const closing = useRef(false);
  const demo = owner === "demo";
  const [advanced, setAdvanced] = useState(
    owner === "demo" || ["2","3"].includes(localStorage.getItem("duetrack-schema-version") || ""),
  );
  const advancedRef = useRef(advanced);
  const [cashAttachments, setCashAttachments] = useState(demo || localStorage.getItem("duetrack-schema-version") === "3");
  const cashAttachmentsRef = useRef(cashAttachments);
  async function checkCapabilities() {
    if (demo || cashAttachmentsRef.current || !cloud || !navigator.onLine) return;
    const { data, error } = await cloud.rpc("duetrack_capabilities");
    if (!error && data?.cash && data?.income && mounted.current) {
      advancedRef.current = true;
      setAdvanced(true);
      if (data.cashAttachments) {
        cashAttachmentsRef.current = true;
        setCashAttachments(true);
      }
      localStorage.setItem("duetrack-schema-version", data.cashAttachments ? "3" : "2");
    }
  }
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
    if (
      busy.current ||
      !initialized.current ||
      closing.current ||
      !navigator.onLine ||
      demo
    )
      return;
    busy.current = true;
    setSyncing(true);
    setError("");
    try {
      await operations.current(async () => {
        if (!mounted.current || closing.current) return;
        await checkCapabilities();
        let next = await synchronize(owner, current.current, setProgress);
        if (!next.pending.length) {
          const preferences =
            next.rows.find((r) => r.kind === "preferences" && !r.deleted)
              ?.data || defaults;
          for (const r of await replenish(
            next.rows,
            today(preferences.timezone),
          ))
            next = queue(next, r);
        }
        await commit(next);
        if (mounted.current) await cleanLocalFiles(owner, next.rows);
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setSyncing(false);
      setProgress(0);
    }
  }
  async function change(rows: Row[], files: {id: string; blob: Blob}[] = []) {
    const validated = rows.map(validateRow);
    if (!cashAttachmentsRef.current && validated.some(r => !r.deleted && (r.kind === "cash_account" || r.kind === "cash_entry") && r.data.attachment)) throw Error("Apply Supabase migration 003_cash_attachments.sql before adding cash attachments.");
    if (
      !advancedRef.current &&
      validated.some(
        (r) =>
          r.kind === "cash_account" ||
          r.kind === "cash_entry" ||
          (r.kind === "type" && r.data.direction === "income"),
      )
    )
      throw Error(
        "Apply Supabase migration 002_cash_and_income.sql before using cash and income features.",
      );
    await operations.current(async () => {
      if (!mounted.current || closing.current)
        throw Error("The account is signing out. Please sign in again.");
      for (const file of files) await filePut(owner, file.id, file.blob);
      let s = current.current;
      for (const r of validated) s = queue(s, r);
      if (demo) s = { rows: s.rows, pending: [] };
      await commit(s);
    });
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
        initialized.current = true;
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
    if (closing.current) return false;
    closing.current = true;
    try {
      const result = await operations.current(async () => {
        if (
          current.current.pending.length &&
          !confirm(
            "Unsynchronized changes will be discarded on this device. Sign out?",
          )
        )
          return false;
        await cloud?.auth.signOut();
        mounted.current = false;
        await clearAccount(owner);
        return true;
      });
      if (!result) closing.current = false;
      return result;
    } catch (e) {
      closing.current = false;
      throw e;
    }
  }

  return {
    state,
    ready,
    syncing,
    error,
    progress,
    advanced,
    cashAttachments,
    prefs,
    change,
    sync,
    signout,
  };
}
