/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/preferSchemaOverJson:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import {
  readState,
  writeState,
  modifyState,
  acquireLock,
  releaseLock,
  lockExists,
  isSettled,
  deriveProjectName,
} from "../../../../src/brain/commands/daemon/state.js";

const TestLayer = BunServices.layer;

describe("daemon state", () => {
  describe("readState / writeState", () => {
    it.scoped("returns default state when file is missing", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const state = yield* readState(dir);
        expect(state.reflect).toEqual({});
        expect(state.ruminate).toEqual({});
        expect(state.meditate).toEqual({});
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("roundtrips state through write + read", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const original = {
          reflect: {
            lastExecutorRun: "2024-06-01T00:00:00.000Z",
            lastSourceScanByProvider: { claude: "2024-06-01T00:00:00.000Z" },
            processedSessionsByProvider: {
              claude: { "proj/session.jsonl": "2024-06-01T00:00:00.000Z" },
            },
          },
          ruminate: { lastRun: "2024-05-01T00:00:00.000Z" },
          meditate: { lastRun: "2024-04-01T00:00:00.000Z" },
        };

        yield* writeState(dir, original);
        const loaded = yield* readState(dir);

        expect(loaded.reflect?.lastExecutorRun).toBe("2024-06-01T00:00:00.000Z");
        expect(loaded.reflect?.processedSessionsByProvider?.claude?.["proj/session.jsonl"]).toBe(
          "2024-06-01T00:00:00.000Z",
        );
        expect(loaded.ruminate?.lastRun).toBe("2024-05-01T00:00:00.000Z");
        expect(loaded.meditate?.lastRun).toBe("2024-04-01T00:00:00.000Z");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("migrates legacy reflect state into claude provider buckets", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(
          `${dir}/.daemon.json`,
          JSON.stringify({
            reflect: {
              lastRun: "2024-06-01T00:00:00.000Z",
              processedSessions: { "proj/session.jsonl": "2024-06-01T00:00:00.000Z" },
            },
          }),
        );

        const loaded = yield* readState(dir);
        expect(loaded.reflect?.lastSourceScanByProvider?.claude).toBe("2024-06-01T00:00:00.000Z");
        expect(loaded.reflect?.processedSessionsByProvider?.claude?.["proj/session.jsonl"]).toBe(
          "2024-06-01T00:00:00.000Z",
        );
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("returns default state when file is corrupt", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(`${dir}/.daemon.json`, "not valid json{{{");

        const state = yield* readState(dir);
        expect(state.reflect).toEqual({});
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("modifyState", () => {
    it.scoped("updates state and releases the state lock", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        yield* modifyState(dir, (state) => ({
          ...state,
          ruminate: { lastRun: "2024-06-01T00:00:00.000Z" },
        }));

        const loaded = yield* readState(dir);
        expect(loaded.ruminate?.lastRun).toBe("2024-06-01T00:00:00.000Z");
        expect(yield* lockExists(dir, "state")).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("releases the state lock when the updater throws", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const exit = yield* modifyState(dir, () => {
          throw new Error("boom");
        }).pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
        expect(yield* lockExists(dir, "state")).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.live("waits for transient state lock contention", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        yield* acquireLock(dir, "state");

        yield* Effect.all(
          [
            modifyState(dir, (state) => ({
              ...state,
              meditate: { lastRun: "2024-06-01T00:00:00.000Z" },
            })),
            Effect.gen(function* () {
              yield* Effect.sleep(50);
              yield* releaseLock(dir, "state");
            }),
          ],
          { concurrency: "unbounded" },
        );

        const loaded = yield* readState(dir);
        expect(loaded.meditate?.lastRun).toBe("2024-06-01T00:00:00.000Z");
        expect(yield* lockExists(dir, "state")).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
    );

    it.live("merges concurrent updates from different branches", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        yield* Effect.all(
          [
            modifyState(dir, (state) => ({
              ...state,
              reflect: {
                ...(state.reflect ?? {}),
                lastExecutorRun: "2024-06-01T00:00:00.000Z",
                processedSessionsByProvider: {
                  ...(state.reflect?.processedSessionsByProvider ?? {}),
                  claude: { "proj/session.jsonl": "2024-06-01T00:00:00.000Z" },
                },
              },
            })),
            modifyState(dir, (state) => ({
              ...state,
              ruminate: { lastRun: "2024-05-01T00:00:00.000Z" },
            })),
          ],
          { concurrency: "unbounded" },
        );

        const loaded = yield* readState(dir);
        expect(loaded.reflect?.lastExecutorRun).toBe("2024-06-01T00:00:00.000Z");
        expect(loaded.reflect?.processedSessionsByProvider?.claude?.["proj/session.jsonl"]).toBe(
          "2024-06-01T00:00:00.000Z",
        );
        expect(loaded.ruminate?.lastRun).toBe("2024-05-01T00:00:00.000Z");
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
    );
  });

  describe("acquireLock / releaseLock", () => {
    it.scoped("acquires and releases a lock", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* acquireLock(dir, "reflect");

        // Lock file should exist with our PID
        const content = yield* fs.readFileString(`${dir}/.daemon-reflect.lock`);
        expect(content.trim()).toBe(String(process.pid));

        yield* releaseLock(dir, "reflect");

        const exists = yield* fs.exists(`${dir}/.daemon-reflect.lock`);
        expect(exists).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("acquires lock when stale (dead PID)", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        // Write a lock with a PID that definitely doesn't exist
        yield* fs.writeFileString(`${dir}/.daemon-reflect.lock`, "999999999\n");

        // Should succeed — stale lock
        yield* acquireLock(dir, "reflect");

        const content = yield* fs.readFileString(`${dir}/.daemon-reflect.lock`);
        expect(content.trim()).toBe(String(process.pid));
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails when lock is held by a live process", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        // Write a lock with our own PID (which is alive)
        yield* fs.writeFileString(`${dir}/.daemon-reflect.lock`, `${process.pid}\n`);

        const exit = yield* acquireLock(dir, "reflect").pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("lockExists reports correct state", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        expect(yield* lockExists(dir, "reflect")).toBe(false);

        yield* acquireLock(dir, "reflect");
        expect(yield* lockExists(dir, "reflect")).toBe(true);

        yield* releaseLock(dir, "reflect");
        expect(yield* lockExists(dir, "reflect")).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("isSettled", () => {
    it.live("returns true for mtime > 30 min ago", () =>
      Effect.sync(() => {
        const old = new Date(Date.now() - 31 * 60 * 1000);
        expect(isSettled(old)).toBe(true);
      }),
    );

    it.live("returns false for mtime < 30 min ago", () =>
      Effect.sync(() => {
        const recent = new Date(Date.now() - 5 * 60 * 1000);
        expect(isSettled(recent)).toBe(false);
      }),
    );

    it.live("returns false for mtime exactly now", () =>
      Effect.sync(() => {
        expect(isSettled(new Date())).toBe(false);
      }),
    );
  });

  describe("deriveProjectName", () => {
    // Dashify: `/foo/bar` → `-foo-bar`, `/.hidden` → `--hidden`
    const dashify = (p: string) => p.replaceAll("/.", "--").replaceAll("/", "-");

    it.scoped("resolves project name from real path on disk", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        // Create a nested dir inside temp so deriveProjectName can find it
        yield* fs.makeDirectory(`${dir}/Developer/personal/brain`, { recursive: true });
        const dirName = dashify(`${dir}/Developer/personal`) + "-brain";
        const name = yield* deriveProjectName(dirName);
        expect(name).toBe("brain");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("preserves internal dashes in multi-word project names", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(`${dir}/workspace`, { recursive: true });
        // Dashified: <tempdir>-workspace-my-cool-project
        // Walk right-to-left finds <tempdir>/workspace as existing → suffix is "my-cool-project"
        const dirName = dashify(`${dir}/workspace`) + "-my-cool-project";
        const name = yield* deriveProjectName(dirName);
        expect(name).toBe("my-cool-project");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.live("falls back to last segment when no path resolves", () =>
      Effect.gen(function* () {
        const name = yield* deriveProjectName("nonexistent-project");
        expect(name).toBe("project");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.live("handles single segment", () =>
      Effect.gen(function* () {
        const name = yield* deriveProjectName("brain");
        expect(name).toBe("brain");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.live("handles empty string", () =>
      Effect.gen(function* () {
        const name = yield* deriveProjectName("");
        expect(name).toBe("");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.live("handles leading dash only", () =>
      Effect.gen(function* () {
        const name = yield* deriveProjectName("-");
        expect(name).toBe("-");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.live("skips TCC-protected dirs (Downloads, Photos, etc.)", () =>
      Effect.gen(function* () {
        // This would trigger macOS permission popup if we probed ~/Downloads
        // Instead it skips that probe and finds ~/Users/cvr as the match
        const home = process.env["HOME"] ?? "";
        const dirName = dashify(`${home}/Downloads`) + "-prophecy-studies";
        const name = yield* deriveProjectName(dirName);
        // ~/Downloads is TCC-protected → skipped. Falls back to ~/Users/cvr match
        expect(name).toBe("Downloads-prophecy-studies");
      }).pipe(Effect.provide(TestLayer)),
    );
  });
});
