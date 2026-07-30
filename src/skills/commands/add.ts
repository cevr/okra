import { Config, ConfigProvider, Console, Effect, FileSystem, Option, Path, Result } from "effect";
import { Prompt } from "effect/unstable/cli";
import { SkillsError } from "../errors.js";
import { walkDir } from "../lib/fs.js";
import { DEFAULT_REF, SKILL_DIR_PREFIXES } from "../lib/constants.js";
import { tryParseFrontmatter, type SkillFrontmatter } from "../lib/frontmatter.js";
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
import { make as makeProgress, type Progress, type SkillStatus } from "../lib/progress.js";

export interface InstalledEntry {
  readonly name: string;
  readonly source: string;
  readonly skillPath: string;
  readonly ref?: string;
}

interface InstallPlan {
  readonly displayName: string;
  readonly run: Effect.Effect<
    InstalledEntry,
    SkillsError,
    GitHub | SkillStore | FileSystem.FileSystem | Path.Path
  >;
}

interface InstalledSkills {
  readonly names: ReadonlySet<string>;
  readonly locations: ReadonlySet<string>;
}

interface SelectCandidate<A> {
  readonly name: string;
  readonly value: A;
  readonly installed: boolean;
}

interface SelectChoiceValue<A> {
  readonly value: A;
  readonly installed: boolean;
}

const installedLocation = (source: string, skillPath: string): string =>
  `${source}\u0000${skillPath}`;

const dimInstalled = (name: string): string => `\u001b[2m${name} (installed)\u001b[22m`;

// "." means the skills live directly under the input path, not in a subdirectory.
const resolveSearchDir = (pathService: Path.Path, absPath: string, prefix: string): string => {
  if (prefix === ".") return absPath;
  return pathService.join(absPath, prefix);
};

// An empty skillDir means the skill sits at the repo root, so the repo name stands in.
const fallbackSkillName = (skillDir: string, repo: string): string => {
  if (!skillDir) return repo;
  return skillDir.split("/").at(-1) ?? "unknown";
};

const skillMdPathFor = (skillDir: string): string => {
  if (!skillDir) return "SKILL.md";
  return `${skillDir}/SKILL.md`;
};

// A subpath may point at either the SKILL.md file or the directory holding it.
const skillDirFromSubpath = (subpath: string): string => {
  if (subpath.endsWith("SKILL.md")) return subpath.split("/").slice(0, -1).join("/");
  return subpath;
};

const refSuffix = (ref?: string): string => {
  if (ref) return `#${ref}`;
  return "";
};

// The first plan for a display name keeps it; later ones carry their source.
const disambiguate = (base: string, source: string, count: number): string => {
  if (count === 0) return base;
  return `${base} (${source})`;
};

const statusFromResult = (result: Result.Result<InstalledEntry, string>): SkillStatus => {
  if (Result.isFailure(result)) return "failed";
  return "installed";
};

export const makeSelectChoices = <A>(
  candidates: ReadonlyArray<SelectCandidate<A>>,
): ReadonlyArray<{
  readonly title: string;
  readonly value: SelectChoiceValue<A>;
  readonly disabled: boolean;
}> =>
  candidates.map((candidate) => {
    if (candidate.installed) {
      return {
        title: dimInstalled(candidate.name),
        value: { value: candidate.value, installed: true },
        disabled: true,
      };
    }
    return {
      title: candidate.name,
      value: { value: candidate.value, installed: false },
      disabled: false,
    };
  });

const loadInstalledSkills = Effect.fn("command.add.loadInstalledSkills")(function* () {
  const store = yield* SkillStore;
  const lock = yield* SkillLock;
  const pathService = yield* Path.Path;
  const [skills, lockFile] = yield* Effect.all([store.list, lock.read]);

  const names = new Set<string>();
  for (const skill of skills) {
    names.add(toKebab(skill.name));
    names.add(toKebab(pathService.basename(skill.dirPath)));
  }

  const locations = new Set<string>();
  for (const [name, entry] of Object.entries(lockFile.skills)) {
    if (names.has(toKebab(name))) {
      locations.add(installedLocation(entry.source, entry.skillPath));
    }
  }

  return { names, locations } satisfies InstalledSkills;
});

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
  let frontmatter: Option.Option<SkillFrontmatter> = Option.none();
  if (skillMd) {
    frontmatter = yield* tryParseFrontmatter(skillMd.content);
  }

  const name = Option.match(frontmatter, {
    onNone: () => fallbackSkillName(skillDir, repo),
    onSome: (fm) => toKebab(fm.name),
  });
  const skillMdPath = skillMdPathFor(skillDir);

  yield* store.syncDir(name, files);

  return { name, source: sourceStr, skillPath: skillMdPath, ref } satisfies InstalledEntry;
});

const installLocalSkillDir = Effect.fn("command.add.installLocalSkillDir")(function* (
  dirPath: string,
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
  let frontmatter: Option.Option<SkillFrontmatter> = Option.none();
  if (skillMd) {
    frontmatter = yield* tryParseFrontmatter(skillMd.content);
  }

  const fallbackName = pathService.basename(absPath);
  const name = Option.match(frontmatter, {
    onNone: () => fallbackName,
    onSome: (fm) => toKebab(fm.name),
  });

  const sourceStr = `local:${absPath}`;
  yield* store.syncDir(name, files);

  return { name, source: sourceStr, skillPath: "SKILL.md" } satisfies InstalledEntry;
});

interface LocalSkillCandidate {
  readonly absPath: string;
  readonly name: string;
}

const discoverLocalCandidates = Effect.fn("command.add.discoverLocalCandidates")(function* (
  source: LocalPath,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const homeOpt = yield* Config.option(Config.string("HOME"))
    .parse(ConfigProvider.fromEnv())
    .pipe(Effect.orElseSucceed(() => Option.none<string>()));
  const expandHome = (): string => {
    if (!source.path.startsWith("~")) return source.path;
    return pathService.join(
      Option.getOrElse(homeOpt, () => ""),
      source.path.slice(1),
    );
  };
  const absPath = pathService.resolve(expandHome());

  const exists = yield* fs.exists(absPath).pipe(Effect.orDie);
  if (!exists) {
    return yield* new SkillsError({
      message: `Path not found: ${absPath}`,
      code: "NO_SKILLS_FOUND",
    });
  }

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
    return [{ absPath, name }] as ReadonlyArray<LocalSkillCandidate>;
  }

  const candidates: Array<LocalSkillCandidate> = [];

  for (const prefix of [...SKILL_DIR_PREFIXES, "."]) {
    const searchDir = resolveSearchDir(pathService, absPath, prefix);
    const searchExists = yield* fs.exists(searchDir).pipe(Effect.orDie);
    if (!searchExists) continue;

    const entries = yield* fs.readDirectory(searchDir).pipe(Effect.orDie);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const entryPath = pathService.join(searchDir, entry);
      const stat = yield* fs.stat(entryPath).pipe(Effect.orElseSucceed(() => null));
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
      candidates.push({ absPath: entryPath, name });
    }

    if (candidates.length > 0) break;
  }

  if (candidates.length === 0) {
    return yield* new SkillsError({
      message: `No skills found in ${absPath}`,
      code: "NO_SKILLS_FOUND",
    });
  }

  return candidates as ReadonlyArray<LocalSkillCandidate>;
});

// Multi-select if >1 skill, otherwise auto-install the single one
const selectFrom = Effect.fn("command.add.selectFrom")(function* <A>(
  message: string,
  candidates: ReadonlyArray<SelectCandidate<A>>,
) {
  const single = candidates[0];
  if (candidates.length === 1 && single) {
    if (single.installed) return [] as ReadonlyArray<A>;
    return [single.value] as ReadonlyArray<A>;
  }

  const choices = makeSelectChoices(candidates);
  // Require a pick only when something is actually selectable.
  const minSelections = ((): number => {
    if (choices.some((choice) => !choice.disabled)) return 1;
    return 0;
  })();
  const selected = yield* Prompt.multiSelect({
    message,
    choices,
    min: minSelections,
  });

  // Effect beta.98 can include disabled multi-select choices in the result.
  return selected
    .filter((choice) => !choice.installed)
    .map((choice) => choice.value) as ReadonlyArray<A>;
});

const planFromLocal = Effect.fn("command.add.planFromLocal")(function* (
  source: LocalPath,
  installed: InstalledSkills,
) {
  const candidates = yield* discoverLocalCandidates(source);
  const selected = yield* selectFrom(
    `Select skills to install from ${source.path}`,
    candidates.map((candidate) => ({
      name: candidate.name,
      value: candidate,
      installed: installed.names.has(toKebab(candidate.name)),
    })),
  );
  return selected.map(
    (candidate): InstallPlan => ({
      displayName: candidate.name,
      run: installLocalSkillDir(candidate.absPath),
    }),
  );
});

const planFromRepo = Effect.fn("command.add.planFromRepo")(function* (
  source: GitHubRepo,
  installed: InstalledSkills,
) {
  const { owner, repo, ref, subpath } = source;
  const gh = yield* GitHub;
  const sourceStr = `${owner}/${repo}${refSuffix(ref)}`;

  if (subpath) {
    const skillDir = skillDirFromSubpath(subpath);
    const displayName = fallbackSkillName(skillDir, repo);
    return [
      {
        displayName,
        run: installSkillDir(owner, repo, skillDir, ref, sourceStr),
      },
    ] as ReadonlyArray<InstallPlan>;
  }

  yield* Console.error(`Discovering skills in ${owner}/${repo}...`);
  const skills = yield* gh.discoverSkills(owner, repo, ref);

  if (skills.length === 0) {
    return yield* new SkillsError({
      message: "No skills found in this repository.",
      code: "NO_SKILLS_FOUND",
    });
  }

  const selected = yield* selectFrom(
    `Select skills to install from ${owner}/${repo}`,
    skills.map((skill) => ({
      name: skill.dirName,
      value: skill,
      installed:
        installed.names.has(toKebab(skill.dirName)) ||
        installed.locations.has(installedLocation(sourceStr, skill.skillMdPath)),
    })),
  );

  return selected.map(
    (skill): InstallPlan => ({
      displayName: skill.dirName,
      run: installSkillDir(owner, repo, skill.skillDir, ref, sourceStr),
    }),
  );
});

const planFromRepoWithSkill = Effect.fn("command.add.planFromRepoWithSkill")(function* (
  source: GitHubRepoWithSkill,
) {
  const { owner, repo, skillFilter, ref } = source;
  const gh = yield* GitHub;
  const sourceStr = `${owner}/${repo}@${skillFilter}`;

  const probePaths = [
    ...SKILL_DIR_PREFIXES.map((prefix) => `${prefix}/${skillFilter}`),
    skillFilter,
  ];

  for (const skillDir of probePaths) {
    const directPath = `${skillDir}/SKILL.md`;
    const direct = yield* gh.fetchRaw(owner, repo, directPath, ref).pipe(Effect.option);

    if (direct._tag === "Some") {
      return [
        {
          displayName: skillFilter,
          run: installSkillDir(owner, repo, skillDir, ref, sourceStr),
        },
      ] as ReadonlyArray<InstallPlan>;
    }
  }

  const rootContent = yield* gh.fetchRaw(owner, repo, "SKILL.md", ref).pipe(Effect.option);

  if (rootContent._tag === "Some") {
    const frontmatter = yield* tryParseFrontmatter(rootContent.value);
    if (Option.isSome(frontmatter) && toKebab(frontmatter.value.name) === toKebab(skillFilter)) {
      return [
        {
          displayName: skillFilter,
          run: installSkillDir(owner, repo, "", ref, sourceStr),
        },
      ] as ReadonlyArray<InstallPlan>;
    }
  }

  const skills = yield* gh.discoverSkills(owner, repo, ref);

  for (const skill of skills) {
    const content = yield* gh.fetchRaw(owner, repo, skill.skillMdPath, ref);
    const frontmatter = yield* tryParseFrontmatter(content);
    if (Option.isSome(frontmatter) && toKebab(frontmatter.value.name) === toKebab(skillFilter)) {
      return [
        {
          displayName: skillFilter,
          run: installSkillDir(owner, repo, skill.skillDir, ref, sourceStr),
        },
      ] as ReadonlyArray<InstallPlan>;
    }
  }

  return yield* new SkillsError({
    message: `Skill not found: ${skillFilter}`,
    code: "SKILL_NOT_FOUND",
  });
});

const planFromSearch = Effect.fn("command.add.planFromSearch")(function* (query: string) {
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
  yield* Console.error(`Installing: ${skill.name} (${skill.source})`);

  const parsed = parseSource(skill.source);
  if (parsed._tag !== "GitHubRepo" && parsed._tag !== "GitHubRepoWithSkill") {
    return yield* new SkillsError({
      message: `Failed to fetch: ${skill.source} (Unexpected source format from search API)`,
      code: "FETCH_FAILED",
    });
  }

  return yield* planFromRepoWithSkill({
    _tag: "GitHubRepoWithSkill",
    owner: parsed.owner,
    repo: parsed.repo,
    skillFilter: skill.skillId,
  });
});

const planFromSource = Effect.fn("command.add.planFromSource")(function* (
  sourceInput: string,
  installed: InstalledSkills,
) {
  const parsed = parseSource(sourceInput);
  switch (parsed._tag) {
    case "GitHubRepo":
      return yield* planFromRepo(parsed, installed);
    case "GitHubRepoWithSkill":
      return yield* planFromRepoWithSkill(parsed);
    case "LocalPath":
      return yield* planFromLocal(parsed, installed);
    case "SearchQuery":
      return yield* planFromSearch(parsed.query);
  }
});

// Disambiguate display names so progress lines stay unique across sources
const dedupeDisplayNames = (
  plans: ReadonlyArray<{ source: string; plans: ReadonlyArray<InstallPlan> }>,
): ReadonlyArray<{ source: string; key: string; plan: InstallPlan }> => {
  const seen = new Map<string, number>();
  const out: Array<{ source: string; key: string; plan: InstallPlan }> = [];
  for (const { source, plans: ps } of plans) {
    for (const plan of ps) {
      const base = plan.displayName;
      const count = seen.get(base) ?? 0;
      const key = disambiguate(base, source, count);
      seen.set(base, count + 1);
      out.push({ source, key, plan });
    }
  }
  return out;
};

const runOne = Effect.fn("command.add.runOne")(function* (
  progress: Progress,
  key: string,
  plan: InstallPlan,
) {
  yield* progress.setStatus(key, "running");
  const result = yield* plan.run.pipe(
    Effect.map(Result.succeed),
    Effect.catchTag("@cvr/okra/skills/SkillsError", (error) =>
      Effect.succeed(Result.fail(error.message)),
    ),
  );
  const status: SkillStatus = statusFromResult(result);
  yield* progress.setStatus(key, status);
  return { key, result };
});

export const runAdd = Effect.fn("command.add")(function* (sources: ReadonlyArray<string>) {
  const lock = yield* SkillLock;
  const installedIndex = yield* loadInstalledSkills();

  // Phase 1: discovery + prompts (sequential — prompts can't overlap)
  const planResults: Array<{ source: string; plans: ReadonlyArray<InstallPlan> }> = [];
  const planFailures: Array<{ source: string; note: string }> = [];

  for (const source of sources) {
    const result = yield* planFromSource(source, installedIndex).pipe(
      Effect.map(Result.succeed),
      Effect.catchTag("@cvr/okra/skills/SkillsError", (error) =>
        Effect.succeed(Result.fail(error.message)),
      ),
    );
    if (Result.isFailure(result)) {
      planFailures.push({ source, note: result.failure });
    } else {
      planResults.push({ source, plans: result.success });
    }
  }

  const items = dedupeDisplayNames(planResults);

  if (items.length === 0) {
    for (const { source, note } of planFailures) {
      yield* Console.error(`  Failed: ${source}: ${note}`);
    }
    if (planFailures.length === 0) {
      yield* Console.log("Nothing to install.");
    }
    return;
  }

  // Phase 2: parallel install with live progress
  const progress = yield* makeProgress(
    items.map((i) => i.key),
    { runningVerb: "installing" },
  );

  const installResults = yield* Effect.forEach(
    items,
    ({ key, plan }) => runOne(progress, key, plan),
    { concurrency: 5 },
  ).pipe(Effect.ensuring(progress.finish));

  const installed: Array<InstalledEntry> = [];
  const installFailures: Array<{ key: string; note: string }> = [];
  for (const { key, result } of installResults) {
    if (Result.isFailure(result)) {
      installFailures.push({ key, note: result.failure });
    } else {
      installed.push(result.success);
    }
  }

  if (installed.length > 0) {
    yield* lock.addMany(installed);
  }

  for (const { source, note } of planFailures) {
    yield* Console.error(`  Failed: ${source}: ${note}`);
  }
  for (const { key, note } of installFailures) {
    yield* Console.error(`  Failed: ${key}: ${note}`);
  }

  const totalFailed = planFailures.length + installFailures.length;
  const parts: Array<string> = [];
  if (installed.length > 0) parts.push(`${installed.length} installed`);
  if (totalFailed > 0) parts.push(`${totalFailed} failed`);
  if (parts.length > 0) {
    yield* Console.log(`\n${parts.join(", ")}.`);
  }
});
