// @effect-diagnostics effect/strictBooleanExpressions:off
import { Console, Effect, FileSystem, Option, Path } from "effect";
import { SkillsError } from "../errors.js";
import { walkDir } from "../lib/fs.js";
import { DEFAULT_REF, SKILL_DIR_PREFIXES } from "../lib/constants.js";
import { tryParseFrontmatter } from "../lib/frontmatter.js";
import { search } from "../lib/search-api.js";
import {
  parseSource,
  type GitHubRepo,
  type GitHubRepoWithSkill,
  type LocalPath,
} from "../lib/source.js";
import { toKebab } from "../lib/util.js";
import { GitHub } from "../services/GitHub.js";
import { SkillLock } from "../services/SkillLock.js";
import { SkillStore } from "../services/SkillStore.js";

// B1/P2: Returns data instead of calling lock.add — callers batch the lock write
const installSkillDir = Effect.fn("command.add.installSkillDir")(function* (
  owner: string,
  repo: string,
  skillDir: string,
  ref: string | undefined,
  sourceStr: string,
) {
  const store = yield* SkillStore;
  const gh = yield* GitHub;
  const resolvedRef = ref ?? DEFAULT_REF;

  const files = yield* gh.fetchSkillDir(owner, repo, skillDir, resolvedRef);

  const skillMd = files.find((file) => file.path === "SKILL.md");
  const frontmatter = skillMd ? yield* tryParseFrontmatter(skillMd.content) : Option.none();

  const fallbackName = skillDir ? (skillDir.split("/").at(-1) ?? "unknown") : repo;
  const name = Option.match(frontmatter, {
    onNone: () => fallbackName,
    onSome: (fm) => toKebab(fm.name),
  });
  const skillMdPath = skillDir ? `${skillDir}/SKILL.md` : "SKILL.md";

  yield* store.syncDir(name, files);
  yield* Console.log(`  Installed: ${name} (${files.length} file${files.length === 1 ? "" : "s"})`);

  return { name, source: sourceStr, skillPath: skillMdPath, ref };
});

interface LocalInstallResult {
  readonly name: string;
  readonly source: string;
  readonly skillPath: string;
}

// Returns data instead of calling lock.add — callers batch
const installLocalSkillDir = Effect.fn("command.add.installLocalSkillDir")(function* (
  dirPath: string,
  skillFilter?: string,
) {
  const store = yield* SkillStore;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const absPath = pathService.resolve(dirPath);

  const skillMdPath = pathService.join(absPath, "SKILL.md");
  const hasSkillMd = yield* fs.exists(skillMdPath).pipe(Effect.orDie);
  if (!hasSkillMd) {
    return yield* new SkillsError({
      message: `No SKILL.md found in ${absPath}`,
      code: "NO_SKILLS_FOUND",
    });
  }

  const files = yield* walkDir(absPath);
  const skillMd = files.find((f) => f.path === "SKILL.md");
  const frontmatter = skillMd ? yield* tryParseFrontmatter(skillMd.content) : Option.none();

  const fallbackName = pathService.basename(absPath);
  const name = Option.match(frontmatter, {
    onNone: () => fallbackName,
    onSome: (fm) => toKebab(fm.name),
  });

  if (skillFilter && toKebab(skillFilter) !== name) return Option.none();

  const sourceStr = `local:${absPath}`;
  yield* store.syncDir(name, files);
  yield* Console.log(`  Installed: ${name} (${files.length} file${files.length === 1 ? "" : "s"})`);

  return Option.some({ name, source: sourceStr, skillPath: "SKILL.md" });
});

const addFromLocal = Effect.fn("command.add.fromLocal")(function* (
  source: LocalPath,
  skillFilter?: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const lock = yield* SkillLock;

  const inputPath = source.path.startsWith("~")
    ? pathService.join(
        Option.getOrElse(Option.fromNullishOr(process.env["HOME"]), () => ""),
        source.path.slice(1),
      )
    : source.path;
  const absPath = pathService.resolve(inputPath);

  const exists = yield* fs.exists(absPath).pipe(Effect.orDie);
  if (!exists) {
    return yield* new SkillsError({
      message: `Path not found: ${absPath}`,
      code: "NO_SKILLS_FOUND",
    });
  }

  // Check if the path itself is a skill directory
  const hasRootSkillMd = yield* fs.exists(pathService.join(absPath, "SKILL.md")).pipe(Effect.orDie);
  if (hasRootSkillMd) {
    const result = yield* installLocalSkillDir(absPath, skillFilter);
    if (Option.isSome(result)) {
      yield* lock.add(result.value.name, result.value.source, result.value.skillPath);
    }
    return;
  }

  // Discover skills in subdirectories (look in skills/, skill/, or direct children)
  const discovered: Array<LocalInstallResult> = [];

  for (const prefix of ["skills", "skill", "."]) {
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

      const result = yield* installLocalSkillDir(entryPath, skillFilter);
      if (Option.isSome(result)) discovered.push(result.value);
    }

    if (discovered.length > 0) break;
  }

  if (discovered.length === 0) {
    return yield* new SkillsError({
      message: skillFilter
        ? `Skill "${skillFilter}" not found in ${absPath}`
        : `No skills found in ${absPath}`,
      code: "NO_SKILLS_FOUND",
    });
  }

  // Batch lock write for all discovered local skills
  yield* lock.addMany(discovered);

  yield* Console.log(`\n${discovered.length} skill(s) installed from ${absPath}`);
});

const addFromRepo = Effect.fn("command.add.fromRepo")(function* (source: GitHubRepo) {
  const { owner, repo, ref, subpath } = source;
  const lock = yield* SkillLock;
  const gh = yield* GitHub;
  const sourceStr = `${owner}/${repo}${ref ? `#${ref}` : ""}`;

  if (subpath) {
    const skillDir = subpath.endsWith("SKILL.md")
      ? subpath.split("/").slice(0, -1).join("/")
      : subpath;
    const result = yield* installSkillDir(owner, repo, skillDir, ref, sourceStr);
    yield* lock.add(result.name, result.source, result.skillPath, result.ref);
    return;
  }

  yield* Console.error(`Discovering skills in ${owner}/${repo}...`);
  const skills = yield* gh.discoverSkills(owner, repo, ref);

  if (skills.length === 0) {
    return yield* new SkillsError({
      message: "No skills found in this repository.",
      code: "NO_SKILLS_FOUND",
    });
  }

  yield* Console.error(`Found ${skills.length} skill(s):\n`);

  // B1/P2: Install concurrently, batch lock write
  const results = yield* Effect.forEach(
    skills,
    (skill) => installSkillDir(owner, repo, skill.skillDir, ref, sourceStr),
    { concurrency: 5 },
  );
  yield* lock.addMany(results);
});

const addFromRepoWithSkill = Effect.fn("command.add.fromRepoWithSkill")(function* (
  source: GitHubRepoWithSkill,
) {
  const { owner, repo, skillFilter, ref } = source;
  const lock = yield* SkillLock;
  const gh = yield* GitHub;
  const sourceStr = `${owner}/${repo}@${skillFilter}`;

  // Probe prefixed paths (skills/X, skill/X) then root-level (X)
  const probePaths = [
    ...SKILL_DIR_PREFIXES.map((prefix) => `${prefix}/${skillFilter}`),
    skillFilter,
  ];

  for (const skillDir of probePaths) {
    const directPath = `${skillDir}/SKILL.md`;
    const direct = yield* gh.fetchRaw(owner, repo, directPath, ref).pipe(Effect.option);

    if (direct._tag === "Some") {
      const result = yield* installSkillDir(owner, repo, skillDir, ref, sourceStr);
      yield* lock.add(result.name, result.source, result.skillPath, result.ref);
      return;
    }
  }

  const rootContent = yield* gh.fetchRaw(owner, repo, "SKILL.md", ref).pipe(Effect.option);

  if (rootContent._tag === "Some") {
    const frontmatter = yield* tryParseFrontmatter(rootContent.value);
    if (Option.isSome(frontmatter) && toKebab(frontmatter.value.name) === toKebab(skillFilter)) {
      const result = yield* installSkillDir(owner, repo, "", ref, sourceStr);
      yield* lock.add(result.name, result.source, result.skillPath, result.ref);
      return;
    }
  }

  const skills = yield* gh.discoverSkills(owner, repo, ref);

  for (const skill of skills) {
    const content = yield* gh.fetchRaw(owner, repo, skill.skillMdPath, ref);
    const frontmatter = yield* tryParseFrontmatter(content);
    if (Option.isSome(frontmatter) && toKebab(frontmatter.value.name) === toKebab(skillFilter)) {
      const result = yield* installSkillDir(owner, repo, skill.skillDir, ref, sourceStr);
      yield* lock.add(result.name, result.source, result.skillPath, result.ref);
      return;
    }
  }

  return yield* new SkillsError({
    message: `Skill not found: ${skillFilter}`,
    code: "SKILL_NOT_FOUND",
  });
});

// B5: Safe source parsing instead of unsafe split/cast
const addFromSearch = Effect.fn("command.add.fromSearch")(function* (query: string) {
  yield* Console.error(`Searching for "${query}"...`);
  const result = yield* search(query);

  if (result.skills.length === 0) {
    return yield* new SkillsError({
      message: `No skills found for "${query}"`,
      code: "NO_SKILLS_FOUND",
    });
  }

  const exactMatch = result.skills.find(
    (s) => s.skillId === query || s.name.toLowerCase() === query.toLowerCase(),
  );
  const first = result.skills[0];
  if (!first)
    return yield* new SkillsError({
      message: `No skills found for "${query}"`,
      code: "NO_SKILLS_FOUND",
    });
  const skill = exactMatch ?? first;

  if (!exactMatch && result.skills.length > 1) {
    yield* Console.error(`${result.skills.length} results found, installing best match:`);
    for (const s of result.skills.slice(0, 3)) {
      yield* Console.error(`  ${s.name} (${s.source})`);
    }
    yield* Console.error("");
  }
  yield* Console.error(`Installing: ${skill.name} (${skill.source})\n`);

  const parsed = parseSource(skill.source);
  if (parsed._tag !== "GitHubRepo" && parsed._tag !== "GitHubRepoWithSkill") {
    return yield* new SkillsError({
      message: `Failed to fetch: ${skill.source} (Unexpected source format from search API)`,
      code: "FETCH_FAILED",
    });
  }

  yield* addFromRepoWithSkill({
    _tag: "GitHubRepoWithSkill",
    owner: parsed.owner,
    repo: parsed.repo,
    skillFilter: skill.skillId,
  });
});

export const runAdd = Effect.fn("command.add")(function* (
  sourceInput: string | undefined,
  skillFilter?: string,
) {
  const parsed = parseSource(sourceInput ?? ".");

  if (skillFilter && parsed._tag === "GitHubRepo") {
    yield* addFromRepoWithSkill({
      _tag: "GitHubRepoWithSkill",
      owner: parsed.owner,
      repo: parsed.repo,
      skillFilter,
      ref: parsed.ref,
    });
    return;
  }

  switch (parsed._tag) {
    case "GitHubRepo":
      yield* addFromRepo(parsed);
      break;
    case "GitHubRepoWithSkill":
      yield* addFromRepoWithSkill(parsed);
      break;
    case "LocalPath":
      yield* addFromLocal(parsed, skillFilter);
      break;
    case "SearchQuery":
      yield* addFromSearch(parsed.query);
      break;
  }
});
