import { describe, it, expect } from "vitest";
import { duplicatePayment } from "../src/payments/duplicate";
import { Row } from "../src/payments/model";
const source: Row = {
  id: crypto.randomUUID(),
  kind: "payment",
  version: 4,
  deleted: false,
  data: {
    typeId: crypto.randomUUID(),
    amount: 1875000,
    currency: "AED",
    due: "2026-11-01",
    invoice: "2026-11-01",
    reference: "25%",
    description: "Payment (2/4)",
    paid: true,
    paymentDate: "2026-10-04",
    recurrence: "none",
    attachment: {
      id: crypto.randomUUID(),
      name: "receipt.pdf",
      mime: "application/pdf",
      size: 10,
    },
  },
};
describe("Independent payment copies", () => {
  it("preserves all payment fields and settlement status with a new record identity", () => {
    const copy = duplicatePayment(source);
    expect(copy.data).toEqual(source.data);
    expect(copy.id).not.toBe(source.id);
    expect(copy.version).toBe(0);
    expect(copy.deleted).toBe(false);
    copy.data.description = "Edited copy";
    expect(source.data.description).toBe("Payment (2/4)");
  });
  it("creates a distinct identity for each additional copy", () =>
    expect(duplicatePayment(source).id).not.toBe(duplicatePayment(source).id));
  it("keeps unpaid status and shares immutable receipt identity", () => {
    const data = { ...source.data, paid: false, paymentDate: "" };
    expect(duplicatePayment({ ...source, data }).data).toEqual(data);
  });
  it("detaches recurring occurrences without changing financial data", () => {
    const copy = duplicatePayment({
      ...source,
      data: {
        ...source.data,
        recurrence: "monthly",
        seriesId: crypto.randomUUID(),
        anchor: "2026-01-01",
      },
    });
    expect(copy.data).toEqual(source.data);
  });
  it("rejects deleted or non-payment sources", () => {
    expect(() => duplicatePayment({ ...source, deleted: true })).toThrow(
      "active payment",
    );
    expect(() => duplicatePayment({ ...source, kind: "type" })).toThrow(
      "active payment",
    );
  });
});
