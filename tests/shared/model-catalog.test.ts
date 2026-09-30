import { ConfigProvider, Effect, Layer, Option, Ref, Schema } from "effect";
import { layerNoop } from "effect/FileSystem";
import { PlatformError, SystemError } from "effect/PlatformError";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import * as BunPath from "@effect/platform-bun/BunPath";
import { describe, expect, it } from "effect-bun-test";
import {
  type Catalog,
  GPT_SOL_LINE,
  ModelCatalogService,
  rankModelsInLine,
} from "../../src/shared/model-catalog.js";

const CACHE_PATH = "/home/u/.okra/models.json";
const DAY_MS = 24 * 60 * 60 * 1000;
const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const catalog = (models: Catalog[string]["models"]): Catalog => ({ openai: { models } });

const SOL_CATALOG = catalog({
  "gpt-5.6": { id: "gpt-5.6", family: "gpt-sol", release_date: "2026-07-09" },
  "gpt-5.6-sol": { id: "gpt-5.6-sol", family: "gpt-sol", release_date: "2026-07-09" },
  "gpt-6-sol": { id: "gpt-6-sol", family: "gpt-sol", release_date: "2026-09-22" },
  "gpt-6.1-sol": { id: "gpt-6.1-sol", family: "gpt-sol", release_date: "2026-09-29" },
  "gpt-daybreak-blue-latest": {
    id: "gpt-daybreak-blue-latest",
    family: "gpt-sol",
    release_date: "2026-10-01",
  },
});

describe("rankModelsInLine", () => {
  it.effect("ranks numbered releases newest first and skips other ids in the family", () =>
    Effect.sync(() => {
      expect(rankModelsInLine(SOL_CATALOG, GPT_SOL_LINE)).toEqual([
        "gpt-6.1-sol",
        "gpt-6-sol",
        "gpt-5.6-sol",
      ]);
    }),
  );

  it.effect("skips deprecated models and models without a release date", () =>
    Effect.sync(() => {
      const ranked = rankModelsInLine(
        catalog({
          "gpt-6-sol": { family: "gpt-sol", release_date: "2026-09-22" },
          "gpt-6.1-sol": { family: "gpt-sol", release_date: "2026-09-29", status: "deprecated" },
          "gpt-7-sol": { family: "gpt-sol" },
        }),
        GPT_SOL_LINE,
      );
      expect(ranked).toEqual(["gpt-6-sol"]);
    }),
  );

  it.effect("limits the ranking to the available ids", () =>
    Effect.sync(() => {
      const available = new Set(["gpt-5.6-sol", "gpt-6-sol"]);
      expect(rankModelsInLine(SOL_CATALOG, GPT_SOL_LINE, available)).toEqual([
        "gpt-6-sol",
        "gpt-5.6-sol",
      ]);
    }),
  );

  it.effect("returns no models when the provider has none in the line", () =>
    Effect.sync(() => {
      expect(rankModelsInLine({}, GPT_SOL_LINE)).toEqual([]);
    }),
  );
});

const notFound = () =>
  Effect.fail(
    new PlatformError(
      new SystemError({ _tag: "NotFound", module: "FileSystem", method: "readFileString" }),
    ),
  );

/** In-memory FS plus an HTTP client that serves `remote`, or fails when it is `None`. */
const makeLayer = (initialFiles: Record<string, string>, remote: Option.Option<Catalog>) =>
  Effect.gen(function* () {
    const files = yield* Ref.make(initialFiles);
    const fetchCount = yield* Ref.make(0);
    const fs = layerNoop({
      readFileString: (path: string) =>
        Effect.flatMap(Ref.get(files), (current) => {
          const content = current[path];
          if (content === undefined) return notFound();
          return Effect.succeed(content);
        }),
      writeFileString: (path: string, content: string) =>
        Ref.update(files, (current) => ({ ...current, [path]: content })),
      makeDirectory: () => Effect.void,
    });
    const client = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Ref.update(fetchCount, (count) => count + 1).pipe(
          Effect.flatMap(() =>
            Option.match(remote, {
              onNone: () =>
                Effect.fail(
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.TransportError({ request }),
                  }),
                ),
              onSome: (body) =>
                Effect.succeed(HttpClientResponse.fromWeb(request, new Response(toJson(body)))),
            }),
          ),
        ),
      ),
    );
    const layer = Layer.mergeAll(
      ModelCatalogService.layer.pipe(Layer.provide(Layer.mergeAll(fs, BunPath.layer, client))),
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: "/home/u" } })),
    );
    return { layer, files, fetchCount };
  });

const cacheFile = (fetchedAt: number, cached: Catalog): string =>
  toJson({ format: 1, fetchedAt, catalog: cached });

const solModels = Effect.flatMap(ModelCatalogService, (service) =>
  service.modelsInLine(GPT_SOL_LINE),
);

describe("ModelCatalogService", () => {
  it.effect("fetches the registry and caches it on disk", () =>
    Effect.gen(function* () {
      const { layer, files, fetchCount } = yield* makeLayer({}, Option.some(SOL_CATALOG));
      const models = yield* solModels.pipe(Effect.provide(layer));
      expect(models[0]).toBe("gpt-6.1-sol");
      expect(yield* Ref.get(fetchCount)).toBe(1);
      expect((yield* Ref.get(files))[CACHE_PATH]).toContain("gpt-6.1-sol");
    }),
  );

  it.effect("uses a fresh cache without fetching", () =>
    Effect.gen(function* () {
      const cached = catalog({ "gpt-6-sol": { family: "gpt-sol", release_date: "2026-09-22" } });
      const { layer, fetchCount } = yield* makeLayer(
        { [CACHE_PATH]: cacheFile(0, cached) },
        Option.some(SOL_CATALOG),
      );
      const models = yield* solModels.pipe(Effect.provide(layer));
      expect(models[0]).toBe("gpt-6-sol");
      expect(yield* Ref.get(fetchCount)).toBe(0);
    }),
  );

  it.effect("refetches a cache older than a day", () =>
    Effect.gen(function* () {
      const cached = catalog({ "gpt-6-sol": { family: "gpt-sol", release_date: "2026-09-22" } });
      const { layer, fetchCount } = yield* makeLayer(
        { [CACHE_PATH]: cacheFile(0, cached) },
        Option.some(SOL_CATALOG),
      );
      yield* TestClock.adjust(DAY_MS + 1);
      const models = yield* solModels.pipe(Effect.provide(layer));
      expect(models[0]).toBe("gpt-6.1-sol");
      expect(yield* Ref.get(fetchCount)).toBe(1);
    }),
  );

  it.effect("falls back to a stale cache when the fetch fails", () =>
    Effect.gen(function* () {
      const cached = catalog({ "gpt-6-sol": { family: "gpt-sol", release_date: "2026-09-22" } });
      const { layer } = yield* makeLayer({ [CACHE_PATH]: cacheFile(0, cached) }, Option.none());
      yield* TestClock.adjust(DAY_MS + 1);
      const models = yield* solModels.pipe(Effect.provide(layer));
      expect(models[0]).toBe("gpt-6-sol");
    }),
  );

  it.effect("returns None with no cache and no network", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer({}, Option.none());
      const models = yield* solModels.pipe(Effect.provide(layer));
      expect(models).toEqual([]);
    }),
  );

  it.effect("fetches at most once per process", () =>
    Effect.gen(function* () {
      const { layer, fetchCount } = yield* makeLayer({}, Option.some(SOL_CATALOG));
      yield* Effect.gen(function* () {
        yield* solModels;
        yield* solModels;
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(fetchCount)).toBe(1);
    }),
  );
});
