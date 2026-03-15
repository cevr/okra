import { describe, expect, test } from "bun:test";
import { compareMetrics, shouldKeep } from "../../../src/research/scoring.js";

describe("compareMetrics", () => {
  test("min: lower is better", () => {
    expect(compareMetrics(5, 10, "min")).toBe("better");
    expect(compareMetrics(15, 10, "min")).toBe("worse");
    expect(compareMetrics(10, 10, "min")).toBe("equal");
  });

  test("max: higher is better", () => {
    expect(compareMetrics(15, 10, "max")).toBe("better");
    expect(compareMetrics(5, 10, "max")).toBe("worse");
    expect(compareMetrics(10, 10, "max")).toBe("equal");
  });
});

describe("shouldKeep", () => {
  test("keeps better results", () => {
    expect(shouldKeep("min", 5, 10)).toBe(true);
    expect(shouldKeep("max", 15, 10)).toBe(true);
  });

  test("discards worse or equal", () => {
    expect(shouldKeep("min", 15, 10)).toBe(false);
    expect(shouldKeep("min", 10, 10)).toBe(false);
  });
});
