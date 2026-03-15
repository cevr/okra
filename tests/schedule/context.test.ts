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

  test("includes default branch", () => {
    const ctx: TaskContext = { gitDefaultBranch: "main" };
    const result = buildPromptWithContext("test", "/tmp", ctx);
    expect(result).toContain("Default branch: main");
  });

  test("includes commit", () => {
    const ctx: TaskContext = { gitCommit: "abc1234" };
    const result = buildPromptWithContext("test", "/tmp", ctx);
    expect(result).toContain("HEAD: abc1234");
  });

  test("includes PR with URL", () => {
    const ctx: TaskContext = {
      prNumber: 42,
      prUrl: "https://github.com/cevr/okra/pull/42",
    };
    const result = buildPromptWithContext("babysit", "/tmp", ctx);
    expect(result).toContain("PR: #42 (https://github.com/cevr/okra/pull/42)");
  });

  test("includes PR without URL", () => {
    const ctx: TaskContext = { prNumber: 42 };
    const result = buildPromptWithContext("babysit", "/tmp", ctx);
    expect(result).toContain("PR: #42");
    expect(result).not.toContain("(");
  });

  test("includes issue number", () => {
    const ctx: TaskContext = { issueNumber: 123 };
    const result = buildPromptWithContext("fix it", "/tmp", ctx);
    expect(result).toContain("Issue: #123");
  });

  test("wraps in context tags", () => {
    const ctx: TaskContext = { gitBranch: "main" };
    const result = buildPromptWithContext("do stuff", "/tmp", ctx);
    expect(result).toMatch(/^<context>\n/);
    expect(result).toMatch(/<\/context>\n\ndo stuff$/);
  });

  test("full context includes all fields in order", () => {
    const ctx: TaskContext = {
      gitBranch: "feat/issue-42",
      gitRemoteUrl: "git@github.com:cevr/okra.git",
      gitRepo: "okra",
      gitCommit: "abc1234",
      gitDefaultBranch: "main",
      prNumber: 42,
      prUrl: "https://github.com/cevr/okra/pull/42",
      issueNumber: 42,
    };
    const result = buildPromptWithContext("babysit this pr", "/Users/cvr/project", ctx);
    const lines = result.split("\n");
    expect(lines[0]).toBe("<context>");
    expect(lines[1]).toContain("Repository:");
    expect(lines[2]).toContain("Branch:");
    expect(lines[3]).toContain("Default branch:");
    expect(lines[4]).toContain("HEAD:");
    expect(lines[5]).toContain("PR:");
    expect(lines[6]).toContain("Issue:");
    expect(lines[7]).toContain("Working directory:");
    expect(lines[8]).toBe("</context>");
    expect(lines[10]).toBe("babysit this pr");
  });

  test("empty context object still produces output with just cwd", () => {
    const emptyContext: TaskContext = {};
    const result = buildPromptWithContext("test", "/tmp", emptyContext);
    expect(result).toContain("Working directory: /tmp");
    expect(result).toContain("<context>");
  });

  test("includes working directory", () => {
    const ctx: TaskContext = { gitBranch: "main" };
    const result = buildPromptWithContext("do stuff", "/tmp/project", ctx);
    expect(result).toContain("Working directory: /tmp/project");
  });
});
