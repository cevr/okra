import { describe, expect, test } from "effect-bun-test";
import { collapseHome, expandHome } from "../../src/shared/home.js";

describe("expandHome", () => {
  test("expands ~ and ~/rest", () => {
    expect(expandHome("~", "/home/me")).toBe("/home/me");
    expect(expandHome("~/Developer/okra", "/home/me")).toBe("/home/me/Developer/okra");
  });

  test("leaves other paths unchanged", () => {
    expect(expandHome("/Users/me/x", "/home/me")).toBe("/Users/me/x");
    expect(expandHome("./x", "/home/me")).toBe("./x");
    expect(expandHome("~other/x", "/home/me")).toBe("~other/x");
  });
});

describe("collapseHome", () => {
  test("collapses paths under home", () => {
    expect(collapseHome("/Users/me", "/Users/me")).toBe("~");
    expect(collapseHome("/Users/me/Developer/okra", "/Users/me")).toBe("~/Developer/okra");
  });

  test("leaves paths outside home unchanged", () => {
    expect(collapseHome("/Users/meta/x", "/Users/me")).toBe("/Users/meta/x");
    expect(collapseHome("/tmp/x", "/Users/me")).toBe("/tmp/x");
    expect(collapseHome("/tmp/x", "")).toBe("/tmp/x");
    expect(collapseHome("/tmp/x", "/")).toBe("/tmp/x");
  });

  test("round-trips through expandHome on another machine", () => {
    const portable = collapseHome("/Users/me/Developer/okra/skills/repo", "/Users/me");
    expect(expandHome(portable, "/home/exedev")).toBe("/home/exedev/Developer/okra/skills/repo");
  });
});
