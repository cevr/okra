/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/preferSchemaOverJson:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Exit, Layer, Option } from "effect";
import { BunServices } from "@effect/platform-bun";
import { ConfigService } from "../../../src/brain/services/Config.js";
import { BrainError } from "../../../src/brain/errors/index.js";
import { withTempDir } from "../helpers/index.js";

// Simulate vault command handler logic
const runVault = (opts: { project: boolean; global: boolean; json: boolean }) =>
  Effect.gen(function* () {
    const config = yield* ConfigService;

    if (opts.json) {
      const globalPath = yield* config.globalVaultPath();
      const projectPath = yield* config.projectVaultPath();
      const active = yield* config.activeVaultPath();
      return JSON.parse(
        JSON.stringify({
          global: globalPath,
          project: Option.getOrNull(projectPath),
          active,
        }),
      ) as Record<string, unknown>;
    }

    if (opts.global) {
      return yield* config.globalVaultPath();
    } else if (opts.project) {
      const p = yield* config.projectVaultPath();
      if (Option.isSome(p)) {
        return p.value;
      }
      return yield* new BrainError({
        message: "No project vault found",
        code: "NOT_INITIALIZED",
      });
    } else {
      return yield* config.activeVaultPath();
    }
  });

const makeTestConfig = (globalVault: string, projectVault: Option.Option<string> = Option.none()) =>
  Layer.succeed(ConfigService, {
    globalVaultPath: () => Effect.succeed(globalVault),
    projectVaultPath: () => Effect.succeed(projectVault),
    activeVaultPath: () =>
      Effect.succeed(Option.isSome(projectVault) ? projectVault.value : globalVault),
    currentProjectName: () => Effect.succeed(Option.none()),
    configFilePath: () => Effect.succeed("/tmp/config.json"),
    defaultProvider: () => Effect.succeed(Option.none()),
    loadConfigFile: () => Effect.succeed({}),
    saveConfigFile: () => Effect.void,
  });

describe("vault", () => {
  it.live("returns active vault path", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const result = yield* runVault({ project: false, global: false, json: false }).pipe(
          Effect.provide(makeTestConfig(dir)),
        );
        expect(result).toBe(dir);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("returns global path with --global", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const projectDir = `${dir}/project`;
        const result = yield* runVault({ project: false, global: true, json: false }).pipe(
          Effect.provide(makeTestConfig(dir, Option.some(projectDir))),
        );
        expect(result).toBe(dir);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("--project errors when no project vault", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const exit = yield* runVault({ project: true, global: false, json: false }).pipe(
          Effect.provide(makeTestConfig(dir)),
          Effect.exit,
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const reasons = exit.cause.reasons as unknown as ReadonlyArray<{ error: unknown }>;
          expect(reasons[0]!.error).toBeInstanceOf(BrainError);
        }
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("--project returns project path when available", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const projectDir = `${dir}/project`;
        const result = yield* runVault({ project: true, global: false, json: false }).pipe(
          Effect.provide(makeTestConfig(dir, Option.some(projectDir))),
        );
        expect(result).toBe(projectDir);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("--json returns structured output", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const projectDir = `${dir}/project`;
        const result = yield* runVault({ project: false, global: false, json: true }).pipe(
          Effect.provide(makeTestConfig(dir, Option.some(projectDir))),
        );

        const obj = result as Record<string, unknown>;
        expect(obj).toHaveProperty("global");
        expect(obj).toHaveProperty("project");
        expect(obj).toHaveProperty("active");
        expect(obj["global"]).toBe(dir);
        expect(obj["project"]).toBe(projectDir);
        expect(obj["active"]).toBe(projectDir);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
});
