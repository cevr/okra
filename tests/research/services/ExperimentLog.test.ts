// @effect-diagnostics effect/nodeBuiltinImport:off
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Effect } from "effect";
import { ConfigEvent, LifecycleEventEntry, ResultEvent } from "../../../src/research/types.js";
import type { ResearchError } from "../../../src/research/errors.js";
import { ExperimentLogService } from "../../../src/research/services/ExperimentLog.js";

const TEST_ROOT = "/tmp/okra-test-log";

const runSync = <A>(effect: Effect.Effect<A, ResearchError, ExperimentLogService>) =>
  // @effect-diagnostics-next-line effect/strictEffectProvide:off
  Effect.runSync(effect.pipe(Effect.provide(ExperimentLogService.layer)));

describe("ExperimentLogService", () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true });
    mkdirSync(`${TEST_ROOT}/.xp`, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true });
  });

  test("append and readAll round-trip", () => {
    const event = new LifecycleEventEntry({
      _tag: "lifecycle",
      timestamp: new Date().toISOString(),
      event: "started",
    });

    runSync(
      Effect.gen(function* () {
        const log = yield* ExperimentLogService;
        yield* log.append(TEST_ROOT, event);
      }),
    );

    const events = runSync(
      Effect.gen(function* () {
        const log = yield* ExperimentLogService;
        return yield* log.readAll(TEST_ROOT);
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?._tag).toBe("lifecycle");
  });

  test("reconstructState from empty", () => {
    const state = runSync(
      Effect.gen(function* () {
        const log = yield* ExperimentLogService;
        return yield* log.reconstructState(TEST_ROOT);
      }),
    );

    expect(state.segment).toBe(0);
    expect(state.iteration).toBe(0);
    expect(state.baseline).toBeUndefined();
    expect(state.results).toHaveLength(0);
  });

  test("reconstructState with baseline", () => {
    const config = new ConfigEvent({
      _tag: "config",
      timestamp: new Date().toISOString(),
      segment: 1,
      name: "test",
      unit: "ms",
      direction: "min",
      provider: "claude",
      sourceCommit: "abc123",
      benchmarkCmd: "./bench.sh",
      benchmarkDigest: "deadbeef",
    });

    const baseline = new ResultEvent({
      _tag: "result",
      timestamp: new Date().toISOString(),
      segment: 1,
      iteration: 0,
      kind: "baseline",
      status: "kept",
      value: 100,
      durationMs: 1000,
      summary: "Baseline",
    });

    runSync(
      Effect.gen(function* () {
        const log = yield* ExperimentLogService;
        yield* log.append(TEST_ROOT, config);
        yield* log.append(TEST_ROOT, baseline);
      }),
    );

    const state = runSync(
      Effect.gen(function* () {
        const log = yield* ExperimentLogService;
        return yield* log.reconstructState(TEST_ROOT);
      }),
    );

    expect(state.segment).toBe(1);
    expect(state.baseline).toBeDefined();
    expect(state.baseline?.value).toBe(100);
    expect(state.best?.value).toBe(100);
  });
});
