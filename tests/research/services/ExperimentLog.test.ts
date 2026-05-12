import { describe, expect, it } from "effect-bun-test";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { BunServices } from "@effect/platform-bun";
import { ConfigEvent, LifecycleEventEntry, ResultEvent } from "../../../src/research/types.js";
import { ExperimentLogService } from "../../../src/research/services/ExperimentLog.js";

const FIXTURE_ISO = "2026-01-01T00:00:00.000Z";

const TestLayer = ExperimentLogService.layer.pipe(Layer.provideMerge(BunServices.layer));

describe("ExperimentLogService", () => {
  it.scoped("append and readAll round-trip", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "okra-xp-log-" });
      yield* fs.makeDirectory(path.join(root, ".xp"), { recursive: true });

      const event = new LifecycleEventEntry({
        _tag: "lifecycle",
        timestamp: FIXTURE_ISO,
        event: "started",
      });

      const log = yield* ExperimentLogService;
      yield* log.append(root, event);

      const events = yield* log.readAll(root);
      expect(events).toHaveLength(1);
      expect(events[0]?._tag).toBe("lifecycle");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("reconstructState from empty", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "okra-xp-log-" });
      yield* fs.makeDirectory(path.join(root, ".xp"), { recursive: true });

      const log = yield* ExperimentLogService;
      const state = yield* log.reconstructState(root);

      expect(state.segment).toBe(0);
      expect(state.iteration).toBe(0);
      expect(state.baseline).toBeUndefined();
      expect(state.results).toHaveLength(0);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("reconstructState with baseline", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "okra-xp-log-" });
      yield* fs.makeDirectory(path.join(root, ".xp"), { recursive: true });

      const config = new ConfigEvent({
        _tag: "config",
        timestamp: FIXTURE_ISO,
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
        timestamp: FIXTURE_ISO,
        segment: 1,
        iteration: 0,
        kind: "baseline",
        status: "kept",
        value: 100,
        durationMs: 1000,
        summary: "Baseline",
      });

      const log = yield* ExperimentLogService;
      yield* log.append(root, config);
      yield* log.append(root, baseline);

      const state = yield* log.reconstructState(root);

      expect(state.segment).toBe(1);
      expect(state.baseline).toBeDefined();
      expect(state.baseline?.value).toBe(100);
      expect(state.best?.value).toBe(100);
    }).pipe(Effect.provide(TestLayer)),
  );
});
