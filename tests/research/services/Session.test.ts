// @effect-diagnostics effect/nodeBuiltinImport:off
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Effect } from "effect";
import { Session } from "../../../src/research/types.js";
import type { ResearchError } from "../../../src/research/errors.js";
import { SessionService } from "../../../src/research/services/Session.js";

const TEST_ROOT = "/tmp/okra-test-session";

const makeSession = (): Session =>
  new Session({
    name: "test",
    unit: "ms",
    direction: "min",
    provider: "claude",
    objective: "test objective",
    benchmarkCmd: "./bench.sh",
    maxIterations: 10,
    maxFailures: 3,
    projectRoot: TEST_ROOT,
    segment: 1,
    currentIteration: 0,
    createdAt: new Date().toISOString(),
  });

const runSync = <A>(effect: Effect.Effect<A, ResearchError, SessionService>) =>
  // @effect-diagnostics-next-line effect/strictEffectProvide:off
  Effect.runSync(effect.pipe(Effect.provide(SessionService.layer)));

describe("SessionService", () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true });
    mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true });
  });

  test("init creates session.json", () => {
    const session = makeSession();
    const result = runSync(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.init(session);
      }),
    );
    expect(result.name).toBe("test");
    expect(existsSync(`${TEST_ROOT}/.xp/session.json`)).toBe(true);
  });

  test("load reads session back", () => {
    const session = makeSession();
    runSync(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        yield* svc.init(session);
      }),
    );
    const loaded = runSync(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.load(TEST_ROOT);
      }),
    );
    expect(loaded.name).toBe("test");
    expect(loaded.unit).toBe("ms");
  });

  test("update patches session", () => {
    const session = makeSession();
    runSync(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        yield* svc.init(session);
      }),
    );
    const updated = runSync(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.update(TEST_ROOT, { currentIteration: 5, bestValue: 42 });
      }),
    );
    expect(updated.currentIteration).toBe(5);
    expect(updated.bestValue).toBe(42);
  });

  test("exists returns false for missing session", () => {
    const result = runSync(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.exists(TEST_ROOT);
      }),
    );
    expect(result).toBe(false);
  });
});
