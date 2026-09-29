import { Console, Effect, FileSystem, Option, Result } from "effect";
import type { SkillsError } from "../errors.js";
import { SkillStore } from "../services/SkillStore.js";
import { GitHub, type GitHubShape } from "../services/GitHub.js";
import { SkillLock, type LockEntry } from "../services/SkillLock.js";
import { parseSource } from "../lib/source.js";
import { walkDir } from "../lib/fs.js";
import { DEFAULT_REF } from "../lib/constants.js";
import { expandHome, readHome } from "../../shared/home.js";
import { make as makeProgress, type Progress, type SkillStatus } from "../lib/progress.js";

type FileEntry = { readonly path: string; readonly content: string };

const filesEqual = (a: ReadonlyArray<FileEntry>, b: ReadonlyArray<FileEntry>): boolean => {
  if (a.length !== b.length) return false;
  const mapA = new Map(a.map((f) => [f.path, f.content]));
  for (const file of b) {
    if (mapA.get(file.path) !== file.content) return false;
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

const updateLocalSkill = Effect.fn("command.update.updateLocalSkill")(function* (
  name: string,
  localPath: string,
  dryRun: boolean,
) {
  const store = yield* SkillStore;
  const fs = yield* FileSystem.FileSystem;

  // A missing source may only be missing on this machine: keep the installed
  // skill and its lock entry, and report the failure. `okra skills remove` deletes.
  const exists = yield* fs.exists(localPath).pipe(Effect.orDie);
  if (!exists) {
    return Result.fail(`local source not found: ${localPath}`);
  }

  // P6: Parallel fetch+read (installed dir may not exist yet)
  const [incoming, installed] = yield* Effect.all([
    walkDir(localPath),
    store
      .readDir(name)
      .pipe(Effect.catchDefect(() => Effect.succeed([] as ReadonlyArray<FileEntry>))),
  ]);

  if (filesEqual(incoming, installed)) return Result.succeed<UpdateOk>({ status: "unchanged" });

  if (!dryRun) yield* store.syncDir(name, incoming);

  return Result.succeed<UpdateOk>({ status: "updated" });
});

type DoneStatus = "updated" | "unchanged" | "moved";

interface UpdateOk {
  readonly status: DoneStatus;
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

const updateSkill = Effect.fn("command.update.updateSkill")(function* (
  name: string,
  entry: LockEntry,
  dryRun: boolean,
) {
  const store = yield* SkillStore;
  const gh = yield* GitHub;

  if (entry.source.startsWith("local:")) {
    const localPath = expandHome(entry.source.slice("local:".length), yield* readHome);
    return yield* updateLocalSkill(name, localPath, dryRun);
  }

  const source = resolveRepoSource(entry);
  if (Option.isNone(source)) {
    return Result.fail<string>(`invalid source "${entry.source}"`);
  }

  const { owner, repo, ref } = source.value;
  const currentSkillDir = skillDirFromPath(entry.skillPath);

  const initial = yield* tryFetchSkillDir(gh, owner, repo, currentSkillDir, ref);
  const installed = yield* store
    .readDir(name)
    .pipe(Effect.catchDefect(() => Effect.succeed([] as ReadonlyArray<FileEntry>)));

  let fetched = initial;
  let movedTo: Option.Option<string> = Option.none();

  if (Result.isFailure(fetched)) {
    const newDir = yield* findMovedSkillDir(gh, owner, repo, ref, currentSkillDir);
    if (Option.isNone(newDir)) return Result.fail(fetched.failure);

    fetched = yield* tryFetchSkillDir(gh, owner, repo, newDir.value, ref);
    if (Result.isFailure(fetched)) return Result.fail(fetched.failure);
    movedTo = newDir;
  }

  const incoming = fetched.success;

  if (filesEqual(incoming, installed) && Option.isNone(movedTo)) {
    return Result.succeed<UpdateOk>({ status: "unchanged" });
  }

  if (!dryRun) yield* store.syncDir(name, incoming);
  if (Option.isSome(movedTo)) {
    return Result.succeed<UpdateOk>({
      status: "moved",
      skillPath: `${movedTo.value}/SKILL.md`,
    });
  }
  return Result.succeed<UpdateOk>({ status: "updated", skillPath: undefined });
});

const statusFromResult = (
  result: Result.Result<UpdateOk, string>,
  dryRun: boolean,
): SkillStatus => {
  if (Result.isFailure(result)) return "failed";
  if (dryRun && result.success.status !== "unchanged") return "outdated";
  return result.success.status;
};

const runOne = Effect.fn("command.update.runOne")(function* (
  progress: Progress,
  name: string,
  entry: LockEntry,
  dryRun: boolean,
) {
  yield* progress.setStatus(name, "running");
  const result = yield* updateSkill(name, entry, dryRun);
  yield* progress.setStatus(name, statusFromResult(result, dryRun));
  return { name, result };
});

const progressVerb = (dryRun: boolean): string => {
  if (dryRun) return "checking";
  return "updating";
};

// Dry run: stdout carries only the outdated skill names, one per line, for scripts.
const reportDryRun = Effect.fn("command.update.reportDryRun")(function* (
  outdated: ReadonlyArray<{ readonly name: string }>,
  unchanged: number,
  failed: number,
) {
  for (const { name } of outdated) yield* Console.log(name);
  const parts = [`${outdated.length} outdated`, `${unchanged} unchanged`];
  if (failed > 0) parts.push(`${failed} failed`);
  yield* Console.error(`\n${parts.join(", ")}. Nothing was written.`);
});

export interface UpdateOptions {
  /** Report outdated skills without writing skill files or the lock. */
  readonly dryRun?: boolean;
}

// P1: Parallel update loop + batched lock writes
export const runUpdate = Effect.fn("command.update")(function* (options: UpdateOptions = {}) {
  const dryRun = options.dryRun ?? false;
  const lock = yield* SkillLock;
  const lockFile = yield* lock.read;

  const entries = Object.entries(lockFile.skills);
  if (entries.length === 0) {
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
    ([name, entry]) => runOne(progress, name, entry, dryRun),
    { concurrency: 5 },
  ).pipe(Effect.ensuring(progress.finish));

  const updatedEntries: Array<{ name: string; skillPath?: string }> = [];
  const movedNames: Array<string> = [];
  const failures: Array<{ name: string; note: string }> = [];
  let unchanged = 0;

  for (const { name, result } of results) {
    if (Result.isFailure(result)) {
      failures.push({ name, note: result.failure });
      continue;
    }
    switch (result.success.status) {
      case "updated":
        updatedEntries.push({ name });
        break;
      case "moved":
        updatedEntries.push({ name, skillPath: result.success.skillPath });
        movedNames.push(name);
        yield* Console.error(`  ${name}: source moved to ${result.success.skillPath}`);
        break;
      case "unchanged":
        unchanged++;
        break;
    }
  }

  for (const { name, note } of failures) {
    yield* Console.error(`  Failed to update ${name}: ${note}`);
  }

  if (dryRun) return yield* reportDryRun(updatedEntries, unchanged, failures.length);

  // Batch lock writes
  if (updatedEntries.length > 0) {
    yield* lock.updateMany(updatedEntries);
  }

  const updatedCount = updatedEntries.length - movedNames.length;
  const parts: Array<string> = [];
  if (updatedCount > 0) parts.push(`${updatedCount} updated`);
  if (movedNames.length > 0) parts.push(`${movedNames.length} moved`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  if (failures.length > 0) parts.push(`${failures.length} failed`);

  if (updatedEntries.length === 0 && failures.length === 0) {
    yield* Console.log("All skills up to date.");
  } else {
    yield* Console.log(`\n${parts.join(", ")}.`);
  }
});
