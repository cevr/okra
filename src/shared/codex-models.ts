import { Array as Arr, Config, Context, Effect, Layer, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { GPT_SOL_LINE, ModelCatalogService } from "./model-catalog.js";

/**
 * Path (relative to home) of the model list the codex CLI fetches for the signed-in account. It
 * is the only record of entitlement: models.dev lists releases that a ChatGPT-account login
 * rejects ("not supported when using Codex with a ChatGPT account"), e.g. `gpt-6.1-sol` at launch.
 */
export const CODEX_MODELS_RELATIVE_PATH = ".codex/models_cache.json";

/**
 * Used when the codex model list or models.dev is unavailable. Verified with a ChatGPT-account
 * login for counsel (`codex exec`) and for the image_generation tool.
 */
export const CODEX_FALLBACK_MODEL = "gpt-6-sol";

const CodexModelsCache = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      visibility: Schema.optional(Schema.String),
    }),
  ),
});
const decodeCodexModelsCache = Schema.decodeUnknownEffect(Schema.fromJsonString(CodexModelsCache));

/** The models the signed-in codex account can select, read from the codex CLI's own cache. */
export class CodexModelsService extends Context.Service<
  CodexModelsService,
  {
    /** Selectable model slugs, or `None` when the codex CLI has not written its cache yet. */
    readonly listed: Effect.Effect<Option.Option<ReadonlySet<string>>>;
  }
>()("@cvr/okra/shared/codex-models/CodexModelsService") {
  static layer: Layer.Layer<CodexModelsService, never, FileSystem | Path> = Layer.effect(
    CodexModelsService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      const listed = Config.String("HOME").pipe(
        Effect.flatMap((home) => fs.readFileString(path.join(home, CODEX_MODELS_RELATIVE_PATH))),
        Effect.flatMap(decodeCodexModelsCache),
        Effect.map(
          (cache): ReadonlySet<string> =>
            new Set(
              cache.models
                // Hidden entries are internal (e.g. auto-review) and not selectable.
                .filter((model) => model.visibility === "list")
                .map((model) => model.slug),
            ),
        ),
        Effect.asSome,
        Effect.orElseSucceed(() => Option.none<ReadonlySet<string>>()),
      );

      return { listed };
    }),
  );

  static layerTest = (
    slugs: Option.Option<ReadonlyArray<string>>,
  ): Layer.Layer<CodexModelsService> =>
    Layer.succeed(CodexModelsService, {
      listed: Effect.succeed(Option.map(slugs, (values): ReadonlySet<string> => new Set(values))),
    });
}

/**
 * The GPT Sol releases to try, newest first: models.dev orders the line and the codex model list
 * filters it. The codex list can name a model the backend still rejects during a rollout, so
 * callers try each candidate and move on only on `isCodexModelRejection`. The list always ends
 * with `CODEX_FALLBACK_MODEL`.
 */
export const resolveCodexSolCandidates: Effect.Effect<
  readonly [string, ...Array<string>],
  never,
  CodexModelsService | ModelCatalogService
> = Effect.gen(function* () {
  const listed = yield* Effect.flatMap(CodexModelsService, (service) => service.listed);
  if (Option.isNone(listed)) return [CODEX_FALLBACK_MODEL];
  const catalog = yield* ModelCatalogService;
  const ranked = yield* catalog.modelsInLine(GPT_SOL_LINE, listed.value);
  // Anything ranked below the verified fallback is older, so it is never worth a try.
  const newer = Arr.takeWhile(ranked, (id) => id !== CODEX_FALLBACK_MODEL);
  return Arr.append(newer, CODEX_FALLBACK_MODEL);
});

/** True when the codex backend refused a model that the signed-in account may not use. */
export const isCodexModelRejection = (text: string): boolean =>
  text.includes("model is not supported when using Codex");
