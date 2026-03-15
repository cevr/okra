// @effect-diagnostics effect/preferSchemaOverJson:skip-file effect/nodeBuiltinImport:off
import { writeFileSync } from "node:fs";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { BrainError } from "../../errors/index.js";
import type { Provider } from "../../../shared/provider.js";

export type ProviderMap<T> = Partial<Record<Provider, T>>;

export interface ReflectState {
  readonly lastSourceScanByProvider?: ProviderMap<string>;
  readonly lastExecutorRun?: string;
  readonly processedSessionsByProvider?: ProviderMap<Record<string, string>>;
}

export interface JobState {
  readonly lastRun?: string;
}

export interface DaemonState {
  readonly reflect?: ReflectState;
  readonly ruminate?: JobState;
  readonly meditate?: JobState;
}

const EMPTY_STATE: DaemonState = { reflect: {}, ruminate: {}, meditate: {} };

// --- Constants ---

const SETTLE_MS = 30 * 60 * 1000; // 30 minutes
const STATE_FILE = ".daemon.json";
const STATE_LOCK_RETRY_DELAY_MS = 50;
const STATE_LOCK_MAX_ATTEMPTS = 40;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pickProviderMap = (value: unknown): ProviderMap<string> => {
  if (!isRecord(value)) return {};
  const result: ProviderMap<string> = {};
  for (const provider of ["claude", "codex"] as const) {
    const candidate = value[provider];
    if (typeof candidate === "string") result[provider] = candidate;
  }
  return result;
};

const pickProcessedSessionsByProvider = (value: unknown): ProviderMap<Record<string, string>> => {
  if (!isRecord(value)) return {};
  const result: ProviderMap<Record<string, string>> = {};
  for (const provider of ["claude", "codex"] as const) {
    const candidate = value[provider];
    if (!isRecord(candidate)) continue;
    const entries = Object.entries(candidate).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    result[provider] = Object.fromEntries(entries);
  }
  return result;
};

const normalizeReflectState = (value: unknown): ReflectState => {
  if (!isRecord(value)) return {};

  const lastSourceScanByProvider = pickProviderMap(value["lastSourceScanByProvider"]);
  const processedSessionsByProvider = pickProcessedSessionsByProvider(
    value["processedSessionsByProvider"],
  );
  const lastExecutorRun =
    typeof value["lastExecutorRun"] === "string" ? value["lastExecutorRun"] : undefined;

  const legacyLastRun = typeof value["lastRun"] === "string" ? value["lastRun"] : undefined;
  if (legacyLastRun !== undefined && lastSourceScanByProvider["claude"] === undefined) {
    lastSourceScanByProvider["claude"] = legacyLastRun;
  }

  const legacyProcessed = value["processedSessions"];
  if (isRecord(legacyProcessed) && processedSessionsByProvider["claude"] === undefined) {
    const entries = Object.entries(legacyProcessed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    processedSessionsByProvider["claude"] = Object.fromEntries(entries);
  }

  return {
    lastSourceScanByProvider,
    lastExecutorRun,
    processedSessionsByProvider,
  };
};

const normalizeJobState = (value: unknown): JobState => {
  if (!isRecord(value)) return {};
  return {
    lastRun: typeof value["lastRun"] === "string" ? value["lastRun"] : undefined,
  };
};

const normalizeDaemonState = (value: unknown): DaemonState => {
  if (!isRecord(value)) return EMPTY_STATE;
  return {
    reflect: normalizeReflectState(value["reflect"]),
    ruminate: normalizeJobState(value["ruminate"]),
    meditate: normalizeJobState(value["meditate"]),
  };
};

export const getProcessedSessions = (
  state: DaemonState,
  provider: Provider,
): Record<string, string> => state.reflect?.processedSessionsByProvider?.[provider] ?? {};

// --- State IO ---

/** Read daemon state from ~/.brain/.daemon.json, returns default if missing */
export const readState = Effect.fn("readState")(function* (brainDir: string) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const filePath = path.join(brainDir, STATE_FILE);

  const exists = yield* fs.exists(filePath).pipe(Effect.catch(() => Effect.succeed(false)));
  if (!exists) return EMPTY_STATE;

  const text = yield* fs.readFileString(filePath).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot read daemon state: ${e.message}`,
          code: "READ_FAILED",
        }),
    ),
  );

  return yield* Effect.try({
    try: () => normalizeDaemonState(JSON.parse(text)),
    catch: () => new BrainError({ message: "Cannot parse daemon state", code: "READ_FAILED" }),
  }).pipe(Effect.catch(() => Effect.succeed(EMPTY_STATE)));
});

/** Atomic write of daemon state */
export const writeState = Effect.fn("writeState")(function* (brainDir: string, state: DaemonState) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const filePath = path.join(brainDir, STATE_FILE);
  const tmpPath = `${filePath}.tmp`;

  const text = JSON.stringify(normalizeDaemonState(state), null, 2);

  yield* fs.writeFileString(tmpPath, text + "\n").pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot write daemon state: ${e.message}`,
          code: "WRITE_FAILED",
        }),
    ),
  );

  yield* fs.rename(tmpPath, filePath).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot rename daemon state: ${e.message}`,
          code: "WRITE_FAILED",
        }),
    ),
  );
});

const acquireStateLock = Effect.fn("acquireStateLock")(function* (brainDir: string) {
  for (let attempt = 0; attempt < STATE_LOCK_MAX_ATTEMPTS; attempt++) {
    const acquired = yield* acquireLock(brainDir, "state").pipe(
      Effect.as(true),
      Effect.catchTag("@cvr/okra/brain/BrainError", (error) => {
        if (error.code === "LOCKED") return Effect.succeed(false);
        return Effect.fail(error);
      }),
    );

    if (acquired) return;

    if (attempt < STATE_LOCK_MAX_ATTEMPTS - 1) {
      yield* Effect.sleep(STATE_LOCK_RETRY_DELAY_MS);
    }
  }

  return yield* new BrainError({
    message: `Timed out acquiring daemon state lock after ${String(
      STATE_LOCK_RETRY_DELAY_MS * STATE_LOCK_MAX_ATTEMPTS,
    )}ms`,
    code: "LOCKED",
  });
});

export const modifyState = Effect.fn("modifyState")(function* (
  brainDir: string,
  update: (state: DaemonState) => DaemonState,
) {
  yield* acquireStateLock(brainDir);

  yield* Effect.gen(function* () {
    const state = yield* readState(brainDir);
    yield* writeState(brainDir, update(state));
  }).pipe(Effect.ensuring(releaseLock(brainDir, "state")));
});

// --- Locking ---

const lockPath = (brainDir: string, job: string, path: Path) =>
  path.join(brainDir, `.daemon-${job}.lock`);

/** Acquire a lock for a daemon job. Uses exclusive file creation (O_EXCL) to avoid TOCTOU races. */
export const acquireLock = Effect.fn("acquireLock")(function* (brainDir: string, job: string) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const lock = lockPath(brainDir, job, path);
  const pid = `${process.pid}\n`;

  const created = yield* Effect.try({
    try: () => {
      writeFileSync(lock, pid, { flag: "wx" });
      return true as const;
    },
    catch: () => new BrainError({ message: "Lock file exists", code: "LOCKED" }),
  }).pipe(Effect.catch(() => Effect.succeed(false as const)));

  if (created) return;

  const content = yield* fs.readFileString(lock).pipe(Effect.catch(() => Effect.succeed("")));
  const holderPid = parseInt(content.trim(), 10);

  if (!Number.isNaN(holderPid) && isProcessAlive(holderPid)) {
    return yield* new BrainError({
      message: `Daemon job "${job}" is already running (PID ${holderPid}). If stale, remove ${lock}`,
      code: "LOCKED",
    });
  }

  yield* fs.remove(lock).pipe(Effect.catch(() => Effect.void));

  yield* Effect.try({
    try: () => {
      writeFileSync(lock, pid, { flag: "wx" });
    },
    catch: () =>
      new BrainError({
        message: `Cannot acquire lock for "${job}" — concurrent process won the race`,
        code: "LOCKED",
      }),
  });
});

/** Check if a lock file exists for a daemon job */
export const lockExists = Effect.fn("lockExists")(function* (brainDir: string, job: string) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const lock = lockPath(brainDir, job, path);
  return yield* fs.exists(lock).pipe(Effect.catch(() => Effect.succeed(false)));
});

/** Release lock for a daemon job */
export const releaseLock = Effect.fn("releaseLock")(function* (brainDir: string, job: string) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const lock = lockPath(brainDir, job, path);

  yield* fs.remove(lock).pipe(Effect.catch(() => Effect.void));
});

// --- Utilities ---

export const requireHome = Effect.fn("requireHome")(function* () {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  if (home.length > 0) return home;
  return yield* new BrainError({
    message: "HOME not set — run with HOME defined",
    code: "NO_HOME",
  });
});

export const requireDarwin = Effect.fn("requireDarwin")(function* () {
  if (process.platform === "darwin") return;
  return yield* new BrainError({
    message: "okra brain daemon requires macOS (launchd). Linux: use systemd or cron manually",
    code: "UNSUPPORTED_PLATFORM",
  });
});

export const isSettled = (mtime: Date): boolean => Date.now() - mtime.getTime() > SETTLE_MS;

const TCC_DIRS = new Set([
  "Desktop",
  "Documents",
  "Downloads",
  "Movies",
  "Music",
  "Pictures",
  "Library",
  "Public",
]);

const isTccProtected = (candidate: string): boolean => {
  const home = process.env["HOME"] ?? "";
  if (home.length === 0 || !candidate.startsWith(home + "/")) return false;
  const rel = candidate.slice(home.length + 1);
  const topDir = rel.split("/")[0] ?? "";
  return TCC_DIRS.has(topDir);
};

export const deriveProjectName = Effect.fn("deriveProjectName")(function* (dirName: string) {
  if (dirName.length <= 1) return dirName;

  const fs = yield* FileSystem;
  const p = yield* Path;

  const decoded = dirName.replaceAll("--", "/.").replaceAll("-", "/");

  if (!isTccProtected(decoded)) {
    const fullExists = yield* fs.exists(decoded).pipe(Effect.catch(() => Effect.succeed(false)));
    if (fullExists) return p.basename(decoded);
  }

  const dashes: number[] = [];
  for (let i = dirName.length - 1; i >= 0; i--) {
    if (dirName[i] === "-") dashes.push(i);
  }

  for (const idx of dashes) {
    const prefix = dirName.slice(0, idx);
    const candidate = prefix.replaceAll("--", "/.").replaceAll("-", "/");
    if (isTccProtected(candidate)) continue;
    const exists = yield* fs.exists(candidate).pipe(Effect.catch(() => Effect.succeed(false)));
    if (exists) return dirName.slice(idx + 1);
  }

  const home = process.env["HOME"] ?? "";
  const homeDash = home.replaceAll("/.", "--").replaceAll("/", "-");
  if (homeDash.length > 0 && dirName.startsWith(`${homeDash}-`)) {
    return dirName.slice(homeDash.length + 1);
  }

  return dirName.split("-").at(-1) ?? dirName;
});

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
