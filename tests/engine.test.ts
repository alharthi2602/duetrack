import { describe, it, expect, vi, beforeEach } from "vitest";
import { Row } from "../src/payments/model";
import { restorePlan } from "../src/backup/service";
import { replenish } from "../src/recurrence/rules";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  select: vi.fn(),
  upload: vi.fn(),
  info: vi.fn(),
}));
vi.mock("../src/auth/client", () => ({
  cloud: {
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({ order: () => ({ range: mocks.select }) }),
    }),
    storage: { from: () => ({ info: mocks.info }) },
  },
}));
vi.mock("../src/attachments/service", () => ({
  upload: mocks.upload,
  receipt: vi.fn(),
}));
import { synchronize } from "../src/sync/engine";
const id = "22222222-2222-4222-a222-222222222222",
  type = "11111111-1111-4111-a111-111111111111";
const row: Row = {
  id,
  kind: "payment",
  version: 1,
  deleted: false,
  data: {
    typeId: type,
    amount: 100,
    currency: "AED",
    due: "2026-10-01",
    invoice: "",
    reference: "",
    description: "",
    paid: false,
    paymentDate: "",
    recurrence: "none",
  },
};
const pending = { id, row, base: 1, mutation: crypto.randomUUID() };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockResolvedValue({ data: [row], error: null });
  mocks.rpc.mockResolvedValue({
    data: { row: { ...row, version: 2 }, conflict: false },
    error: null,
  });
  mocks.info.mockResolvedValue({ data: null });
});
describe("Sync recovery", () => {
  it("acknowledges cloud saves", async () => {
    const s = await synchronize(
      "owner",
      { rows: [row], pending: [pending] },
      () => {},
    );
    expect(s.pending).toHaveLength(0);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_change",
      expect.objectContaining({ p_mutation: pending.mutation, p_base: 1 }),
    );
  });
  it("retains failed changes and retries the same mutation", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: Error("unavailable") });
    const s = await synchronize(
      "owner",
      { rows: [row], pending: [pending] },
      () => {},
    );
    expect(s.pending[0].error).toBeTruthy();
    await synchronize("owner", s, () => {});
    expect(mocks.rpc.mock.calls[0][1].p_mutation).toBe(
      mocks.rpc.mock.calls[1][1].p_mutation,
    );
  });
  it("retains conflicts without silently overwriting", async () => {
    mocks.rpc.mockResolvedValue({
      data: { conflict: true, row: { ...row, version: 3 } },
    });
    const s = await synchronize(
      "owner",
      { rows: [row], pending: [pending] },
      () => {},
    );
    expect(s.pending[0].remote?.version).toBe(3);
    expect(s.rows[0].version).toBe(1);
  });
  it("failed uploads do not update payment metadata", async () => {
    mocks.upload.mockRejectedValue(Error("network"));
    const r = { ...row, data: { ...row.data, attachment: { id: type } } };
    const s = await synchronize(
      "owner",
      { rows: [r], pending: [{ ...pending, row: r }] },
      () => {},
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(s.pending[0].row.data.attachment.id).toBe(type);
  });
  it("does not repeat upload for an already stored receipt", async () => {
    mocks.info.mockResolvedValue({ data: { id: type } });
    const r = { ...row, data: { ...row.data, attachment: { id: type } } };
    await synchronize(
      "owner",
      { rows: [r], pending: [{ ...pending, row: r }] },
      () => {},
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalled();
  });
});
describe("Restore plans and recurrence window", () => {
  it("merges stable IDs without duplicates and preserves cloud versions", () => {
    const plan = restorePlan(
      [row],
      [{ ...row, version: 88, data: { ...row.data, amount: 200 } }],
      "Merge",
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].version).toBe(1);
    expect(plan[0].data.amount).toBe(200);
  });
  it("replacement deletes payments before deleting absent types", () => {
    const t: Row = {
      id: type,
      kind: "type",
      version: 1,
      deleted: false,
      data: { name: "Mortgage", order: 0 },
    };
    const plan = restorePlan([t, row], [], "Replace");
    expect(plan.map((r) => r.kind)).toEqual(["payment", "type"]);
    expect(plan.every((r) => r.deleted)).toBe(true);
  });
  it("replenishes idempotently and respects deleted occurrences", async () => {
    const r = {
      ...row,
      data: {
        ...row.data,
        recurrence: "monthly",
        seriesId: type,
        anchor: "2026-10-01",
      },
    };
    const added = await replenish([r], "2026-10-01");
    expect(added).toHaveLength(12);
    expect(await replenish([r, ...added], "2026-10-01")).toHaveLength(0);
    expect(
      await replenish(
        [r, ...added.map((x, i) => (i === 0 ? { ...x, deleted: true } : x))],
        "2026-10-01",
      ),
    ).toHaveLength(0);
  });
});

describe("Future occurrence editing", () => {
  it("changes one occurrence without changing later payments", async () => {
    const { planSeriesEdit } = await import("../src/recurrence/rules");
    const first = {
      ...row,
      data: {
        ...row.data,
        seriesId: type,
        recurrence: "monthly",
        anchor: row.data.due,
      },
    };
    const later = {
      ...first,
      id: crypto.randomUUID(),
      data: { ...first.data, due: "2026-11-01" },
    };
    expect(
      planSeriesEdit(
        [first, later],
        { ...first, data: { ...first.data, amount: 200 } },
        false,
      ),
    ).toHaveLength(1);
  });
  it("reschedules future unpaid records and retains each receipt and paid history", async () => {
    const { planSeriesEdit } = await import("../src/recurrence/rules");
    const first = {
      ...row,
      data: {
        ...row.data,
        seriesId: type,
        recurrence: "monthly",
        anchor: row.data.due,
      },
    };
    const later = {
      ...first,
      id: crypto.randomUUID(),
      data: {
        ...first.data,
        due: "2026-11-01",
        attachment: { id: "own-receipt" },
      },
    };
    const paid = {
      ...first,
      id: crypto.randomUUID(),
      data: {
        ...first.data,
        due: "2026-12-01",
        paid: true,
        paymentDate: "2026-10-01",
      },
    };
    const edit = {
      ...first,
      data: { ...first.data, due: "2026-10-31", amount: 200 },
    };
    const plan = planSeriesEdit([first, later, paid], edit, true);
    expect(plan.find((r) => r.id === later.id)?.data.due).toBe("2026-11-30");
    expect(plan.find((r) => r.id === later.id)?.data.attachment.id).toBe(
      "own-receipt",
    );
    expect(plan.find((r) => r.id === paid.id)?.data.due).toBe("2026-12-01");
    expect(plan.find((r) => r.id === paid.id)?.data.paid).toBe(true);
    expect(plan.find((r) => r.id === paid.id)?.data.recurrence).toBe("none");
  });
  it("stops repeating without deleting already-created payments", async () => {
    const { planSeriesEdit } = await import("../src/recurrence/rules");
    const first = {
      ...row,
      data: {
        ...row.data,
        seriesId: type,
        recurrence: "monthly",
        anchor: row.data.due,
      },
    };
    const later = {
      ...first,
      id: crypto.randomUUID(),
      data: { ...first.data, due: "2026-11-01" },
    };
    const plan = planSeriesEdit(
      [first, later],
      { ...first, data: { ...first.data, recurrence: "none" } },
      true,
    );
    expect(plan).toHaveLength(2);
    expect(plan.every((r) => !r.deleted && r.data.recurrence === "none")).toBe(
      true,
    );
  });
});

describe("overlapping local saves and cloud refresh", () => {
  it("retains a save made during a delayed refresh and uploads it once", async () => {
    const { accountOperations } = await import("../src/sync/operations");
    const { queue } = await import("../src/sync/store");
    const run = accountOperations();
    let state = {
      rows: [row],
      pending: [],
    } as import("../src/sync/store").Snapshot;
    let finish!: () => void;
    const delay = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const refresh = run(async () => {
      await delay;
      state = await synchronize("owner", state, () => {});
    });
    const changed = {
      ...row,
      data: { ...row.data, description: "Bin Ghatti 3" },
    };
    const save = run(async () => {
      state = queue(state, changed);
    });
    finish();
    await Promise.all([refresh, save]);
    expect(state.rows[0].data.description).toBe("Bin Ghatti 3");
    expect(state.pending).toHaveLength(1);
    const mutation = state.pending[0].mutation;
    mocks.rpc.mockResolvedValue({
      data: { row: { ...changed, version: 2 } },
      error: null,
    });
    mocks.select.mockResolvedValue({
      data: [{ ...changed, version: 2 }],
      error: null,
    });
    state = await run(() => synchronize("owner", state, () => {}));
    expect(state.pending).toHaveLength(0);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][1].p_mutation).toBe(mutation);
  });
  it("continues accepting saves after an operation fails", async () => {
    const { accountOperations } = await import("../src/sync/operations");
    const run = accountOperations();
    await expect(
      run(async () => {
        throw Error("Disconnected");
      }),
    ).rejects.toThrow("Disconnected");
    await expect(run(async () => "Saved locally")).resolves.toBe(
      "Saved locally",
    );
  });
});
