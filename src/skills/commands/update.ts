import { Console, Effect, FileSystem, Option } from "effect";
import { SkillStore } from "../services/SkillStore.js";
import { GitHub } from "../services/GitHub.js";
import { SkillLock, type LockEntry } from "../services/SkillLock.js";
import { parseSource } from "../lib/source.js";
import { walkDir } from "../lib/fs.js";
import { DEFAULT_REF } from "../lib/constants.js";

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

const updateSkill = Effect.fn("command.update.updateSkill")(function* (
  name: string,
  entry: LockEntry,
) {
  const store = yield* SkillStore;
  const gh = yield* GitHub;

  if (entry.source.startsWith("local:")) {
    const localPath = entry.source.slice("local:".length);
    return yield* updateLocalSkill(name, localPath);
  }

  const source = resolveRepoSource(entry);
  if (Option.isNone(source)) {
    yield* Console.error(`  Skipping ${name}: invalid source "${entry.source}"`);
    return "failed" as const;
  }

  const { owner, repo, ref } = source.value;

  // P6: Parallel fetch+read
  const result = yield* Effect.all([
    gh.fetchSkillDir(owner, repo, skillDirFromPath(entry.skillPath), ref).pipe(
      Effect.catchTag("@cvr/okra/skills/SkillsError", (error) =>
        Console.error(`  Failed to update ${name}: ${error.message}`).pipe(
          Effect.as(Option.none<ReadonlyArray<FileEntry>>()),
        ),
      ),
      Effect.map((v) => (Option.isOption(v) ? v : Option.some(v))),
    ),
    store
      .readDir(name)
      .pipe(Effect.catchDefect(() => Effect.succeed([] as ReadonlyArray<FileEntry>))),
  ]);

  const [incomingOpt, installed] = result;

  if (Option.isNone(incomingOpt)) return "failed" as const;

  const incoming = incomingOpt.value;

  if (filesEqual(incoming, installed)) return "unchanged" as const;

  yield* store.syncDir(name, incoming);

  return "updated" as const;
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

  const results = yield* Effect.forEach(
    entries,
    ([name, entry]) => updateSkill(name, entry).pipe(Effect.map((status) => ({ name, status }))),
    { concurrency: 5 },
  );

  const updatedNames: Array<string> = [];
  const removedNames: Array<string> = [];
  let unchanged = 0;
  let failed = 0;

  for (const { name, status } of results) {
    switch (status) {
      case "updated":
        yield* Console.log(`  Updated: ${name}`);
        updatedNames.push(name);
        break;
      case "removed":
        yield* Console.log(`  Removed: ${name} (source no longer exists)`);
        removedNames.push(name);
        break;
      case "unchanged":
        unchanged++;
        break;
      case "failed":
        failed++;
        break;
    }
  }

  // Batch lock writes (removed entries already cleaned their own lock)
  if (updatedNames.length > 0) {
    yield* lock.updateMany(updatedNames);
  }

  const parts: Array<string> = [];
  if (updatedNames.length > 0) parts.push(`${updatedNames.length} updated`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  if (removedNames.length > 0) parts.push(`${removedNames.length} removed`);
  if (failed > 0) parts.push(`${failed} failed`);

  if (updatedNames.length === 0 && removedNames.length === 0 && failed === 0) {
    yield* Console.log("All skills up to date.");
  } else {
    yield* Console.log(`\n${parts.join(", ")}.`);
  }
});
