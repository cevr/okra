import { Console, Effect, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { BrainError } from "../../errors/index.js";
import { AgentPlatformService } from "../../services/AgentPlatform.js";
import type { Provider } from "../../../shared/provider.js";
import { ConfigService } from "../../services/Config.js";
import { VaultService } from "../../services/Vault.js";
import {
  acquireLock,
  deriveProjectName,
  getProcessedSessions,
  isSettled,
  modifyState,
  readState,
  releaseLock,
  requireHome,
  type DaemonState,
} from "./state.js";

const MAX_TOTAL_LINES = 2000;
const REFLECT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface SessionFile {
  readonly provider: Provider;
  readonly name: string;
  readonly path: string;
  readonly mtime: Date;
  readonly mtimeIso: string;
  readonly lineCount: number;
  readonly sessionKey: string;
}

interface SessionGroup {
  readonly projectKey: string;
  readonly projectName: string;
  readonly sessions: SessionFile[];
}

interface RunReflectOptions {
  readonly executorProvider?: Provider;
  readonly sourceProviders?: ReadonlyArray<Provider>;
}

const isWithinReflectLookback = (mtime: Date): boolean =>
  Date.now() - mtime.getTime() <= REFLECT_LOOKBACK_MS;

const countLines = Effect.fn("countLines")(function* (filePath: string) {
  const fs = yield* FileSystem;
  const content = yield* fs.readFileString(filePath).pipe(Effect.catch(() => Effect.succeed("")));
  if (content.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") count++;
  }
  return content[content.length - 1] === "\n" ? count : count + 1;
});

const statOption = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<Option.Option<A>, never> =>
  effect.pipe(
    Effect.map(Option.some),
    Effect.catch(() => Effect.succeed(Option.none())),
  );

const readCodexSessionMeta = Effect.fn("readCodexSessionMeta")(function* (filePath: string) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const content = yield* fs.readFileString(filePath).pipe(Effect.catch(() => Effect.succeed("")));
  const lines = content.split("\n");

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const parsed = yield* Effect.try({
      try: () => Option.some(JSON.parse(line) as Record<string, unknown>),
      catch: () => Option.none<Record<string, unknown>>(),
    });
    if (Option.isNone(parsed) || parsed.value["type"] !== "session_meta") continue;
    const payload = parsed.value["payload"];
    if (typeof payload !== "object" || payload === null) continue;
    const payloadRecord = payload as Record<string, unknown>;
    const cwd = payloadRecord["cwd"];
    if (typeof cwd !== "string" || cwd.length === 0) continue;
    return Option.some({
      cwd,
      projectKey: cwd,
      projectName: path.basename(cwd),
    });
  }

  return Option.none<{
    cwd: string;
    projectKey: string;
    projectName: string;
  }>();
});

const scanClaudeSessions = Effect.fn("scanClaudeSessions")(function* (state: DaemonState) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const home = yield* requireHome();
  const projectsDir = path.join(home, ".claude", "projects");

  const exists = yield* fs.exists(projectsDir).pipe(Effect.catch(() => Effect.succeed(false)));
  if (!exists) return [] as SessionGroup[];

  const projectDirs = yield* fs.readDirectory(projectsDir).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot read Claude projects dir: ${e.message}`,
          code: "READ_FAILED",
        }),
    ),
  );

  const processed = getProcessedSessions(state, "claude");
  const groups: SessionGroup[] = [];

  for (const dirName of projectDirs) {
    const dirPath = path.join(projectsDir, dirName);
    const stat = yield* statOption(fs.stat(dirPath));
    if (Option.isNone(stat) || stat.value.type !== "Directory") continue;

    const files = yield* fs
      .readDirectory(dirPath)
      .pipe(Effect.catch(() => Effect.succeed([] as string[])));
    const sessions: SessionFile[] = [];

    for (const file of files.filter((entry) => entry.endsWith(".jsonl"))) {
      const filePath = path.join(dirPath, file);
      const fileStat = yield* statOption(fs.stat(filePath));
      if (Option.isNone(fileStat) || fileStat.value.type !== "File") continue;

      const mtime = fileStat.value.mtime ?? new Date(0);
      if (!isSettled(mtime) || !isWithinReflectLookback(mtime)) continue;

      const sessionKey = `${dirName}/${file}`;
      const mtimeIso = mtime.toISOString();
      if (processed[sessionKey] === mtimeIso) continue;

      const lineCount = yield* countLines(filePath);
      if (lineCount === 0) continue;

      sessions.push({
        provider: "claude",
        name: file,
        path: filePath,
        mtime,
        mtimeIso,
        lineCount,
        sessionKey,
      });
    }

    if (sessions.length === 0) continue;

    const projectName = yield* deriveProjectName(dirName);
    groups.push({
      projectKey: projectName,
      projectName,
      sessions,
    });
  }

  return groups;
});

const walkCodexDirs: (dir: string) => Effect.Effect<Array<string>, never, FileSystem | Path> =
  Effect.fn("walkCodexDirs")(function* (dir: string) {
    const fs = yield* FileSystem;
    const path = yield* Path;
    const exists = yield* fs.exists(dir).pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) return [] as string[];

    const entries = yield* fs
      .readDirectory(dir)
      .pipe(Effect.catch(() => Effect.succeed([] as string[])));
    const files: string[] = [];

    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      const stat = yield* statOption(fs.stat(entryPath));
      if (Option.isNone(stat)) continue;
      if (stat.value.type === "Directory") {
        files.push(...(yield* walkCodexDirs(entryPath)));
      } else if (stat.value.type === "File" && entry.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }

    return files;
  });

const scanCodexSessions = Effect.fn("scanCodexSessions")(function* (state: DaemonState) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const home = yield* requireHome();
  const sessionsDir = path.join(home, ".codex", "sessions");

  const files = yield* walkCodexDirs(sessionsDir);
  const processed = getProcessedSessions(state, "codex");
  const grouped = new Map<string, SessionGroup>();

  for (const filePath of files) {
    const stat = yield* statOption(fs.stat(filePath));
    if (Option.isNone(stat) || stat.value.type !== "File") continue;

    const mtime = stat.value.mtime ?? new Date(0);
    if (!isSettled(mtime) || !isWithinReflectLookback(mtime)) continue;

    const mtimeIso = mtime.toISOString();
    const relativeKey = path.relative(sessionsDir, filePath);
    if (processed[relativeKey] === mtimeIso) continue;

    const meta = yield* readCodexSessionMeta(filePath);
    if (Option.isNone(meta)) continue;

    const lineCount = yield* countLines(filePath);
    if (lineCount === 0) continue;

    const current =
      grouped.get(meta.value.projectKey) ??
      ({
        projectKey: meta.value.projectKey,
        projectName: meta.value.projectName,
        sessions: [],
      } satisfies SessionGroup);

    current.sessions.push({
      provider: "codex",
      name: path.basename(filePath),
      path: filePath,
      mtime,
      mtimeIso,
      lineCount,
      sessionKey: relativeKey,
    });

    grouped.set(meta.value.projectKey, current);
  }

  return [...grouped.values()];
});

const mergeGroups = (groups: ReadonlyArray<SessionGroup>): Array<SessionGroup> => {
  const merged = new Map<string, SessionGroup>();

  for (const group of groups) {
    const key = group.projectName;
    const current =
      merged.get(key) ??
      ({
        projectKey: key,
        projectName: group.projectName,
        sessions: [],
      } satisfies SessionGroup);
    current.sessions.push(...group.sessions);
    merged.set(key, current);
  }

  return [...merged.values()];
};

/** @internal */
export const scanSessions = Effect.fn("scanSessions")(function* (
  state: DaemonState,
  sourceProviders?: ReadonlyArray<Provider>,
) {
  const selected = new Set(sourceProviders ?? (["claude", "codex"] as const));
  const groups: SessionGroup[] = [];

  if (selected.has("claude")) groups.push(...(yield* scanClaudeSessions(state)));
  if (selected.has("codex")) groups.push(...(yield* scanCodexSessions(state)));

  return mergeGroups(groups);
});

const buildReflectPrompt = (
  projectName: string,
  sessions: readonly SessionFile[],
  brainDir: string,
): string => {
  const sorted = [...sessions].sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  let remaining = MAX_TOTAL_LINES;
  const entries: string[] = [];

  for (const session of sorted) {
    if (remaining <= 0) break;
    const lines = Math.min(session.lineCount, remaining);
    const offset = session.lineCount > lines ? session.lineCount - lines + 1 : 1;
    entries.push(
      `- [${session.provider}] ${session.path} (lines ${String(offset)}-${String(offset + lines - 1)})`,
    );
    remaining -= lines;
  }

  return [
    `You are running the brain reflect daemon for project "${projectName}".`,
    `Brain vault: ${brainDir}`,
    "",
    "Read these recent settled session files with your file-reading tools:",
    ...entries,
    "",
    "Extract high-signal learnings into the brain vault.",
    "Prefer updating existing notes over creating new files.",
    "Route project-specific learnings under projects/<project-name>/.",
    "Skip trivia, one-offs, and anything already captured.",
    "If a learning belongs in tooling or structure instead of memory, encode it structurally and skip the note.",
  ].join("\n");
};

export const runReflect = Effect.fn("runReflect")(function* (opts: RunReflectOptions = {}) {
  const config = yield* ConfigService;
  const vault = yield* VaultService;
  const platform = yield* AgentPlatformService;
  const path = yield* Path;

  const brainDir = yield* config.globalVaultPath();
  const executorId = yield* platform.resolveDaemonExecutor(
    opts.executorProvider === undefined ? undefined : Option.some(opts.executorProvider),
  );
  const executor = yield* platform.getProvider(executorId);

  const sourceProviders = opts.sourceProviders ?? (yield* platform.listDetectedSourceProviders());

  yield* acquireLock(brainDir, "reflect");

  yield* Effect.gen(function* () {
    let state = yield* readState(brainDir);
    const groups = yield* scanSessions(state, sourceProviders);

    if (groups.length === 0) {
      yield* Console.error("No new sessions to reflect on");
      return;
    }

    for (const group of groups) {
      yield* Effect.gen(function* () {
        yield* Console.error(
          `Reflecting on ${group.sessions.length} session(s) from ${group.projectName} with ${executorId}...`,
        );

        const projectDir = path.join(brainDir, "projects", group.projectName);
        yield* vault.init(projectDir, { minimal: true }).pipe(Effect.catch(() => Effect.void));

        const prompt = buildReflectPrompt(group.projectName, group.sessions, brainDir);
        yield* executor.invoke(prompt, "standard", brainDir);
        yield* Console.error(`  Reflected on ${group.sessions.length} session(s)`);

        const checkpointedAt = new Date().toISOString();
        yield* modifyState(brainDir, (latestState) => {
          const processedSessionsByProvider = {
            ...(latestState.reflect?.processedSessionsByProvider ?? {}),
          };
          const lastSourceScanByProvider = {
            ...(latestState.reflect?.lastSourceScanByProvider ?? {}),
          };

          for (const session of group.sessions) {
            processedSessionsByProvider[session.provider] = {
              ...(processedSessionsByProvider[session.provider] ?? {}),
              [session.sessionKey]: session.mtimeIso,
            };
            lastSourceScanByProvider[session.provider] = checkpointedAt;
          }

          return {
            ...latestState,
            reflect: {
              processedSessionsByProvider,
              lastSourceScanByProvider,
              lastExecutorRun: checkpointedAt,
            },
          };
        });
      }).pipe(
        Effect.catch((e) => Console.error(`  Failed to reflect on ${group.projectName}: ${e}`)),
      );
    }

    yield* Console.error("Reflect complete");
  }).pipe(Effect.ensuring(releaseLock(brainDir, "reflect")));
});
