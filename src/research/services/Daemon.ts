import { Clock, Effect, Layer, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { ResearchError, ErrorCode } from "../errors.js";
import { buildXpPaths } from "../paths.js";

export interface DaemonStatus {
  readonly running: boolean;
  readonly pid?: number;
}

// Signal 0 probes liveness without delivering a signal; it throws when the pid is gone.
const isProcessRunning = (pid: number): Effect.Effect<boolean> =>
  Effect.try(() => process.kill(pid, 0)).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

const wrapIO = (e: PlatformError, code: ErrorCode = ErrorCode.WRITE_FAILED) =>
  ResearchError.make({ message: e.message, code });

export class DaemonService extends Context.Service<
  DaemonService,
  {
    readonly start: (projectRoot: string) => Effect.Effect<number, ResearchError>;
    readonly stop: (projectRoot: string) => Effect.Effect<void, ResearchError>;
    readonly status: (projectRoot: string) => Effect.Effect<DaemonStatus>;
    readonly isRunning: (projectRoot: string) => Effect.Effect<boolean>;
    readonly writePid: (projectRoot: string, pid: number) => Effect.Effect<void, ResearchError>;
    readonly cleanPid: (projectRoot: string) => Effect.Effect<void>;
  }
>()("@cvr/okra/research/services/Daemon/DaemonService") {
  static layer: Layer.Layer<DaemonService, never, FileSystem | Path> = Layer.effect(
    DaemonService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      return {
        start: (projectRoot) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, projectRoot);

            // Check for stale pid
            const pidExists = yield* fs
              .exists(paths.daemonPid)
              .pipe(Effect.orElseSucceed(() => false));
            if (pidExists) {
              const pidContent = yield* fs
                .readFileString(paths.daemonPid)
                .pipe(Effect.orElseSucceed(() => ""));
              const existingPid = Number(pidContent.trim());
              if (yield* isProcessRunning(existingPid)) {
                return yield* ResearchError.make({
                  message: `Daemon already running (pid ${existingPid})`,
                  code: ErrorCode.DAEMON_ALREADY_RUNNING,
                });
              }
              // Stale pid file — clean up
              yield* fs.remove(paths.daemonPid).pipe(Effect.ignore);
            }

            // Ensure log file's parent exists
            yield* fs
              .makeDirectory(path.dirname(paths.daemonLog), { recursive: true })
              .pipe(Effect.ignore);

            // The daemon outlives this process, so its log must be a file descriptor the
            // kernel owns. Effect's ChildProcess only models stdout/stderr as a Sink, which
            // the *parent* drains — and `research start` exits as soon as it prints the pid,
            // so every line would be dropped. Bun.spawn is therefore required here.
            const selfPath = process.execPath;
            const logFile = Bun.file(paths.daemonLog);
            const proc = Bun.spawn([selfPath, "research", "_loop", "--project-root", projectRoot], {
              stdout: logFile,
              stderr: logFile,
              cwd: projectRoot,
              // Bun.spawn replaces the environment wholesale, so the spread is required
              // for the daemon to keep PATH, HOME and the rest of the user's env.
              env: { ...process.env, OKRA_INTERNAL: "1" },
            });

            // Detach so parent can exit
            proc.unref();

            const pid = proc.pid;
            yield* fs
              .writeFileString(paths.daemonPid, String(pid))
              .pipe(Effect.mapError((e) => wrapIO(e)));
            return pid;
          }),

        stop: (projectRoot) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, projectRoot);
            const pidExists = yield* fs
              .exists(paths.daemonPid)
              .pipe(Effect.orElseSucceed(() => false));
            if (!pidExists) {
              return yield* ResearchError.make({
                message: "No daemon running (no pid file)",
                code: ErrorCode.DAEMON_NOT_RUNNING,
              });
            }

            const pidContent = yield* fs
              .readFileString(paths.daemonPid)
              .pipe(Effect.orElseSucceed(() => ""));
            const pid = Number(pidContent.trim());
            if (!(yield* isProcessRunning(pid))) {
              yield* fs.remove(paths.daemonPid).pipe(Effect.ignore);
              return yield* ResearchError.make({
                message: `Daemon not running (stale pid ${pid})`,
                code: ErrorCode.DAEMON_NOT_RUNNING,
              });
            }

            // Send SIGTERM and wait for process to die
            process.kill(pid, "SIGTERM");

            // Poll for up to 5s
            const startMs = yield* Clock.currentTimeMillis;
            const deadline = startMs + 5000;
            while (yield* isProcessRunning(pid)) {
              const nowMs = yield* Clock.currentTimeMillis;
              if (nowMs >= deadline) break;
              yield* Effect.sleep("200 millis");
            }

            // If still running, escalate to SIGKILL
            if (yield* isProcessRunning(pid)) {
              process.kill(pid, "SIGKILL");
              yield* Effect.sleep("500 millis");
            }

            // Now safe to remove pid file
            const stillExists = yield* fs
              .exists(paths.daemonPid)
              .pipe(Effect.orElseSucceed(() => false));
            if (stillExists) {
              yield* fs.remove(paths.daemonPid).pipe(Effect.ignore);
            }
          }),

        status: (projectRoot) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, projectRoot);
            const pidExists = yield* fs
              .exists(paths.daemonPid)
              .pipe(Effect.orElseSucceed(() => false));
            if (!pidExists) return { running: false };
            const pidContent = yield* fs
              .readFileString(paths.daemonPid)
              .pipe(Effect.orElseSucceed(() => ""));
            const pid = Number(pidContent.trim());
            if (!(yield* isProcessRunning(pid))) return { running: false };
            return { running: true, pid };
          }),

        isRunning: (projectRoot) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, projectRoot);
            const pidExists = yield* fs
              .exists(paths.daemonPid)
              .pipe(Effect.orElseSucceed(() => false));
            if (!pidExists) return false;
            const pidContent = yield* fs
              .readFileString(paths.daemonPid)
              .pipe(Effect.orElseSucceed(() => ""));
            const pid = Number(pidContent.trim());
            return yield* isProcessRunning(pid);
          }),

        writePid: (projectRoot, pid) =>
          fs
            .writeFileString(buildXpPaths(path, projectRoot).daemonPid, String(pid))
            .pipe(Effect.mapError((e) => wrapIO(e))),

        cleanPid: (projectRoot) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, projectRoot);
            const pidExists = yield* fs
              .exists(paths.daemonPid)
              .pipe(Effect.orElseSucceed(() => false));
            if (pidExists) {
              yield* fs.remove(paths.daemonPid).pipe(Effect.ignore);
            }
          }),
      };
    }),
  );
}
