import { Console, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { BrainError } from "../../errors/index.js";
import { requireDarwin, requireHome } from "./state.js";
import { resolveExecutable } from "../../../shared/executable.js";

const LABEL_PREFIX = "com.cvr.okra.brain-daemon";
const UNIFIED_LABEL = LABEL_PREFIX;
const JOBS = ["reflect", "ruminate", "meditate"] as const;
export type DaemonJob = (typeof JOBS)[number];

export const ALL_JOBS: readonly DaemonJob[] = JOBS;

const label = (job: DaemonJob) => `${LABEL_PREFIX}-${job}`;

const plistPath = (home: string, job: DaemonJob, path: Path) =>
  path.join(home, "Library", "LaunchAgents", `${label(job)}.plist`);

const unifiedPlistPath = (home: string, path: Path) =>
  path.join(home, "Library", "LaunchAgents", `${UNIFIED_LABEL}.plist`);

const logDir = (home: string, path: Path) => path.join(home, ".brain", "logs");

const logPath = (home: string, job: DaemonJob, path: Path) =>
  path.join(logDir(home, path), `daemon-${job}.log`);

const unifiedLogPath = (home: string, path: Path) => path.join(logDir(home, path), "daemon.log");

/** Generate a launchd plist XML string for a daemon job */
export const generatePlist = (
  job: DaemonJob,
  home: string,
  brainBin: string,
  path: Path,
): string => {
  const pathEnv = process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin";

  const scheduleKey =
    job === "reflect"
      ? `  <key>StartInterval</key>\n  <integer>3600</integer>`
      : job === "ruminate"
        ? `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Hour</key>\n    <integer>3</integer>\n  </dict>`
        : `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Weekday</key>\n    <integer>0</integer>\n    <key>Hour</key>\n    <integer>3</integer>\n  </dict>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label(job)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${brainBin}</string>
    <string>brain</string>
    <string>daemon</string>
    <string>run</string>
    <string>${job}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${home}</string>
    <key>PATH</key>
    <string>${pathEnv}</string>
  </dict>
${scheduleKey}
  <key>StandardOutPath</key>
  <string>${logPath(home, job, path)}</string>
  <key>StandardErrorPath</key>
  <string>${logPath(home, job, path)}</string>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>
`;
};

/** Install a launchd plist for a daemon job */
export const installPlist = Effect.fn("installPlist")(function* (job: DaemonJob) {
  yield* requireDarwin();
  const fs = yield* FileSystem;
  const path = yield* Path;
  const home = yield* requireHome();
  const brainBin = resolveExecutable("okra");

  // Ensure log directory exists
  yield* fs.makeDirectory(logDir(home, path), { recursive: true }).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot create log dir: ${e.message}`,
          code: "WRITE_FAILED",
        }),
    ),
  );

  // Ensure LaunchAgents dir exists
  const agentsDir = path.join(home, "Library", "LaunchAgents");
  yield* fs.makeDirectory(agentsDir, { recursive: true }).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot create LaunchAgents dir: ${e.message}`,
          code: "WRITE_FAILED",
        }),
    ),
  );

  const plist = plistPath(home, job, path);
  const content = generatePlist(job, home, brainBin, path);

  // Unload if already loaded
  const loaded = yield* isLoaded(job);
  if (loaded) {
    yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn(["launchctl", "unload", plist], {
          stdout: "ignore",
          stderr: "ignore",
        });
        await proc.exited;
      },
      catch: () =>
        new BrainError({ message: `Cannot unload ${label(job)}`, code: "LAUNCHD_FAILED" }),
    });
  }

  yield* fs.writeFileString(plist, content).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot write plist: ${e.message}`,
          code: "WRITE_FAILED",
        }),
    ),
  );

  yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["launchctl", "load", plist], { stdout: "ignore", stderr: "pipe" });
      const code = await proc.exited;
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(stderr.trim() || `exit code ${code}`);
      }
    },
    catch: (e) =>
      new BrainError({
        message: `Cannot load ${label(job)}: ${e instanceof Error ? e.message : String(e)}`,
        code: "LAUNCHD_FAILED",
      }),
  });
});

/** Uninstall a launchd plist for a daemon job */
export const uninstallPlist = Effect.fn("uninstallPlist")(function* (job: DaemonJob) {
  yield* requireDarwin();
  const fs = yield* FileSystem;
  const path = yield* Path;
  const home = yield* requireHome();
  const plist = plistPath(home, job, path);

  const loaded = yield* isLoaded(job);
  if (loaded) {
    yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn(["launchctl", "unload", plist], {
          stdout: "ignore",
          stderr: "ignore",
        });
        await proc.exited;
      },
      catch: () =>
        new BrainError({ message: `Cannot unload ${label(job)}`, code: "LAUNCHD_FAILED" }),
    });
  }

  yield* fs.remove(plist).pipe(Effect.catch(() => Effect.void));
});

/** Check if a launchd job is loaded */
export const isLoaded = Effect.fn("isLoaded")(function* (job: DaemonJob) {
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["launchctl", "list", label(job)], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const code = await proc.exited;
      return code === 0;
    },
    catch: () => new BrainError({ message: "Cannot check launchctl", code: "LAUNCHD_FAILED" }),
  });
});

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const KEEP_LINES = 1000;

/** Rotate daemon logs — truncate to last 1000 lines when > 10MB */
export const rotateLogs = Effect.fn("rotateLogs")(function* () {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const home = yield* requireHome();
  const dir = logDir(home, path);

  const exists = yield* fs.exists(dir).pipe(Effect.catch(() => Effect.succeed(false)));
  if (!exists) return;

  const files = yield* fs
    .readDirectory(dir)
    .pipe(Effect.catch(() => Effect.succeed([] as string[])));

  for (const file of files) {
    if (!file.startsWith("daemon-") || !file.endsWith(".log")) continue;
    const filePath = path.join(dir, file);
    const stat = yield* fs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(null)));
    if (stat === null) continue;
    if ((stat.size ?? 0) <= MAX_LOG_SIZE) continue;

    // Truncate to last KEEP_LINES lines
    const content = yield* fs.readFileString(filePath).pipe(Effect.catch(() => Effect.succeed("")));
    if (content.length === 0) continue;

    const lines = content.split("\n");
    const kept = lines.slice(-KEEP_LINES).join("\n");
    yield* fs.writeFileString(filePath, kept).pipe(Effect.catch(() => Effect.void));
    yield* Console.error(`  Rotated ${file} (truncated to ${String(KEEP_LINES)} lines)`);
  }
});

// --- Unified scheduler ---

/** Generate a launchd plist for the unified daemon scheduler (9, 13, 17, 21) */
export const generateUnifiedPlist = (home: string, brainBin: string, path: Path): string => {
  const pathEnv = process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${UNIFIED_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${brainBin}</string>
    <string>brain</string>
    <string>daemon</string>
    <string>tick</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${home}</string>
    <key>PATH</key>
    <string>${pathEnv}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>9</integer></dict>
    <dict><key>Hour</key><integer>13</integer></dict>
    <dict><key>Hour</key><integer>17</integer></dict>
    <dict><key>Hour</key><integer>21</integer></dict>
  </array>
  <key>StandardOutPath</key>
  <string>${unifiedLogPath(home, path)}</string>
  <key>StandardErrorPath</key>
  <string>${unifiedLogPath(home, path)}</string>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>
`;
};

/** Install the unified scheduler plist */
export const installUnifiedPlist = Effect.fn("installUnifiedPlist")(function* () {
  yield* requireDarwin();
  const fs = yield* FileSystem;
  const path = yield* Path;
  const home = yield* requireHome();
  const brainBin = resolveExecutable("okra");

  yield* fs
    .makeDirectory(logDir(home, path), { recursive: true })
    .pipe(
      Effect.mapError(
        (e: PlatformError) =>
          new BrainError({ message: `Cannot create log dir: ${e.message}`, code: "WRITE_FAILED" }),
      ),
    );

  const agentsDir = path.join(home, "Library", "LaunchAgents");
  yield* fs.makeDirectory(agentsDir, { recursive: true }).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot create LaunchAgents dir: ${e.message}`,
          code: "WRITE_FAILED",
        }),
    ),
  );

  const plist = unifiedPlistPath(home, path);
  const content = generateUnifiedPlist(home, brainBin, path);

  const loaded = yield* isUnifiedLoaded();
  if (loaded) {
    yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn(["launchctl", "unload", plist], {
          stdout: "ignore",
          stderr: "ignore",
        });
        await proc.exited;
      },
      catch: () =>
        new BrainError({ message: `Cannot unload ${UNIFIED_LABEL}`, code: "LAUNCHD_FAILED" }),
    });
  }

  yield* fs
    .writeFileString(plist, content)
    .pipe(
      Effect.mapError(
        (e: PlatformError) =>
          new BrainError({ message: `Cannot write plist: ${e.message}`, code: "WRITE_FAILED" }),
      ),
    );

  yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["launchctl", "load", plist], { stdout: "ignore", stderr: "pipe" });
      const code = await proc.exited;
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(stderr.trim() || `exit code ${code}`);
      }
    },
    catch: (e) =>
      new BrainError({
        message: `Cannot load ${UNIFIED_LABEL}: ${e instanceof Error ? e.message : String(e)}`,
        code: "LAUNCHD_FAILED",
      }),
  });
});

/** Uninstall the unified scheduler plist */
export const uninstallUnifiedPlist = Effect.fn("uninstallUnifiedPlist")(function* () {
  yield* requireDarwin();
  const fs = yield* FileSystem;
  const path = yield* Path;
  const home = yield* requireHome();
  const plist = unifiedPlistPath(home, path);

  const loaded = yield* isUnifiedLoaded();
  if (loaded) {
    yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn(["launchctl", "unload", plist], {
          stdout: "ignore",
          stderr: "ignore",
        });
        await proc.exited;
      },
      catch: () =>
        new BrainError({ message: `Cannot unload ${UNIFIED_LABEL}`, code: "LAUNCHD_FAILED" }),
    });
  }

  yield* fs.remove(plist).pipe(Effect.catch(() => Effect.void));
});

/** Check if the unified scheduler is loaded */
export const isUnifiedLoaded = Effect.fn("isUnifiedLoaded")(function* () {
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["launchctl", "list", UNIFIED_LABEL], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const code = await proc.exited;
      return code === 0;
    },
    catch: () => new BrainError({ message: "Cannot check launchctl", code: "LAUNCHD_FAILED" }),
  });
});

/** Remove legacy per-job plists (migration from 3-plist to unified) */
export const uninstallLegacyPlists = Effect.fn("uninstallLegacyPlists")(function* () {
  for (const job of ALL_JOBS) {
    yield* uninstallPlist(job).pipe(Effect.catch(() => Effect.void));
  }
});
