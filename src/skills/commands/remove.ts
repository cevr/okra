// @effect-diagnostics effect/strictBooleanExpressions:off
import { Console, Effect, FileSystem, Option, Path } from "effect";
import { SkillsError } from "../errors.js";
import { SKILL_DIR_PREFIXES } from "../lib/constants.js";
import { tryParseFrontmatter } from "../lib/frontmatter.js";
import { parseSource } from "../lib/source.js";
import { toKebab } from "../lib/util.js";
import { SkillStore } from "../services/SkillStore.js";
import { SkillLock } from "../services/SkillLock.js";

// B7: Clean lock even when dir is already gone
const removeByName = Effect.fn("command.remove.byName")(function* (name: string) {
  const store = yield* SkillStore;
  const lock = yield* SkillLock;

  yield* store
    .remove(name)
    .pipe(
      Effect.catchTag("@cvr/okra/skills/SkillsError", () =>
        Console.error(`  Directory already removed, cleaning lock entry`),
      ),
    );
  yield* lock.remove(name);
  yield* Console.log(`  Removed: ${name}`);
});

const discoverLocalSkillNames = Effect.fn("command.remove.discoverLocal")(function* (
  inputPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const resolved = inputPath.startsWith("~")
    ? pathService.join(
        Option.getOrElse(Option.fromNullishOr(process.env["HOME"]), () => ""),
        inputPath.slice(1),
      )
    : inputPath;
  const absPath = pathService.resolve(resolved);

  const exists = yield* fs.exists(absPath).pipe(Effect.orDie);
  if (!exists) {
    return yield* new SkillsError({
      message: `Path not found: ${absPath}`,
      code: "NO_SKILLS_FOUND",
    });
  }

  const names: Array<string> = [];

  // Check if the path itself is a skill directory
  const hasRootSkillMd = yield* fs.exists(pathService.join(absPath, "SKILL.md")).pipe(Effect.orDie);
  if (hasRootSkillMd) {
    const content = yield* fs
      .readFileString(pathService.join(absPath, "SKILL.md"))
      .pipe(Effect.orDie);
    const frontmatter = yield* tryParseFrontmatter(content);
    const name = Option.match(frontmatter, {
      onNone: () => pathService.basename(absPath),
      onSome: (fm) => toKebab(fm.name),
    });
    return [name];
  }

  // Discover skills in subdirectories
  for (const prefix of [...SKILL_DIR_PREFIXES, "."]) {
    const searchDir = prefix === "." ? absPath : pathService.join(absPath, prefix);
    const searchExists = yield* fs.exists(searchDir).pipe(Effect.orDie);
    if (!searchExists) continue;

    const entries = yield* fs.readDirectory(searchDir).pipe(Effect.orDie);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const entryPath = pathService.join(searchDir, entry);
      const stat = yield* fs.stat(entryPath).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!stat || stat.type !== "Directory") continue;

      const skillMdPath = pathService.join(entryPath, "SKILL.md");
      const hasSkillMd = yield* fs.exists(skillMdPath).pipe(Effect.orDie);
      if (!hasSkillMd) continue;

      const content = yield* fs.readFileString(skillMdPath).pipe(Effect.orDie);
      const frontmatter = yield* tryParseFrontmatter(content);
      const name = Option.match(frontmatter, {
        onNone: () => entry,
        onSome: (fm) => toKebab(fm.name),
      });
      names.push(name);
    }

    if (names.length > 0) break;
  }

  if (names.length === 0) {
    return yield* new SkillsError({
      message: `No skills found in ${absPath}`,
      code: "NO_SKILLS_FOUND",
    });
  }

  return names;
});

const removeFromLocal = Effect.fn("command.remove.fromLocal")(function* (inputPath: string) {
  const store = yield* SkillStore;
  const pathService = yield* Path.Path;
  const names = yield* discoverLocalSkillNames(inputPath);

  const installed = yield* store.list;
  const installedNames = new Set(installed.map((s) => pathService.basename(s.dirPath)));

  const toRemove = names.filter((n) => installedNames.has(n));

  if (toRemove.length === 0) {
    yield* Console.log("No matching installed skills found.");
    return;
  }

  for (const name of toRemove) {
    yield* removeByName(name);
  }

  yield* Console.log(`\n${toRemove.length} skill(s) removed.`);
});

export const runRemove = Effect.fn("command.remove")(function* (name: string) {
  const parsed = parseSource(name);
  if (parsed._tag === "LocalPath") {
    yield* removeFromLocal(parsed.path);
  } else {
    yield* removeByName(name);
  }
});
