// @effect-diagnostics effect/strictBooleanExpressions:off effect/strictEffectProvide:off
import { Config, Effect, FileSystem, Layer, Option, Path, ServiceMap } from "effect";
import { SkillsError } from "../errors.js";
import { tryParseFrontmatter } from "../lib/frontmatter.js";
import { walkDir } from "../lib/fs.js";

export interface InstalledSkill {
  readonly name: string;
  readonly description: string;
  readonly dirPath: string;
}

export class SkillStore extends ServiceMap.Service<
  SkillStore,
  {
    readonly dir: string;
    readonly list: Effect.Effect<ReadonlyArray<InstalledSkill>>;
    readonly read: (name: string) => Effect.Effect<string, SkillsError>;
    readonly readDir: (
      name: string,
    ) => Effect.Effect<ReadonlyArray<{ path: string; content: string }>>;
    readonly installDir: (
      name: string,
      files: ReadonlyArray<{ path: string; content: string }>,
    ) => Effect.Effect<void>;
    readonly syncDir: (
      name: string,
      files: ReadonlyArray<{ path: string; content: string }>,
    ) => Effect.Effect<void>;
    readonly remove: (name: string) => Effect.Effect<void, SkillsError>;
  }
>()("@cvr/okra/skills/services/SkillStore") {}

const skillsDirConfig = Config.option(Config.string("SKILLS_DIR"));

const defaultSkillsDir = Config.string("HOME").pipe(
  Config.map((home) => `${home}/Developer/personal/dotfiles/skills`),
);

export const SkillStoreLive = Layer.effect(
  SkillStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    const configDir = yield* skillsDirConfig;
    const dir = Option.isSome(configDir) ? configDir.value : yield* defaultSkillsDir;

    const list: Effect.Effect<ReadonlyArray<InstalledSkill>> = Effect.gen(function* () {
      const exists = yield* fs.exists(dir);
      if (!exists) return [];

      const entries = yield* fs.readDirectory(dir);

      const skills = yield* Effect.forEach(
        entries.filter((e) => !e.startsWith(".")),
        (entry) =>
          Effect.gen(function* () {
            const entryPath = pathService.join(dir, entry);
            const stat = yield* fs.stat(entryPath).pipe(Effect.catch(() => Effect.succeed(null)));
            if (!stat || stat.type !== "Directory") return null;

            const skillMdPath = pathService.join(entryPath, "SKILL.md");
            const hasSkillMd = yield* fs.exists(skillMdPath);
            if (!hasSkillMd) return null;

            const content = yield* fs.readFileString(skillMdPath);
            const frontmatter = yield* tryParseFrontmatter(content);

            return {
              name: Option.match(frontmatter, {
                onNone: () => entry,
                onSome: (fm) => fm.name,
              }),
              description: Option.match(frontmatter, {
                onNone: () => "",
                onSome: (fm) => fm.description,
              }),
              dirPath: entryPath,
            } as InstalledSkill;
          }),
        { concurrency: "unbounded" },
      );

      return skills
        .filter((s): s is InstalledSkill => s !== null)
        .toSorted((a, b) => a.name.localeCompare(b.name));
    }).pipe(Effect.orDie, Effect.withSpan("SkillStore.list"));

    const read = (name: string) =>
      Effect.gen(function* () {
        const skillMdPath = pathService.join(dir, name, "SKILL.md");
        const exists = yield* fs.exists(skillMdPath).pipe(Effect.orDie);
        if (!exists)
          return yield* new SkillsError({
            message: `Skill not found: ${name}`,
            code: "SKILL_NOT_FOUND",
          });
        return yield* fs.readFileString(skillMdPath).pipe(Effect.orDie);
      }).pipe(Effect.withSpan("SkillStore.read", { attributes: { name } }));

    const platformLayer = Layer.merge(
      Layer.succeed(FileSystem.FileSystem, fs),
      Layer.succeed(Path.Path, pathService),
    );

    const readDir = (name: string) =>
      walkDir(pathService.join(dir, name)).pipe(
        Effect.provide(platformLayer),
        Effect.withSpan("SkillStore.readDir", { attributes: { name } }),
      );

    const installDir = (name: string, files: ReadonlyArray<{ path: string; content: string }>) =>
      Effect.gen(function* () {
        const skillDir = pathService.join(dir, name);
        yield* fs.makeDirectory(skillDir, { recursive: true });
        for (const file of files) {
          const filePath = pathService.join(skillDir, file.path);
          const fileDir = pathService.dirname(filePath);
          yield* fs.makeDirectory(fileDir, { recursive: true });
          yield* fs.writeFileString(filePath, file.content);
        }
      }).pipe(Effect.orDie, Effect.withSpan("SkillStore.installDir", { attributes: { name } }));

    const syncDir = (name: string, files: ReadonlyArray<{ path: string; content: string }>) =>
      Effect.gen(function* () {
        const skillDir = pathService.join(dir, name);
        const exists = yield* fs.exists(skillDir).pipe(Effect.orDie);
        if (exists) {
          yield* fs.remove(skillDir, { recursive: true }).pipe(Effect.orDie);
        }
        yield* installDir(name, files);
      }).pipe(Effect.orDie, Effect.withSpan("SkillStore.syncDir", { attributes: { name } }));

    const remove = (name: string) =>
      Effect.gen(function* () {
        const skillDir = pathService.join(dir, name);
        const exists = yield* fs.exists(skillDir).pipe(Effect.orDie);
        if (!exists)
          return yield* new SkillsError({
            message: `Skill not found: ${name}`,
            code: "SKILL_NOT_FOUND",
          });
        yield* fs.remove(skillDir, { recursive: true }).pipe(Effect.orDie);
      }).pipe(Effect.withSpan("SkillStore.remove", { attributes: { name } }));

    return { dir, list, read, readDir, installDir, syncDir, remove };
  }),
);
