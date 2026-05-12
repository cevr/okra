import { Effect, Layer, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { ScheduleError } from "../errors.js";
import { PathEnv, resolvePaths } from "../paths.js";
import { resolveExecutable } from "../../shared/executable.js";
import { escapeXml } from "../../shared/xml.js";
import type { Task } from "./Store.js";
import { toCalendarIntervals } from "./Schedule.js";

const LABEL_PREFIX = "com.cvr.okra.schedule";
const label = (id: string) => `${LABEL_PREFIX}-${id}`;

const calendarIntervalXml = (intervals: ReadonlyArray<Record<string, number>>): string => {
  if (intervals.length === 1 && intervals[0] !== undefined) {
    const entry = intervals[0];
    const inner = Object.entries(entry)
      .map(([k, v]) => `    <key>${k}</key>\n    <integer>${String(v)}</integer>`)
      .join("\n");
    return `  <key>StartCalendarInterval</key>\n  <dict>\n${inner}\n  </dict>`;
  }

  const items = intervals
    .map((entry) => {
      const inner = Object.entries(entry)
        .map(([k, v]) => `      <key>${k}</key>\n      <integer>${String(v)}</integer>`)
        .join("\n");
      return `    <dict>\n${inner}\n    </dict>`;
    })
    .join("\n");
  return `  <key>StartCalendarInterval</key>\n  <array>\n${items}\n  </array>`;
};

/** @internal */
export const generatePlist = (
  task: Task,
  binPath: string,
  home: string,
  logPath: string,
  pathEnv: string,
): string => {
  const intervalXml = calendarIntervalXml(toCalendarIntervals(task.schedule));

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label(task.id))}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(binPath)}</string>
    <string>schedule</string>
    <string>run</string>
    <string>${escapeXml(task.id)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(home)}</string>
    <key>PATH</key>
    <string>${escapeXml(pathEnv)}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${escapeXml(task.cwd)}</string>
${intervalXml}
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>
`;
};

class LaunchdService extends Context.Service<
  LaunchdService,
  {
    readonly install: (task: Task) => Effect.Effect<void, ScheduleError>;
    readonly uninstall: (id: string) => Effect.Effect<void, ScheduleError>;
    readonly isLoaded: (id: string) => Effect.Effect<boolean, ScheduleError>;
  }
>()("@cvr/okra/schedule/services/Launchd/LaunchdService") {
  static layer = Layer.effect(
    LaunchdService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const paths = yield* resolvePaths;
      const { logsDir, agentsDir, home } = paths;
      const pathEnv: string = yield* PathEnv;

      yield* fs.makeDirectory(logsDir, { recursive: true }).pipe(
        Effect.mapError(
          (e: PlatformError) =>
            new ScheduleError({
              message: `Cannot create logs dir: ${e.message}`,
              code: "WRITE_FAILED",
            }),
        ),
      );

      const okraBin = yield* resolveExecutable("okra");

      const plistPath = (id: string) => path.join(agentsDir, `${label(id)}.plist`);
      const logPath = (id: string) => path.join(logsDir, `${id}.log`);

      const isLoaded = Effect.fn("LaunchdService.isLoaded")(function* (id: string) {
        const proc = Bun.spawn(["launchctl", "list", label(id)], {
          stdout: "ignore",
          stderr: "ignore",
        });
        const code = yield* Effect.tryPromise({
          try: () => proc.exited,
          catch: () =>
            new ScheduleError({ message: "Cannot check launchctl", code: "LAUNCHD_FAILED" }),
        });
        return code === 0;
      });

      const launchctlUnload = Effect.fn("LaunchdService.launchctlUnload")(function* (
        plist: string,
      ) {
        const proc = Bun.spawn(["launchctl", "unload", plist], {
          stdout: "ignore",
          stderr: "pipe",
        });
        const code = yield* Effect.tryPromise({
          try: () => proc.exited,
          catch: () =>
            new ScheduleError({ message: "Cannot run launchctl unload", code: "LAUNCHD_FAILED" }),
        });
        const stderr = yield* Effect.tryPromise({
          try: () => new Response(proc.stderr).text(),
          catch: () =>
            new ScheduleError({ message: "Cannot read unload stderr", code: "LAUNCHD_FAILED" }),
        });
        return { code, stderr: stderr.trim() };
      });

      const install = Effect.fn("LaunchdService.install")(function* (task: Task) {
        const plist = plistPath(task.id);
        const content = generatePlist(task, okraBin, home, logPath(task.id), pathEnv);

        yield* fs.makeDirectory(agentsDir, { recursive: true }).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new ScheduleError({
                message: `Cannot create LaunchAgents dir: ${e.message}`,
                code: "WRITE_FAILED",
              }),
          ),
        );

        // Read existing plist content for rollback if load fails
        const oldContent = yield* fs.readFileString(plist).pipe(Effect.option);

        const loaded = yield* isLoaded(task.id);
        if (loaded) {
          // Best-effort unload — job may already be unloaded
          yield* launchctlUnload(plist).pipe(Effect.catch(() => Effect.void));
        }

        yield* fs.writeFileString(plist, content).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new ScheduleError({
                message: `Cannot write plist: ${e.message}`,
                code: "WRITE_FAILED",
              }),
          ),
        );

        const loadProc = Bun.spawn(["launchctl", "load", plist], {
          stdout: "ignore",
          stderr: "pipe",
        });
        const loadCode = yield* Effect.tryPromise({
          try: () => loadProc.exited,
          catch: (e) =>
            new ScheduleError({
              message: `Cannot load ${label(task.id)}: ${e instanceof Error ? e.message : String(e)}`,
              code: "LAUNCHD_FAILED",
            }),
        });
        const loadStderr = yield* Effect.tryPromise({
          try: () => new Response(loadProc.stderr).text(),
          catch: () =>
            new ScheduleError({ message: "Cannot read load stderr", code: "LAUNCHD_FAILED" }),
        });
        const loadResult = { code: loadCode, stderr: loadStderr.trim() };

        if (loadResult.code !== 0) {
          // Rollback: restore old plist and re-load it
          if (oldContent._tag === "Some") {
            yield* fs
              .writeFileString(plist, oldContent.value)
              .pipe(Effect.catch(() => Effect.void));
            yield* launchctlUnload(plist).pipe(Effect.catch(() => Effect.void));
            const rollbackProc = Bun.spawn(["launchctl", "load", plist], {
              stdout: "ignore",
              stderr: "ignore",
            });
            yield* Effect.tryPromise({
              try: () => rollbackProc.exited,
              catch: () =>
                new ScheduleError({ message: "Rollback load failed", code: "LAUNCHD_FAILED" }),
            }).pipe(Effect.catch(() => Effect.void));
          }
          return yield* new ScheduleError({
            message: `Cannot load ${label(task.id)}: ${loadResult.stderr || `exit code ${loadResult.code}`}`,
            code: "LAUNCHD_FAILED",
          });
        }
      });

      const uninstall = Effect.fn("LaunchdService.uninstall")(function* (id: string) {
        const plist = plistPath(id);
        const loaded = yield* isLoaded(id);
        if (loaded) {
          const result = yield* launchctlUnload(plist);
          if (result.code !== 0) {
            // Re-check if still loaded — maybe it was already unloaded
            const stillLoaded = yield* isLoaded(id);
            if (stillLoaded) {
              return yield* new ScheduleError({
                message: `Cannot unload ${label(id)}: ${result.stderr || `exit code ${result.code}`}. Job is still running — plist not removed.`,
                code: "LAUNCHD_FAILED",
              });
            }
          }
        }
        yield* fs.remove(plist).pipe(Effect.catch(() => Effect.void));
      });

      return { install, uninstall, isLoaded };
    }),
  );
}

export { LaunchdService };
