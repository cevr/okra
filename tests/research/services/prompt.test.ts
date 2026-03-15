import { describe, expect, test } from "bun:test";
import { buildExperimentPrompt, buildSetupPrompt } from "../../../src/research/prompt.js";
import type { ExperimentState, Session } from "../../../src/research/types.js";

const makeSession = (overrides: Partial<Session> = {}): Session =>
  ({
    name: "test-experiment",
    unit: "ms",
    direction: "min",
    provider: "claude",
    objective: "Optimize performance",
    benchmarkCmd: "bun run bench.ts",
    maxIterations: 50,
    maxFailures: 5,
    projectRoot: "/tmp/project",
    segment: 1,
    currentIteration: 0,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Session;

const emptyState: ExperimentState = {
  segment: 1,
  iteration: 0,
  baseline: undefined,
  best: undefined,
  results: [],
  steers: [],
  lastPendingResult: undefined,
  hasDecisionForLastPending: true,
  lastPendingCommit: undefined,
};

describe("buildExperimentPrompt", () => {
  test("includes experiment name", () => {
    const prompt = buildExperimentPrompt(makeSession(), emptyState, "/tmp/wt", "/tmp/src", []);
    expect(prompt).toContain("test-experiment");
  });

  test("includes objective", () => {
    const prompt = buildExperimentPrompt(makeSession(), emptyState, "/tmp/wt", "/tmp/src", []);
    expect(prompt).toContain("Optimize performance");
  });

  test("includes direction and unit", () => {
    const prompt = buildExperimentPrompt(makeSession(), emptyState, "/tmp/wt", "/tmp/src", []);
    expect(prompt).toContain("minimize");
    expect(prompt).toContain("ms");
  });
});

describe("buildSetupPrompt", () => {
  test("includes source path", () => {
    const prompt = buildSetupPrompt("/tmp/project", "/tmp/worktree", "bun run bench.ts");
    expect(prompt).toContain("/tmp/project");
  });

  test("includes worktree path", () => {
    const prompt = buildSetupPrompt("/tmp/project", "/tmp/worktree", "bun run bench.ts");
    expect(prompt).toContain("/tmp/worktree");
  });

  test("includes benchmark command", () => {
    const prompt = buildSetupPrompt("/tmp/project", "/tmp/worktree", "bun run bench.ts");
    expect(prompt).toContain("bun run bench.ts");
  });
});
