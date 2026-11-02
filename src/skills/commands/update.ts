import { Console, Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import type { SkillsError } from "../errors.js";
import { SkillStore } from "../services/SkillStore.js";
import { GitHub, type GitHubShape, type SkillFile } from "../services/GitHub.js";
import { SkillLock, type LockEntry } from "../services/SkillLock.js";
import { parseSource } from "../lib/source.js";
import { walkDir } from "../lib/fs.js";
import { hashFiles } from "../lib/hash.js";
import { DEFAULT_REF } from "../lib/constants.js";
import { expandHome, readHome } from "../../shared/home.js";
import { make as makeProgress, type Progress, type SkillStatus } from "../lib/progress.js";

const filesEqual = (a: ReadonlyArray<SkillFile>, b: ReadonlyArray<SkillFile>): boolean => {
  if (a.length !== b.length) return false;
  const mapA = new Map(a.map((f) => [f.path, f.content]));
  for (const file of b) {
    const content = mapA.get(file.path);
    if (!content || content.length !== file.content.length) return false;
    if (!content.every((byte, index) => byte === file.content[index])) return false;
  }
  return true;
};

const skillDirFromPath = (skillPath: string) => {
  if (skillPath === "SKILL.md") return "";
  return skillPath.split("/").slice(0, -1).join("/");
};

// S1: Read ref from lock entry, not just from source string
const resolveRepoSource = (
  entry: LockEntry,
): Option.Option<{ owner: string; repo: string; ref: string }> => {
  const parsed = parseSource(entry.source);

  switch (parsed._tag) {
    case "GitHubRepo":
      return Option.some({
        owner: parsed.owner,
        repo: parsed.repo,
        ref: parsed.ref ?? entry.ref ?? DEFAULT_REF,
      });
    case "GitHubRepoWithSkill":
      return Option.some({
        owner: parsed.owner,
        repo: parsed.repo,
        ref: entry.ref ?? DEFAULT_REF,
      });
    case "LocalPath":
    case "SearchQuery":
      return Option.none();
  }
};

type DoneStatus = "updated" | "unchanged" | "moved" | "modified";

const modifiedReason =
  "installed files changed since okra last wrote them; move the edit to the source, or pass --force to overwrite";

export interface UpdateOk {
  readonly status: DoneStatus;
  readonly skillPath?: string;
  readonly hash?: string;
  readonly noBaseline?: boolean;
}

interface IncomingSkill {
  readonly files: ReadonlyArray<SkillFile>;
  readonly skillPath?: string;
}

const tryFetchSkillDir = (
  gh: GitHubShape,
  owner: string,
  repo: string,
  dirPath: string,
  ref: string,
) =>
  gh.fetchSkillDir(owner, repo, dirPath, ref).pipe(
    Effect.map(Result.succeed),
    Effect.catchTag("@cvr/okra/skills/SkillsError", (error: SkillsError) =>
      Effect.succeed(Result.fail(error.message)),
    ),
  );

// 404 fallback: skill moved within the source repo (e.g. `skills/in-progress/X` -> `skills/productivity/X`).
// Match by the directory name in the current lock entry against discovered SKILL.md locations.
const findMovedSkillDir = Effect.fn("command.update.findMovedSkillDir")(function* (
  gh: GitHubShape,
  owner: string,
  repo: string,
  ref: string,
  currentSkillDir: string,
) {
  const targetDirName = currentSkillDir.split("/").at(-1) ?? "";
  if (!targetDirName) return Option.none<string>();

  const discovered = yield* gh
    .discoverSkills(owner, repo, ref)
    .pipe(
      Effect.catchTag("@cvr/okra/skills/SkillsError", () =>
        Effect.succeed([] as ReadonlyArray<{ dirName: string; skillDir: string }>),
      ),
    );

  const match = discovered.find(
    (entry) => entry.dirName === targetDirName && entry.skillDir !== currentSkillDir,
  );
  return Option.fromUndefinedOr(match).pipe(Option.map((m) => m.skillDir));
});

const fetchIncoming = Effect.fn("command.update.fetchIncoming")(function* (entry: LockEntry) {
  const gh = yield* GitHub;

  if (entry.source.startsWith("local:")) {
    const localPath = expandHome(entry.source.slice("local:".length), yield* readHome);
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(localPath).pipe(Effect.orDie);
    if (!exists) return Result.fail(`local source not found: ${localPath}`);
    return Result.succeed<IncomingSkill>({ files: yield* walkDir(localPath) });
  }

  const source = resolveRepoSource(entry);
  if (Option.isNone(source)) {
    return Result.fail<string>(`invalid source "${entry.source}"`);
  }

  const { owner, repo, ref } = source.value;
  const currentSkillDir = skillDirFromPath(entry.skillPath);

  const initial = yield* tryFetchSkillDir(gh, owner, repo, currentSkillDir, ref);
  let fetched = initial;
  let movedTo: Option.Option<string> = Option.none();

  if (Result.isFailure(fetched)) {
    const newDir = yield* findMovedSkillDir(gh, owner, repo, ref, currentSkillDir);
    if (Option.isNone(newDir)) return Result.fail(fetched.failure);

    fetched = yield* tryFetchSkillDir(gh, owner, repo, newDir.value, ref);
    if (Result.isFailure(fetched)) return Result.fail(fetched.failure);
    movedTo = newDir;
  }

  if (Option.isSome(movedTo)) {
    return Result.succeed<IncomingSkill>({
      files: fetched.success,
      skillPath: `${movedTo.value}/SKILL.md`,
    });
  }
  return Result.succeed<IncomingSkill>({ files: fetched.success });
});

const updateSkill = Effect.fn("command.update.updateSkill")(function* (
  name: string,
  entry: LockEntry,
  dryRun: boolean,
  force: boolean,
) {
  const store = yield* SkillStore;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Only a missing directory is treated as empty. An unreadable directory must
  // never become permission to overwrite files whose baseline we could not check.
  const exists = yield* fs.exists(path.join(store.dir, name)).pipe(Effect.orDie);
  let installed: ReadonlyArray<SkillFile> = [];
  if (exists) installed = yield* store.readDir(name);
  const currentHash = yield* hashFiles(installed);
  if (!force && entry.hash !== undefined && entry.hash !== currentHash) {
    return Result.succeed<UpdateOk>({ status: "modified" });
  }

  const fetched = yield* fetchIncoming(entry);
  if (Result.isFailure(fetched)) return Result.fail(fetched.failure);
  const { files: incoming, skillPath } = fetched.success;
  const sameFiles = filesEqual(incoming, installed);
  if (sameFiles && skillPath === undefined) {
    return Result.succeed<UpdateOk>({ status: "unchanged", hash: currentHash });
  }

  if (!dryRun && !sameFiles) yield* store.syncDir(name, incoming);
  let status: DoneStatus = "updated";
  if (skillPath !== undefined) status = "moved";
  return Result.succeed<UpdateOk>({
    status,
    skillPath,
    hash: yield* hashFiles(incoming),
    noBaseline: entry.hash === undefined && !sameFiles,
  });
});

const statusFromResult = (
  result: Result.Result<UpdateOk, string>,
  dryRun: boolean,
): SkillStatus => {
  if (Result.isFailure(result)) return "failed";
  if (dryRun && (result.success.status === "updated" || result.success.status === "moved"))
    return "outdated";
  return result.success.status;
};

const runOne = Effect.fn("command.update.runOne")(function* (
  progress: Progress,
  name: string,
  entry: LockEntry,
  dryRun: boolean,
  force: boolean,
) {
  yield* progress.setStatus(name, "running");
  const result = yield* updateSkill(name, entry, dryRun, force);
  yield* progress.setStatus(name, statusFromResult(result, dryRun));
  return { name, entry, result };
});

/** The `--json` document: what an update did, or with `--dry-run` would do. */
export const UpdateReport = Schema.Struct({
  dryRun: Schema.Boolean,
  outdated: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      source: Schema.String,
      skillPath: Schema.String,
      moved: Schema.Boolean,
    }),
  ),
  failed: Schema.Array(
    Schema.Struct({ name: Schema.String, source: Schema.String, reason: Schema.String }),
  ),
  modified: Schema.Array(
    Schema.Struct({ name: Schema.String, source: Schema.String, reason: Schema.String }),
  ),
  unchanged: Schema.Int,
});
export type UpdateReport = typeof UpdateReport.Type;

export interface SkillOutcome {
  readonly name: string;
  readonly entry: LockEntry;
  readonly result: Result.Result<UpdateOk, string>;
}

/** Fold per-skill outcomes into the report. A moved skill reports its new path. */
export const buildReport = (
  outcomes: ReadonlyArray<SkillOutcome>,
  dryRun: boolean,
): UpdateReport => {
  const outdated: Array<UpdateReport["outdated"][number]> = [];
  const failed: Array<UpdateReport["failed"][number]> = [];
  const modified: Array<UpdateReport["modified"][number]> = [];
  let unchanged = 0;
  for (const { name, entry, result } of outcomes) {
    if (Result.isFailure(result)) {
      failed.push({ name, source: entry.source, reason: result.failure });
      continue;
    }
    if (result.success.status === "unchanged") {
      unchanged++;
      continue;
    }
    if (result.success.status === "modified") {
      modified.push({ name, source: entry.source, reason: modifiedReason });
      continue;
    }
    const moved = result.success.status === "moved";
    outdated.push({
      name,
      source: entry.source,
      skillPath: result.success.skillPath ?? entry.skillPath,
      moved,
    });
  }
  return { dryRun, outdated, failed, modified, unchanged };
};

const encodeReportJson = Schema.encodeEffect(Schema.fromJsonString(UpdateReport));

const printReportJson = (report: UpdateReport) =>
  encodeReportJson(report).pipe(Effect.orDie, Effect.flatMap(Console.log));

const progressVerb = (dryRun: boolean): string => {
  if (dryRun) return "checking";
  return "updating";
};

// Dry run: stdout carries only the outdated skill names, one per line, for scripts.
const reportDryRun = Effect.fn("command.update.reportDryRun")(function* (report: UpdateReport) {
  for (const { name } of report.outdated) yield* Console.log(name);
  const parts = [`${report.outdated.length} outdated`, `${report.unchanged} unchanged`];
  if (report.failed.length > 0) parts.push(`${report.failed.length} failed`);
  if (report.modified.length > 0) parts.push(`${report.modified.length} modified`);
  yield* Console.error(`\n${parts.join(", ")}. Nothing was written.`);
});

const reportUpdate = Effect.fn("command.update.reportUpdate")(function* (report: UpdateReport) {
  const movedCount = report.outdated.filter((skill) => skill.moved).length;
  const updatedCount = report.outdated.length - movedCount;
  const parts: Array<string> = [];
  if (updatedCount > 0) parts.push(`${updatedCount} updated`);
  if (movedCount > 0) parts.push(`${movedCount} moved`);
  if (report.unchanged > 0) parts.push(`${report.unchanged} unchanged`);
  if (report.failed.length > 0) parts.push(`${report.failed.length} failed`);
  if (report.modified.length > 0) parts.push(`${report.modified.length} modified`);

  if (report.outdated.length === 0 && report.failed.length === 0 && report.modified.length === 0) {
    yield* Console.log("All skills up to date.");
  } else {
    yield* Console.log(`\n${parts.join(", ")}.`);
  }
});

export interface UpdateOptions {
  /** Report outdated skills without writing skill files or the lock. */
  readonly dryRun?: boolean;
  /** Print the report as one JSON document on stdout instead of text. */
  readonly json?: boolean;
  /** Overwrite installed edits for every managed skill. */
  readonly force?: boolean;
}

// P1: Parallel update loop + batched lock writes
export const runUpdate = Effect.fn("command.update")(function* (options: UpdateOptions = {}) {
  const dryRun = options.dryRun ?? false;
  const json = options.json ?? false;
  const force = options.force ?? false;
  const lock = yield* SkillLock;
  const lockFile = yield* lock.read;

  const entries = Object.entries(lockFile.skills);
  if (entries.length === 0) {
    if (json) return yield* printReportJson(buildReport([], dryRun));
    yield* Console.log("No skills to update. Lock file is empty.");
    return;
  }

  yield* Console.error(`Checking ${entries.length} skill(s)...\n`);

  const progress = yield* makeProgress(
    entries.map(([name]) => name),
    { runningVerb: progressVerb(dryRun) },
  );

  const results = yield* Effect.forEach(
    entries,
    ([name, entry]) => runOne(progress, name, entry, dryRun, force),
    { concurrency: 5 },
  ).pipe(Effect.ensuring(progress.finish));

  const report = buildReport(results, dryRun);

  for (const { name, skillPath } of report.outdated.filter((skill) => skill.moved)) {
    yield* Console.error(`  ${name}: source moved to ${skillPath}`);
  }
  for (const { name, reason } of report.failed) {
    yield* Console.error(`  Failed to update ${name}: ${reason}`);
  }
  for (const { name, reason } of report.modified) {
    yield* Console.error(`  Modified ${name}: ${reason}`);
  }
  for (const { name, result } of results) {
    if (Result.isSuccess(result) && result.success.noBaseline) {
      yield* Console.error(
        `  Warning ${name}: no hash baseline existed; local edits cannot be detected for this update.`,
      );
    }
  }

  // Persist hashes for writes and legacy backfills; skipped skills keep their baseline.
  if (!dryRun) {
    const updates = results.flatMap(({ name, entry, result }) => {
      if (Result.isFailure(result) || result.success.status === "modified") return [];
      const { status, skillPath, hash } = result.success;
      if (status === "unchanged" && entry.hash === hash) return [];
      return [{ name, skillPath, hash }];
    });
    yield* lock.updateMany(updates);
  }

  if (json) return yield* printReportJson(report);
  if (dryRun) return yield* reportDryRun(report);
  return yield* reportUpdate(report);
});
