import { ConfigProvider, Effect, Layer, Option } from "effect";
import { layerNoop } from "effect/FileSystem";
import { PlatformError, SystemError } from "effect/PlatformError";
import * as BunPath from "@effect/platform-bun/BunPath";
import { describe, expect, it } from "effect-bun-test";
import {
  CODEX_FALLBACK_MODEL,
  CodexModelsService,
  isCodexModelRejection,
  resolveCodexSolCandidates,
} from "../../src/shared/codex-models.js";
import { type Catalog, ModelCatalogService } from "../../src/shared/model-catalog.js";

const CACHE_PATH = "/home/u/.codex/models_cache.json";

const SOL_CATALOG: Catalog = {
  openai: {
    models: {
      "gpt-5.6-sol": { family: "gpt-sol", release_date: "2026-07-09" },
      "gpt-6-sol": { family: "gpt-sol", release_date: "2026-09-22" },
      "gpt-6.1-sol": { family: "gpt-sol", release_date: "2026-09-29" },
    },
  },
};

const notFound = () =>
  Effect.fail(
    new PlatformError(
      new SystemError({ _tag: "NotFound", module: "FileSystem", method: "readFileString" }),
    ),
  );

const listedFrom = (files: Record<string, string>) =>
  Effect.flatMap(CodexModelsService, (service) => service.listed).pipe(
    Effect.provide(
      Layer.mergeAll(
        CodexModelsService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              layerNoop({
                readFileString: (path: string) => {
                  const content = files[path];
                  if (content === undefined) return notFound();
                  return Effect.succeed(content);
                },
              }),
              BunPath.layer,
            ),
          ),
        ),
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: "/home/u" } })),
      ),
    ),
  );

describe("CodexModelsService", () => {
  it.effect("lists only the selectable models from the codex cache", () =>
    Effect.gen(function* () {
      const listed = yield* listedFrom({
        [CACHE_PATH]:
          '{"fetched_at":"x","models":[{"slug":"gpt-6-sol","visibility":"list","priority":3},{"slug":"codex-auto-review","visibility":"hide"}]}',
      });
      expect(Option.map(listed, (slugs) => [...slugs])).toEqual(Option.some(["gpt-6-sol"]));
    }),
  );

  it.effect("returns None when the codex CLI has not written its cache", () =>
    Effect.gen(function* () {
      expect(yield* listedFrom({})).toEqual(Option.none());
    }),
  );
});

describe("resolveCodexSolCandidates", () => {
  const resolve = (listed: Option.Option<ReadonlyArray<string>>, catalog: Catalog) =>
    resolveCodexSolCandidates.pipe(
      Effect.provide(
        Layer.mergeAll(
          CodexModelsService.layerTest(listed),
          ModelCatalogService.layerTest(catalog),
        ),
      ),
    );

  it.effect("skips a newer release the codex account does not list", () =>
    Effect.gen(function* () {
      const models = yield* resolve(Option.some(["gpt-5.6-sol", "gpt-6-sol"]), SOL_CATALOG);
      expect(models).toEqual(["gpt-6-sol"]);
    }),
  );

  it.effect("tries a listed new release first, then the verified fallback", () =>
    Effect.gen(function* () {
      const models = yield* resolve(
        Option.some(["gpt-5.6-sol", "gpt-6-sol", "gpt-6.1-sol"]),
        SOL_CATALOG,
      );
      expect(models).toEqual(["gpt-6.1-sol", CODEX_FALLBACK_MODEL]);
    }),
  );

  it.effect("falls back without the codex model list", () =>
    Effect.gen(function* () {
      expect(yield* resolve(Option.none(), SOL_CATALOG)).toEqual([CODEX_FALLBACK_MODEL]);
    }),
  );

  it.effect("falls back without models.dev data", () =>
    Effect.gen(function* () {
      expect(yield* resolve(Option.some(["gpt-6-sol"]), {})).toEqual([CODEX_FALLBACK_MODEL]);
    }),
  );
});

describe("isCodexModelRejection", () => {
  it.effect("matches the ChatGPT-account model refusal", () =>
    Effect.sync(() => {
      expect(
        isCodexModelRejection(
          "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
        ),
      ).toBe(true);
      expect(isCodexModelRejection("HTTP 429 rate limited")).toBe(false);
    }),
  );
});
