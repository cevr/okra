import { describe, expect, test } from "bun:test";
import { buildPromptWithContext } from "../../src/schedule/context.js";
import type { TaskContext } from "../../src/schedule/services/Store.js";

describe("buildPromptWithContext", () => {
  test("returns prompt unchanged when no context", () => {
    expect(buildPromptWithContext("do stuff", "/tmp", undefined)).toBe("do stuff");
  });

  test("includes repo with remote URL", () => {
    const ctx: TaskContext = { gitRepo: "myrepo", gitRemoteUrl: "git@github.com:user/myrepo.git" };
    const result = buildPromptWithContext("do stuff", "/tmp", ctx);
    expect(result).toContain("myrepo");
    expect(result).toContain("git@github.com:user/myrepo.git");
  });

  test("includes branch", () => {
    const ctx: TaskContext = { gitBranch: "feature/test" };
    const result = buildPromptWithContext("do stuff", "/tmp", ctx);
    expect(result).toContain("Branch: feature/test");
  });

  test("wraps in context tags", () => {
    const ctx: TaskContext = { gitBranch: "main" };
    const result = buildPromptWithContext("do stuff", "/tmp", ctx);
    expect(result).toContain("<context>");
    expect(result).toContain("</context>");
    expect(result).toContain("do stuff");
  });

  test("includes working directory", () => {
    const ctx: TaskContext = { gitBranch: "main" };
    const result = buildPromptWithContext("do stuff", "/tmp/project", ctx);
    expect(result).toContain("Working directory: /tmp/project");
  });
});
