import { Console, Effect, FileSystem, Option, Result } from "effect";
import type { SkillsError } from "../errors.js";
import { SkillStore } from "../services/SkillStore.js";
import { GitHub, type GitHubShape } from "../services/GitHub.js";
import { SkillLock, type LockEntry } from "../services/SkillLock.js";
import { parseSource } from "../lib/source.js";
import { walkDir } from "../lib/fs.js";
import { DEFAULT_REF } from "../lib/constants.js";
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

const skillDirFromPath = (skillPath: string) =>
  skillPath === "SKILL.md" ? "" : skillPath.split("/").slice(0, -1).join("/");

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
) {
  const store = yield* SkillStore;
  const lock = yield* SkillLock;
  const fs = yield* FileSystem.FileSystem;

  const exists = yield* fs.exists(localPath).pipe(Effect.orDie);
  if (!exists) {
    yield* store
      .remove(name)
      .pipe(Effect.catchTag("@cvr/okra/skills/SkillsError", () => Effect.void));
    yield* lock.remove(name);
    return "removed" as const;
  }

  // P6: Parallel fetch+read (installed dir may not exist yet)
  const [incoming, installed] = yield* Effect.all([
    walkDir(localPath),
    store
      .readDir(name)
      .pipe(Effect.catchDefect(() => Effect.succeed([] as ReadonlyArray<FileEntry>))),
  ]);

  if (filesEqual(incoming, installed)) return "unchanged" as const;

  yield* store.syncDir(name, incoming);

  return "updated" as const;
});

type DoneStatus = "updated" | "unchanged" | "removed" | "moved";

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
  return match ? Option.some(match.skillDir) : Option.none<string>();
});

const updateSkill = Effect.fn("command.update.updateSkill")(function* (
  name: string,
  entry: LockEntry,
) {
  const store = yield* SkillStore;
  const gh = yield* GitHub;

  if (entry.source.startsWith("local:")) {
    const localPath = entry.source.slice("local:".length);
    const status = yield* updateLocalSkill(name, localPath);
    return Result.succeed<UpdateOk>({ status });
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

    yield* Console.error(
      `  ${name}: source moved ${currentSkillDir || "<root>"} -> ${newDir.value}`,
    );
    fetched = yield* tryFetchSkillDir(gh, owner, repo, newDir.value, ref);
    if (Result.isFailure(fetched)) return Result.fail(fetched.failure);
    movedTo = newDir;
  }

  const incoming = fetched.success;
  const newSkillPath = Option.isSome(movedTo) ? `${movedTo.value}/SKILL.md` : undefined;

  if (filesEqual(incoming, installed) && Option.isNone(movedTo)) {
    return Result.succeed<UpdateOk>({ status: "unchanged" });
  }

  yield* store.syncDir(name, incoming);
  return Result.succeed<UpdateOk>({
    status: Option.isSome(movedTo) ? "moved" : "updated",
    skillPath: newSkillPath,
  });
});

const statusFromResult = (result: Result.Result<UpdateOk, string>): SkillStatus =>
  Result.isFailure(result) ? "failed" : result.success.status;

const runOne = Effect.fn("command.update.runOne")(function* (
  progress: Progress,
  name: string,
  entry: LockEntry,
) {
  yield* progress.setStatus(name, "running");
  const result = yield* updateSkill(name, entry);
  yield* progress.setStatus(name, statusFromResult(result));
  return { name, result };
});

// P1: Parallel update loop + batched lock writes
export const runUpdate = Effect.fn("command.update")(function* () {
  const lock = yield* SkillLock;
  const lockFile = yield* lock.read;

  const entries = Object.entries(lockFile.skills);
  if (entries.length === 0) {
    yield* Console.log("No skills to update. Lock file is empty.");
    return;
  }

  yield* Console.error(`Checking ${entries.length} skill(s)...\n`);

  const progress = yield* makeProgress(entries.map(([name]) => name));

  const results = yield* Effect.forEach(entries, ([name, entry]) => runOne(progress, name, entry), {
    concurrency: 5,
  }).pipe(Effect.ensuring(progress.finish));

  const updatedEntries: Array<{ name: string; skillPath?: string }> = [];
  const removedNames: Array<string> = [];
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
        break;
      case "removed":
        removedNames.push(name);
        break;
      case "unchanged":
        unchanged++;
        break;
    }
  }

  // Batch lock writes (removed entries already cleaned their own lock)
  if (updatedEntries.length > 0) {
    yield* lock.updateMany(updatedEntries);
  }

  for (const { name, note } of failures) {
    yield* Console.error(`  Failed to update ${name}: ${note}`);
  }

  const updatedCount = updatedEntries.length - movedNames.length;
  const parts: Array<string> = [];
  if (updatedCount > 0) parts.push(`${updatedCount} updated`);
  if (movedNames.length > 0) parts.push(`${movedNames.length} moved`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  if (removedNames.length > 0) parts.push(`${removedNames.length} removed`);
  if (failures.length > 0) parts.push(`${failures.length} failed`);

  if (updatedEntries.length === 0 && removedNames.length === 0 && failures.length === 0) {
    yield* Console.log("All skills up to date.");
  } else {
    yield* Console.log(`\n${parts.join(", ")}.`);
  }
});
