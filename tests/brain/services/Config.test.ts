/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/strictBooleanExpressions:skip-file effect/unnecessaryPipeChain:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Layer, Option } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { layerNoop } from "effect/FileSystem";
import { PlatformError, SystemError } from "effect/PlatformError";
import * as BunPath from "@effect/platform-bun/BunPath";
import { ConfigService } from "../../../src/brain/services/Config.js";

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

const makeTestLayer = (fsOverrides?: Partial<FileSystem>) =>
  ConfigService.layer.pipe(
    Layer.provide(Layer.mergeAll(fsOverrides ? layerNoop(fsOverrides) : noopFs, BunPath.layer)),
  );

describe("ConfigService", () => {
  describe("globalVaultPath", () => {
    it.live("returns BRAIN_DIR env when set", () => {
      const original = process.env["BRAIN_DIR"];
      process.env["BRAIN_DIR"] = "/custom/brain";
      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.globalVaultPath();
        expect(result).toBe("/custom/brain");
      })
        .pipe(Effect.provide(makeTestLayer()))
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (original === undefined) delete process.env["BRAIN_DIR"];
              else process.env["BRAIN_DIR"] = original;
            }),
          ),
        );
    });

    it.live("falls back to ~/.brain when no env or config", () => {
      const original = process.env["BRAIN_DIR"];
      delete process.env["BRAIN_DIR"];
      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.globalVaultPath();
        const home = process.env["HOME"] ?? process.env["USERPROFILE"];
        expect(result).toBe(`${home}/.brain`);
      })
        .pipe(Effect.provide(makeTestLayer()))
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (original !== undefined) process.env["BRAIN_DIR"] = original;
            }),
          ),
        );
    });
  });

  describe("loadConfigFile", () => {
    it.live("returns {} when no config exists", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.loadConfigFile();
        expect(result).toEqual({});
      }).pipe(Effect.provide(makeTestLayer())),
    );

    it.live("parses config file when it exists", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.loadConfigFile();
        expect(result).toEqual({ globalVault: "/my/vault" });
      }).pipe(
        Effect.provide(
          makeTestLayer({
            exists: () => Effect.succeed(true),
            readFileString: () => Effect.succeed(JSON.stringify({ globalVault: "/my/vault" })),
            writeFileString: () => Effect.void,
            makeDirectory: () => Effect.void,
          }),
        ),
      ),
    );
  });

  describe("configFilePath", () => {
    it.live("uses XDG_CONFIG_HOME when set", () => {
      // XDG_CONFIG_HOME is captured at layer construction time,
      // so we must set it before building the layer
      const original = process.env["XDG_CONFIG_HOME"];
      process.env["XDG_CONFIG_HOME"] = "/custom/config";
      const layer = makeTestLayer();
      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.configFilePath();
        expect(result).toBe("/custom/config/brain/config.json");
      })
        .pipe(Effect.provide(layer))
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (original === undefined) delete process.env["XDG_CONFIG_HOME"];
              else process.env["XDG_CONFIG_HOME"] = original;
            }),
          ),
        );
    });
  });

  describe("defaultProvider", () => {
    it.live("returns None when provider is unset", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.defaultProvider();
        expect(Option.isNone(result)).toBe(true);
      }).pipe(Effect.provide(makeTestLayer())),
    );

    it.live("returns config defaultProvider when set", () =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.defaultProvider();
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe("codex");
        }
      }).pipe(
        Effect.provide(
          makeTestLayer({
            exists: () => Effect.succeed(true),
            readFileString: () => Effect.succeed(JSON.stringify({ defaultProvider: "codex" })),
            writeFileString: () => Effect.void,
            makeDirectory: () => Effect.void,
          }),
        ),
      ),
    );
  });

  describe("projectVaultPath", () => {
    it.live("returns Some when CLAUDE_PROJECT_DIR has brain/index.md", () => {
      const origClaude = process.env["CLAUDE_PROJECT_DIR"];
      const origBrain = process.env["BRAIN_PROJECT_DIR"];
      process.env["CLAUDE_PROJECT_DIR"] = "/projects/myapp";
      delete process.env["BRAIN_PROJECT_DIR"];
      const layer = makeTestLayer({
        exists: (path) =>
          path === "/projects/myapp/brain/index.md" ? Effect.succeed(true) : Effect.succeed(false),
        readFileString: () => notFound(),
        writeFileString: () => Effect.void,
        makeDirectory: () => Effect.void,
      });
      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.projectVaultPath();
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe("/projects/myapp/brain");
        }
      })
        .pipe(Effect.provide(layer))
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (origClaude === undefined) delete process.env["CLAUDE_PROJECT_DIR"];
              else process.env["CLAUDE_PROJECT_DIR"] = origClaude;
              if (origBrain === undefined) delete process.env["BRAIN_PROJECT_DIR"];
              else process.env["BRAIN_PROJECT_DIR"] = origBrain;
            }),
          ),
        );
    });

    it.live("returns None when CLAUDE_PROJECT_DIR brain/ has no index.md", () => {
      const origClaude = process.env["CLAUDE_PROJECT_DIR"];
      const origBrain = process.env["BRAIN_PROJECT_DIR"];
      process.env["CLAUDE_PROJECT_DIR"] = "/projects/myapp";
      delete process.env["BRAIN_PROJECT_DIR"];
      const layer = makeTestLayer({
        exists: () => Effect.succeed(false),
        readFileString: () => notFound(),
        writeFileString: () => Effect.void,
        makeDirectory: () => Effect.void,
      });
      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.projectVaultPath();
        expect(Option.isNone(result)).toBe(true);
      })
        .pipe(Effect.provide(layer))
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (origClaude === undefined) delete process.env["CLAUDE_PROJECT_DIR"];
              else process.env["CLAUDE_PROJECT_DIR"] = origClaude;
              if (origBrain === undefined) delete process.env["BRAIN_PROJECT_DIR"];
              else process.env["BRAIN_PROJECT_DIR"] = origBrain;
            }),
          ),
        );
    });
  });

  describe("currentProjectName", () => {
    it.live("returns BRAIN_PROJECT env when set", () => {
      const original = process.env["BRAIN_PROJECT"];
      process.env["BRAIN_PROJECT"] = "myapp";
      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.currentProjectName();
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe("myapp");
        }
      })
        .pipe(Effect.provide(makeTestLayer()))
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (original === undefined) delete process.env["BRAIN_PROJECT"];
              else process.env["BRAIN_PROJECT"] = original;
            }),
          ),
        );
    });

    it.live("falls back to git root basename", () => {
      const original = process.env["BRAIN_PROJECT"];
      delete process.env["BRAIN_PROJECT"];
      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = yield* config.currentProjectName();
        // We're running inside the okra repo, so git root basename should be "okra"
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe("okra");
        }
      })
        .pipe(Effect.provide(makeTestLayer()))
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (original !== undefined) process.env["BRAIN_PROJECT"] = original;
            }),
          ),
        );
    });
  });
});
