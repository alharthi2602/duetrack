import { it, expect } from "vitest";
import { totalPercentage } from "../src/payments/model";
it("calculates exact rounded payment proportions including empty and huge totals", () => {
  expect(totalPercentage(321046166n, 576704242n)).toBe("55.67%");
  expect(totalPercentage(255658076n, 576704242n)).toBe("44.33%");
  expect(totalPercentage(0n, 0n)).toBe("0.00%");
  expect(totalPercentage(1n, 3n)).toBe("33.33%");
  expect(totalPercentage(2n, 3n)).toBe("66.67%");
  expect(
    totalPercentage(999999999999999999999999999n, 999999999999999999999999999n),
  ).toBe("100.00%");
});
