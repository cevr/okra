import { describe, expect, it } from "effect-bun-test";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { BunServices } from "@effect/platform-bun";
import { Session } from "../../../src/research/types.js";
import { SessionService } from "../../../src/research/services/Session.js";

const FIXTURE_ISO = "2026-01-01T00:00:00.000Z";

const makeSession = (projectRoot: string): Session =>
  new Session({
    name: "test",
    unit: "ms",
    direction: "min",
    provider: "claude",
    objective: "test objective",
    benchmarkCmd: "./bench.sh",
    maxIterations: 10,
    maxFailures: 3,
    projectRoot,
    segment: 1,
    currentIteration: 0,
    createdAt: FIXTURE_ISO,
  });

const TestLayer = SessionService.layer.pipe(Layer.provideMerge(BunServices.layer));

describe("SessionService", () => {
  it.scoped("init creates session.json", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "okra-xp-session-" });
      const svc = yield* SessionService;

      const result = yield* svc.init(makeSession(root));
      expect(result.name).toBe("test");
      expect(yield* fs.exists(path.join(root, ".xp", "session.json"))).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("load reads session back", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "okra-xp-session-" });
      const svc = yield* SessionService;

      yield* svc.init(makeSession(root));
      const loaded = yield* svc.load(root);
      expect(loaded.name).toBe("test");
      expect(loaded.unit).toBe("ms");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("update patches session", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "okra-xp-session-" });
      const svc = yield* SessionService;

      yield* svc.init(makeSession(root));
      const updated = yield* svc.update(root, { currentIteration: 5, bestValue: 42 });
      expect(updated.currentIteration).toBe(5);
      expect(updated.bestValue).toBe(42);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("exists returns false for missing session", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "okra-xp-session-" });
      const svc = yield* SessionService;

      const result = yield* svc.exists(root);
      expect(result).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
  );
});
