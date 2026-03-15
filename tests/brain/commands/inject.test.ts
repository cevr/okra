/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/preferSchemaOverJson:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { BunServices } from "@effect/platform-bun";
import { ConfigService } from "../../../src/brain/services/Config.js";
import { VaultService } from "../../../src/brain/services/Vault.js";
import { withTempDir } from "../helpers/index.js";

const makeTestConfig = (
  globalVault: string,
  projectVault: Option.Option<string> = Option.none(),
  projectName: Option.Option<string> = Option.none(),
) =>
  Layer.succeed(ConfigService, {
    globalVaultPath: () => Effect.succeed(globalVault),
    projectVaultPath: () => Effect.succeed(projectVault),
    activeVaultPath: () =>
      Effect.succeed(Option.isSome(projectVault) ? projectVault.value : globalVault),
    currentProjectName: () => Effect.succeed(projectName),
    configFilePath: () => Effect.succeed("/tmp/config.json"),
    defaultProvider: () => Effect.succeed(Option.none()),
    loadConfigFile: () => Effect.succeed({}),
    saveConfigFile: () => Effect.void,
  });

// Re-implement inject handler logic for testing (avoid Command.run parser overhead)
const runInject = (opts: { json: boolean }) =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const vault = yield* VaultService;
    const fs = yield* FileSystem;
    const path = yield* Path;

    const [globalPath, projectPath] = yield* Effect.all([
      config.globalVaultPath(),
      config.projectVaultPath(),
    ]);

    const readIndexSafe = (p: string) =>
      vault.readIndex(p).pipe(
        Effect.catchTag("@cvr/okra/brain/VaultError", (e) => {
          if (e.code === "INDEX_MISSING" || e.code === "READ_FAILED") {
            return Effect.succeed("");
          }
          return Effect.fail(e);
        }),
      );

    const [globalIndex, projectIndex] = Option.isSome(projectPath)
      ? yield* Effect.all([readIndexSafe(globalPath), readIndexSafe(projectPath.value)])
      : [yield* readIndexSafe(globalPath), ""];

    if (globalIndex.length === 0 && projectIndex.length === 0) return null;

    // Detect project-specific notes
    const projectName = yield* config.currentProjectName();
    let projectNotes = "";
    let detectedProject: string | null = null;
    if (Option.isSome(projectName)) {
      const projectDir = path.join(globalPath, "projects", projectName.value);
      const dirExists = yield* fs
        .exists(projectDir)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (dirExists) {
        const files = yield* vault
          .listFiles(projectDir)
          .pipe(Effect.catch(() => Effect.succeed([] as string[])));
        if (files.length > 0) {
          detectedProject = projectName.value;
          projectNotes = files.map((f) => `- [[projects/${projectName.value}/${f}]]`).join("\n");
        }
      }
    }

    if (opts.json) {
      return JSON.parse(
        JSON.stringify({
          global: globalIndex,
          project: Option.isSome(projectPath) && projectIndex.length > 0 ? projectIndex : null,
          projectName: detectedProject,
          projectNotes: projectNotes.length > 0 ? projectNotes : null,
          index:
            globalIndex +
            (projectNotes.length > 0 ? "\n" + projectNotes : "") +
            (projectIndex.length > 0 ? "\n" + projectIndex : ""),
        }),
      ) as Record<string, unknown>;
    }

    let output = "Brain vault — read relevant files before acting:\n\n";
    output += globalIndex;

    if (projectNotes.length > 0) {
      output += `\n## Project: ${detectedProject}\n${projectNotes}\n`;
    }

    if (Option.isSome(projectPath) && projectIndex.length > 0) {
      output += "\n---\n\n";
      output += `Project vault: ${projectPath.value}\n\n`;
      output += projectIndex;
    }

    return output;
  });

describe("inject", () => {
  it.live("outputs index content from global vault", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* vault.rebuildIndex(dir);

        const result = yield* runInject({ json: false }).pipe(Effect.provide(makeTestConfig(dir)));

        expect(result).toBeTypeOf("string");
        expect(result as string).toContain("Brain vault");
        expect(result as string).toContain("principles/testing");
      }),
    ).pipe(Effect.provide(VaultService.layer.pipe(Layer.provideMerge(BunServices.layer)))),
  );

  it.live("returns null when vault missing (graceful)", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const missingPath = `${dir}/nonexistent`;
        const result = yield* runInject({ json: false }).pipe(
          Effect.provide(makeTestConfig(missingPath)),
        );

        expect(result).toBeNull();
      }),
    ).pipe(Effect.provide(VaultService.layer.pipe(Layer.provideMerge(BunServices.layer)))),
  );

  it.live("--json outputs structured object", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* vault.rebuildIndex(dir);

        const result = yield* runInject({ json: true }).pipe(Effect.provide(makeTestConfig(dir)));

        expect(result).not.toBeNull();
        const obj = result as Record<string, unknown>;
        expect(obj).toHaveProperty("global");
        expect(obj).toHaveProperty("project");
        expect(obj).toHaveProperty("projectName");
        expect(obj).toHaveProperty("projectNotes");
        expect(obj).toHaveProperty("index");
        expect(obj["global"]).toBeTypeOf("string");
        expect(obj["project"]).toBeNull();
        expect(obj["projectName"]).toBeNull();
        expect(obj["projectNotes"]).toBeNull();
        expect(obj["index"] as string).toContain("principles/testing");
      }),
    ).pipe(Effect.provide(VaultService.layer.pipe(Layer.provideMerge(BunServices.layer)))),
  );

  it.live("handles project vault overlay", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        const globalDir = `${dir}/global`;
        const projectDir = `${dir}/project`;

        // Set up both vaults
        yield* vault.init(globalDir);
        yield* fs.writeFileString(`${globalDir}/principles/global-note.md`, "# Global\n");
        yield* vault.rebuildIndex(globalDir);

        yield* vault.init(projectDir);
        yield* fs.writeFileString(`${projectDir}/plans/local-note.md`, "# Local\n");
        yield* vault.rebuildIndex(projectDir);

        const result = yield* runInject({ json: true }).pipe(
          Effect.provide(makeTestConfig(globalDir, Option.some(projectDir))),
        );

        expect(result).not.toBeNull();
        const obj = result as Record<string, unknown>;
        expect(obj["global"]).toBeTypeOf("string");
        expect(obj["project"]).toBeTypeOf("string");
        expect(obj["global"] as string).toContain("global-note");
        expect(obj["project"] as string).toContain("local-note");
        expect(obj["index"] as string).toContain("global-note");
        expect(obj["index"] as string).toContain("local-note");
      }),
    ).pipe(Effect.provide(VaultService.layer.pipe(Layer.provideMerge(BunServices.layer)))),
  );

  it.live("injects project-specific notes from projects/<name>/", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.makeDirectory(`${dir}/projects/myapp`, { recursive: true });
        yield* fs.writeFileString(`${dir}/projects/myapp/api-notes.md`, "# API\n");
        yield* fs.writeFileString(`${dir}/projects/myapp/deploy.md`, "# Deploy\n");
        yield* vault.rebuildIndex(dir);

        const result = yield* runInject({ json: true }).pipe(
          Effect.provide(makeTestConfig(dir, Option.none(), Option.some("myapp"))),
        );

        expect(result).not.toBeNull();
        const obj = result as Record<string, unknown>;
        expect(obj["projectName"]).toBe("myapp");
        expect(obj["projectNotes"]).toBeTypeOf("string");
        expect(obj["projectNotes"] as string).toContain("[[projects/myapp/api-notes]]");
        expect(obj["projectNotes"] as string).toContain("[[projects/myapp/deploy]]");
        expect(obj["index"] as string).toContain("projects/myapp/api-notes");
      }),
    ).pipe(Effect.provide(VaultService.layer.pipe(Layer.provideMerge(BunServices.layer)))),
  );

  it.live("skips project notes when projects/<name>/ doesn't exist", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* vault.rebuildIndex(dir);

        const result = yield* runInject({ json: true }).pipe(
          Effect.provide(makeTestConfig(dir, Option.none(), Option.some("nonexistent"))),
        );

        expect(result).not.toBeNull();
        const obj = result as Record<string, unknown>;
        expect(obj["projectName"]).toBeNull();
        expect(obj["projectNotes"]).toBeNull();
      }),
    ).pipe(Effect.provide(VaultService.layer.pipe(Layer.provideMerge(BunServices.layer)))),
  );
});
