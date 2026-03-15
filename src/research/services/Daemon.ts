// @effect-diagnostics effect/nodeBuiltinImport:off
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from "node:fs";
import { Effect, Layer, ServiceMap } from "effect";
import { ResearchError, ErrorCode } from "../errors.js";
import { xpPaths } from "../paths.js";

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

export class DaemonService extends ServiceMap.Service<
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
  static layer: Layer.Layer<DaemonService> = Layer.succeed(DaemonService, {
    start: (projectRoot) =>
      Effect.gen(function* () {
        const paths = xpPaths(projectRoot);

        // Check for stale pid
        if (existsSync(paths.daemonPid)) {
          const existingPid = Number(readFileSync(paths.daemonPid, "utf-8").trim());
          if (isProcessRunning(existingPid)) {
            return yield* new ResearchError({
              message: `Daemon already running (pid ${existingPid})`,
              code: ErrorCode.DAEMON_ALREADY_RUNNING,
            });
          }
          // Stale pid file — clean up
          unlinkSync(paths.daemonPid);
        }

        // Open log file for daemon output
        const logFd = openSync(paths.daemonLog, "a");

        // Spawn detached research _loop process
        const selfPath = process.execPath;
        const proc = Bun.spawn([selfPath, "research", "_loop", "--project-root", projectRoot], {
          stdout: logFd,
          stderr: logFd,
          cwd: projectRoot,
          env: { ...process.env, OKRA_INTERNAL: "1" },
        });

        closeSync(logFd);

        // Detach so parent can exit
        proc.unref();

        const pid = proc.pid;
        writeFileSync(paths.daemonPid, String(pid));
        return pid;
      }),

    stop: (projectRoot) =>
      Effect.gen(function* () {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.daemonPid)) {
          return yield* new ResearchError({
            message: "No daemon running (no pid file)",
            code: ErrorCode.DAEMON_NOT_RUNNING,
          });
        }

        const pid = Number(readFileSync(paths.daemonPid, "utf-8").trim());
        if (!isProcessRunning(pid)) {
          unlinkSync(paths.daemonPid);
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
        if (existsSync(paths.daemonPid)) {
          unlinkSync(paths.daemonPid);
        }
      }),

    status: (projectRoot) =>
      Effect.sync(() => {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.daemonPid)) return { running: false };
        const pid = Number(readFileSync(paths.daemonPid, "utf-8").trim());
        if (!isProcessRunning(pid)) return { running: false };
        return { running: true, pid };
      }),

    isRunning: (projectRoot) =>
      Effect.sync(() => {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.daemonPid)) return false;
        const pid = Number(readFileSync(paths.daemonPid, "utf-8").trim());
        return isProcessRunning(pid);
      }),

    writePid: (projectRoot, pid) =>
      Effect.try({
        try: () => writeFileSync(xpPaths(projectRoot).daemonPid, String(pid)),
        catch: (e) =>
          new ResearchError({
            message: `Failed to write pid file: ${e}`,
            code: ErrorCode.WRITE_FAILED,
          }),
      }),

    cleanPid: (projectRoot) =>
      Effect.sync(() => {
        const paths = xpPaths(projectRoot);
        if (existsSync(paths.daemonPid)) unlinkSync(paths.daemonPid);
      }),
  });
}
