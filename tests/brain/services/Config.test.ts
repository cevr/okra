import { describe, it, expect } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Option, Schema } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { layerNoop } from "effect/FileSystem";
import { PlatformError, SystemError } from "effect/PlatformError";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner";
import { ConfigService } from "../../../src/brain/services/Config.js";

const encodeConfigFileJson = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      globalVault: Schema.optional(Schema.String),
      defaultProvider: Schema.optional(Schema.String),
    }),
  ),
);

const existsOnly = (target: string) => (path: string) => Effect.succeed(path === target);

const notFound = () =>
  Effect.fail(
    new PlatformError(
      new SystemError({ _tag: "NotFound", module: "FileSystem", method: "readFileString" }),
    ),
  );

// Minimal noop FS — Config only does exists/readFileString/writeFileString/makeDirectory
const noopFs = layerNoop({
  exists: () => Effect.succeed(false),
  readFileString: () => notFound(),
  writeFileString: () => Effect.void,
  makeDirectory: () => Effect.void,
});

// Override the ambient ConfigProvider for the test scope. `fromEnv` matches the
// production default's path-splitting semantics so the src/ code reads keys the
// same way it would from real env vars.
const envLayer = (env: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env }));

// The spawner shells out for real (git rev-parse), so it gets the real FileSystem.
// ConfigService itself still sees the noop FS, which keeps the tests hermetic.
const spawnerLayer = BunChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
);

const fsLayerFor = (fsOverrides?: Partial<FileSystem>) =>
  Option.match(Option.fromUndefinedOr(fsOverrides), {
    onNone: () => noopFs,
    onSome: (overrides) => layerNoop(overrides),
  });

const makeTestLayer = (env: Record<string, string>, fsOverrides?: Partial<FileSystem>) =>
  Layer.mergeAll(
    ConfigService.layer.pipe(
      Layer.provide(Layer.mergeAll(fsLayerFor(fsOverrides), BunPath.layer, spawnerLayer)),
    ),
    envLayer(env),
  );

describe("ConfigService", () => {
  describe("globalVaultPath", () => {
    it.effect("returns BRAIN_DIR env when set", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.globalVaultPath;
        expect(result).toBe("/custom/brain");
      }).pipe(Effect.provide(makeTestLayer({ BRAIN_DIR: "/custom/brain" }))),
    );

    it.effect("falls back to ~/.brain when no env or config", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.globalVaultPath;
        expect(result).toBe("/test-home/.brain");
      }).pipe(Effect.provide(makeTestLayer({ HOME: "/test-home" }))),
    );
  });

  describe("loadConfigFile", () => {
    it.effect("returns {} when no config exists", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.loadConfigFile;
        expect(result).toEqual({});
      }).pipe(Effect.provide(makeTestLayer({ HOME: "/test-home" }))),
    );

    it.effect("parses config file when it exists", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.loadConfigFile;
        expect(result).toEqual({ globalVault: "/my/vault" });
      }).pipe(
        Effect.provide(
          makeTestLayer(
            { HOME: "/test-home" },
            {
              exists: () => Effect.succeed(true),
              readFileString: () =>
                Effect.succeed(encodeConfigFileJson({ globalVault: "/my/vault" })),
              writeFileString: () => Effect.void,
              makeDirectory: () => Effect.void,
            },
          ),
        ),
      ),
    );
  });

  describe("configFilePath", () => {
    it.effect("uses XDG_CONFIG_HOME when set", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.configFilePath;
        expect(result).toBe("/custom/config/brain/config.json");
      }).pipe(Effect.provide(makeTestLayer({ XDG_CONFIG_HOME: "/custom/config" }))),
    );
  });

  describe("defaultProvider", () => {
    it.effect("returns None when provider is unset", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.defaultProvider;
        expect(Option.isNone(result)).toBe(true);
      }).pipe(Effect.provide(makeTestLayer({ HOME: "/test-home" }))),
    );

    it.effect("returns config defaultProvider when set", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.defaultProvider;
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe("codex");
        }
      }).pipe(
        Effect.provide(
          makeTestLayer(
            { HOME: "/test-home" },
            {
              exists: () => Effect.succeed(true),
              readFileString: () =>
                Effect.succeed(encodeConfigFileJson({ defaultProvider: "codex" })),
              writeFileString: () => Effect.void,
              makeDirectory: () => Effect.void,
            },
          ),
        ),
      ),
    );
  });

  describe("projectVaultPath", () => {
    it.effect("returns Some when CLAUDE_PROJECT_DIR has brain/index.md", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.projectVaultPath;
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe("/projects/myapp/brain");
        }
      }).pipe(
        Effect.provide(
          makeTestLayer(
            { CLAUDE_PROJECT_DIR: "/projects/myapp" },
            {
              exists: existsOnly("/projects/myapp/brain/index.md"),
              readFileString: () => notFound(),
              writeFileString: () => Effect.void,
              makeDirectory: () => Effect.void,
            },
          ),
        ),
      ),
    );

    it.effect("returns None when CLAUDE_PROJECT_DIR brain/ has no index.md", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.projectVaultPath;
        expect(Option.isNone(result)).toBe(true);
      }).pipe(
        Effect.provide(
          makeTestLayer(
            { CLAUDE_PROJECT_DIR: "/projects/myapp" },
            {
              exists: () => Effect.succeed(false),
              readFileString: () => notFound(),
              writeFileString: () => Effect.void,
              makeDirectory: () => Effect.void,
            },
          ),
        ),
      ),
    );
  });

  describe("currentProjectName", () => {
    it.effect("returns BRAIN_PROJECT env when set", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.currentProjectName;
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe("myapp");
        }
      }).pipe(Effect.provide(makeTestLayer({ BRAIN_PROJECT: "myapp" }))),
    );

    it.live("falls back to git root basename", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.currentProjectName;
        // We're running inside the okra repo, so git root basename should be "okra"
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe("okra");
        }
      }).pipe(Effect.provide(makeTestLayer({}))),
    );
  });
});
