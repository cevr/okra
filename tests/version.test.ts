import { describe, expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import { resolveVersion } from "../src/version.js";

describe("package executable", () => {
  test("maps okra to the Bun entry point", () => {
    expect(packageJson.bin).toEqual({ okra: "src/main.ts" });
  });

  test("uses the package version when no compiled version exists", () => {
    expect(resolveVersion()).toBe(packageJson.version);
  });
});
