import { Clock, Config, Context, Duration, Effect, Layer, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

/** Public model registry: provider id → models keyed by model id. */
export const MODELS_DEV_URL = "https://models.dev/api.json";

/** Path (relative to home) of the on-disk copy of the registry. */
export const MODEL_CATALOG_RELATIVE_PATH = ".okra/models.json";

// Bump when the cached shape changes so an old file is refetched instead of misread.
const CACHE_FORMAT = 1;
const CACHE_MAX_AGE = Duration.days(1);
const FETCH_TIMEOUT = Duration.seconds(5);

// Every field is optional: one malformed upstream entry must not reject the whole registry.
const CatalogModel = Schema.Struct({
  id: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  release_date: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});

const CatalogProvider = Schema.Struct({
  models: Schema.Record(Schema.String, CatalogModel),
});

const Catalog = Schema.Record(Schema.String, CatalogProvider);
export type Catalog = typeof Catalog.Type;

const CatalogCache = Schema.Struct({
  format: Schema.Finite,
  fetchedAt: Schema.Finite,
  catalog: Catalog,
});
type CatalogCache = typeof CatalogCache.Type;

const decodeCache = Schema.decodeUnknownEffect(Schema.fromJsonString(CatalogCache));
const encodeCache = Schema.encodeEffect(Schema.fromJsonString(CatalogCache));
const decodeCatalogResponse = HttpClientResponse.schemaBodyJson(Catalog);

/**
 * A model line such as "GPT Sol": the models.dev `family` tag plus an id pattern. The family tag
 * alone is too loose (`gpt-sol` also holds `gpt-5.6` and preview aliases), so the pattern keeps
 * only the numbered releases of the line.
 */
export interface ModelLine {
  readonly provider: string;
  readonly family: string;
  readonly idPattern: RegExp;
}

/** Numbered GPT Sol releases, e.g. `gpt-6.1-sol`. */
export const GPT_SOL_LINE: ModelLine = {
  provider: "openai",
  family: "gpt-sol",
  idPattern: /^gpt-\d+(\.\d+)?-sol$/,
};

/**
 * The non-deprecated model ids in `line`, newest release first, limited to `availableIds` when
 * given. Models without a release date cannot be ordered and are skipped. Equal dates fall back
 * to the id so the order is stable.
 */
export const rankModelsInLine = (
  catalog: Catalog,
  line: ModelLine,
  availableIds?: ReadonlySet<string>,
): ReadonlyArray<string> => {
  const models = catalog[line.provider]?.models ?? {};
  const ranked: Array<{ readonly id: string; readonly releaseDate: string }> = [];
  for (const [key, model] of Object.entries(models)) {
    const id = model.id ?? key;
    if (model.family !== line.family) continue;
    if (!line.idPattern.test(id)) continue;
    if (availableIds !== undefined && !availableIds.has(id)) continue;
    if (model.status === "deprecated") continue;
    if (model.release_date === undefined) continue;
    ranked.push({ id, releaseDate: model.release_date });
  }
  return ranked
    .sort(
      (left, right) =>
        right.releaseDate.localeCompare(left.releaseDate) || right.id.localeCompare(left.id),
    )
    .map((model) => model.id);
};

/**
 * Ranks the models of a line from models.dev, so a new release is picked up without an okra
 * release. The registry is cached in `~/.okra/models.json` for a day. When the fetch fails, a
 * stale cache is used; with no cache at all, lookups return no models and callers use their own
 * fallback. Resolution never fails.
 */
export class ModelCatalogService extends Context.Service<
  ModelCatalogService,
  {
    /** See `rankModelsInLine`. Pass `availableIds` when the caller's account cannot use every release. */
    readonly modelsInLine: (
      line: ModelLine,
      availableIds?: ReadonlySet<string>,
    ) => Effect.Effect<ReadonlyArray<string>>;
  }
>()("@cvr/okra/shared/model-catalog/ModelCatalogService") {
  static layer: Layer.Layer<ModelCatalogService, never, FileSystem | Path | HttpClient.HttpClient> =
    Layer.effect(
      ModelCatalogService,
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

        const cachePath = Config.String("HOME").pipe(
          Effect.map((home) => Option.some(path.join(home, MODEL_CATALOG_RELATIVE_PATH))),
          Effect.orElseSucceed(() => Option.none<string>()),
        );

        const readCache = (file: string): Effect.Effect<Option.Option<CatalogCache>> =>
          fs.readFileString(file).pipe(
            Effect.flatMap(decodeCache),
            Effect.asSome,
            Effect.orElseSucceed(() => Option.none<CatalogCache>()),
            Effect.map(Option.filter((cache) => cache.format === CACHE_FORMAT)),
          );

        const writeCache = (file: string, cache: CatalogCache): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* fs.makeDirectory(path.dirname(file), { recursive: true });
            const text = yield* encodeCache(cache);
            yield* fs.writeFileString(file, `${text}\n`);
          }).pipe(Effect.ignore);

        const fetchCatalog = client
          .execute(
            HttpClientRequest.get(MODELS_DEV_URL).pipe(
              HttpClientRequest.setHeader("User-Agent", "@cvr/okra"),
            ),
          )
          .pipe(
            Effect.flatMap(decodeCatalogResponse),
            Effect.timeout(FETCH_TIMEOUT),
            Effect.option,
          );

        const loadCatalog: Effect.Effect<Catalog> = Effect.gen(function* () {
          const file = yield* cachePath;
          const cached = yield* Option.match(file, {
            onNone: () => Effect.succeed(Option.none<CatalogCache>()),
            onSome: readCache,
          });
          const now = yield* Clock.currentTimeMillis;
          if (
            Option.isSome(cached) &&
            now - cached.value.fetchedAt < Duration.toMillis(CACHE_MAX_AGE)
          ) {
            return cached.value.catalog;
          }

          const fetched = yield* fetchCatalog;
          if (Option.isSome(fetched)) {
            if (Option.isSome(file)) {
              yield* writeCache(file.value, {
                format: CACHE_FORMAT,
                fetchedAt: now,
                catalog: fetched.value,
              });
            }
            return fetched.value;
          }

          return Option.match(cached, {
            onNone: (): Catalog => ({}),
            onSome: (cache) => cache.catalog,
          });
        });

        const catalog = yield* Effect.cached(loadCatalog);

        const modelsInLine = (line: ModelLine, availableIds?: ReadonlySet<string>) =>
          catalog.pipe(Effect.map((loaded) => rankModelsInLine(loaded, line, availableIds)));

        return { modelsInLine };
      }),
    );

  static layerTest = (catalog: Catalog = {}): Layer.Layer<ModelCatalogService> =>
    Layer.succeed(ModelCatalogService, {
      modelsInLine: (line, availableIds) =>
        Effect.succeed(rankModelsInLine(catalog, line, availableIds)),
    });
}
