/** @effect-diagnostics effect/strictEffectProvide:skip-file */
import { describe, expect } from "bun:test";
import { it } from "effect-bun-test";
import { Effect } from "effect";
import { BunServices } from "@effect/platform-bun";
import { StoreService } from "../../../src/schedule/services/Store.js";
import { withTempDir, testStoreLayer } from "../helpers.js";

describe("StoreService", () => {
  it.live("add + get round-trip", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const store = yield* StoreService;
        const task = yield* store.add({
          id: "test-1",
          prompt: "check things",
          provider: "claude",
          schedule: {
            _tag: "Cron",
            minute: 0,
            hour: 9,
            dayOfMonth: "*",
            month: "*",
            dayOfWeek: "*",
            raw: "every day at 9am",
          },
          cwd: "/tmp",
        });
        expect(task.id).toBe("test-1");
        expect(task.status).toBe("active");
        expect(task.runCount).toBe(0);

        const loaded = yield* store.get("test-1");
        expect(loaded.prompt).toBe("check things");
        expect(loaded.provider).toBe("claude");
      }).pipe(Effect.provide(testStoreLayer(dir))),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("list returns all tasks", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const store = yield* StoreService;
        yield* store.add({
          id: "a",
          prompt: "a",
          provider: "claude",
          schedule: {
            _tag: "Cron",
            minute: 0,
            hour: 9,
            dayOfMonth: "*",
            month: "*",
            dayOfWeek: "*",
            raw: "",
          },
          cwd: "/tmp",
        });
        yield* store.add({
          id: "b",
          prompt: "b",
          provider: "codex",
          schedule: {
            _tag: "Cron",
            minute: 0,
            hour: 9,
            dayOfMonth: "*",
            month: "*",
            dayOfWeek: "*",
            raw: "",
          },
          cwd: "/tmp",
        });
        const tasks = yield* store.list();
        expect(tasks).toHaveLength(2);
      }).pipe(Effect.provide(testStoreLayer(dir))),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("update patches fields", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const store = yield* StoreService;
        yield* store.add({
          id: "upd",
          prompt: "x",
          provider: "claude",
          schedule: {
            _tag: "Cron",
            minute: 0,
            hour: 9,
            dayOfMonth: "*",
            month: "*",
            dayOfWeek: "*",
            raw: "",
          },
          cwd: "/tmp",
        });
        const updated = yield* store.update("upd", { runCount: 3, status: "completed" });
        expect(updated.runCount).toBe(3);
        expect(updated.status).toBe("completed");
      }).pipe(Effect.provide(testStoreLayer(dir))),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("remove deletes task", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const store = yield* StoreService;
        yield* store.add({
          id: "del",
          prompt: "x",
          provider: "claude",
          schedule: {
            _tag: "Cron",
            minute: 0,
            hour: 9,
            dayOfMonth: "*",
            month: "*",
            dayOfWeek: "*",
            raw: "",
          },
          cwd: "/tmp",
        });
        yield* store.remove("del");
        const tasks = yield* store.list();
        expect(tasks).toHaveLength(0);
      }).pipe(Effect.provide(testStoreLayer(dir))),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("rejects path traversal in ID", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const store = yield* StoreService;
        const exit = yield* store
          .add({
            id: "../evil",
            prompt: "x",
            provider: "claude",
            schedule: {
              _tag: "Cron",
              minute: 0,
              hour: 9,
              dayOfMonth: "*",
              month: "*",
              dayOfWeek: "*",
              raw: "",
            },
            cwd: "/tmp",
          })
          .pipe(Effect.exit);
        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(testStoreLayer(dir))),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("stop conditions round-trip", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const store = yield* StoreService;
        yield* store.add({
          id: "stop",
          prompt: "x",
          provider: "claude",
          schedule: {
            _tag: "Cron",
            minute: 0,
            hour: 9,
            dayOfMonth: "*",
            month: "*",
            dayOfWeek: "*",
            raw: "",
          },
          cwd: "/tmp",
          stopConditions: [{ _tag: "MaxRuns", count: 5 }],
        });
        const task = yield* store.get("stop");
        expect(task.stopConditions).toHaveLength(1);
      }).pipe(Effect.provide(testStoreLayer(dir))),
    ).pipe(Effect.provide(BunServices.layer)),
  );
});
