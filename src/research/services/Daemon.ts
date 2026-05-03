import { Effect, Layer, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { ResearchError, ErrorCode } from "../errors.js";
import { buildXpPaths } from "../paths.js";

export interface DaemonStatus {
  readonly running: boolean;
  readonly pid?: number;
}

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const wrapIO = (e: PlatformError, code: ErrorCode = ErrorCode.WRITE_FAILED) =>
  new ResearchError({ message: e.message, code });

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
              .pipe(Effect.catch(() => Effect.succeed(false)));
            if (pidExists) {
              const pidContent = yield* fs
                .readFileString(paths.daemonPid)
                .pipe(Effect.catch(() => Effect.succeed("")));
              const existingPid = Number(pidContent.trim());
              if (isProcessRunning(existingPid)) {
                return yield* new ResearchError({
                  message: `Daemon already running (pid ${existingPid})`,
                  code: ErrorCode.DAEMON_ALREADY_RUNNING,
                });
              }
              // Stale pid file — clean up
              yield* fs.remove(paths.daemonPid).pipe(Effect.catch(() => Effect.void));
            }

            // Ensure log file's parent exists
            yield* fs
              .makeDirectory(path.dirname(paths.daemonLog), { recursive: true })
              .pipe(Effect.catch(() => Effect.void));

            // Spawn detached research _loop process; Bun.file handles append-mode log target.
            const selfPath = process.execPath;
            const logFile = Bun.file(paths.daemonLog);
            const proc = Bun.spawn([selfPath, "research", "_loop", "--project-root", projectRoot], {
              stdout: logFile,
              stderr: logFile,
              cwd: projectRoot,
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
              .pipe(Effect.catch(() => Effect.succeed(false)));
            if (!pidExists) {
              return yield* new ResearchError({
                message: "No daemon running (no pid file)",
                code: ErrorCode.DAEMON_NOT_RUNNING,
              });
            }

            const pidContent = yield* fs
              .readFileString(paths.daemonPid)
              .pipe(Effect.catch(() => Effect.succeed("")));
            const pid = Number(pidContent.trim());
            if (!isProcessRunning(pid)) {
              yield* fs.remove(paths.daemonPid).pipe(Effect.catch(() => Effect.void));
              return yield* new ResearchError({
                message: `Daemon not running (stale pid ${pid})`,
                code: ErrorCode.DAEMON_NOT_RUNNING,
              });
            }

            // Send SIGTERM and wait for process to die
            process.kill(pid, "SIGTERM");

            // Poll for up to 5s
            const deadline = Date.now() + 5000;
            while (isProcessRunning(pid) && Date.now() < deadline) {
              yield* Effect.sleep("200 millis");
            }

            // If still running, escalate to SIGKILL
            if (isProcessRunning(pid)) {
              process.kill(pid, "SIGKILL");
              yield* Effect.sleep("500 millis");
            }

            // Now safe to remove pid file
            const stillExists = yield* fs
              .exists(paths.daemonPid)
              .pipe(Effect.catch(() => Effect.succeed(false)));
            if (stillExists) {
              yield* fs.remove(paths.daemonPid).pipe(Effect.catch(() => Effect.void));
            }
          }),

        status: (projectRoot) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, projectRoot);
            const pidExists = yield* fs
              .exists(paths.daemonPid)
              .pipe(Effect.catch(() => Effect.succeed(false)));
            if (!pidExists) return { running: false };
            const pidContent = yield* fs
              .readFileString(paths.daemonPid)
              .pipe(Effect.catch(() => Effect.succeed("")));
            const pid = Number(pidContent.trim());
            if (!isProcessRunning(pid)) return { running: false };
            return { running: true, pid };
          }),

        isRunning: (projectRoot) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, projectRoot);
            const pidExists = yield* fs
              .exists(paths.daemonPid)
              .pipe(Effect.catch(() => Effect.succeed(false)));
            if (!pidExists) return false;
            const pidContent = yield* fs
              .readFileString(paths.daemonPid)
              .pipe(Effect.catch(() => Effect.succeed("")));
            const pid = Number(pidContent.trim());
            return isProcessRunning(pid);
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
              .pipe(Effect.catch(() => Effect.succeed(false)));
            if (pidExists) {
              yield* fs.remove(paths.daemonPid).pipe(Effect.catch(() => Effect.void));
            }
          }),
      };
    }),
  );
}
