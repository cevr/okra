import { describe, expect, test } from "bun:test";
import { parseResult } from "../../../src/research/services/Runner.js";

describe("parseResult", () => {
  test("parses single RESULT line", () => {
    const { value, count } = parseResult("RESULT 42.5\n");
    expect(value).toBe(42.5);
    expect(count).toBe(1);
  });

  test("parses scientific notation", () => {
    const { value } = parseResult("RESULT 1.5e3\n");
    expect(value).toBe(1500);
  });

  test("parses negative values", () => {
    const { value } = parseResult("RESULT -7.2\n");
    expect(value).toBe(-7.2);
  });

  test("returns undefined when no RESULT line", () => {
    const { value, count } = parseResult("some other output\n");
    expect(value).toBeUndefined();
    expect(count).toBe(0);
  });

  test("counts multiple RESULT lines", () => {
    const { value, count } = parseResult("RESULT 10\nRESULT 20\n");
    expect(value).toBe(20);
    expect(count).toBe(2);
  });

  test("parses integers", () => {
    const { value } = parseResult("RESULT 100\n");
    expect(value).toBe(100);
  });

  test("parses positive sign", () => {
    const { value } = parseResult("RESULT +12.5\n");
    expect(value).toBe(12.5);
  });

  test("ignores METRIC format", () => {
    const { value } = parseResult("METRIC 42\n");
    expect(value).toBeUndefined();
  });
});
