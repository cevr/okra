import { Array as Arr, Config, Context, Effect, Layer, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { GPT_SOL_LINE, ModelCatalogService } from "./model-catalog.js";

export const CODEX_MODELS_RELATIVE_PATH = ".codex/models_cache.json";

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

export class CodexModelsService extends Context.Service<
  CodexModelsService,
  {
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

export const resolveCodexSolCandidates: Effect.Effect<
  readonly [string, ...Array<string>],
  never,
  CodexModelsService | ModelCatalogService
> = Effect.gen(function* () {
  const listed = yield* Effect.flatMap(CodexModelsService, (service) => service.listed);
  if (Option.isNone(listed)) return [CODEX_FALLBACK_MODEL];
  const catalog = yield* ModelCatalogService;
  const ranked = yield* catalog.modelsInLine(GPT_SOL_LINE, listed.value);
  const newer = Arr.takeWhile(ranked, (id) => id !== CODEX_FALLBACK_MODEL);
  return Arr.append(newer, CODEX_FALLBACK_MODEL);
});

export const isCodexModelRejection = (text: string): boolean =>
  text.includes("model is not supported when using Codex");
