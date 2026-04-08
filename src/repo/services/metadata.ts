import {
  Clock,
  Config,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Schema,
  ServiceMap,
} from "effect";
import type { PackageSpec, RepoMetadata } from "../types.js";
import { MetadataIndex, specMatches } from "../types.js";

// In-memory cache state
interface CacheState {
  index: Option.Option<MetadataIndex>;
  dirty: boolean;
}

const MetadataIndexJson = Schema.fromJsonString(MetadataIndex);

// Service interface
export class MetadataService extends ServiceMap.Service<
  MetadataService,
  {
    readonly load: () => Effect.Effect<MetadataIndex>;
    readonly save: (index: MetadataIndex) => Effect.Effect<void>;
    readonly add: (metadata: RepoMetadata) => Effect.Effect<void>;
    readonly remove: (spec: PackageSpec) => Effect.Effect<boolean>;
    readonly find: (spec: PackageSpec) => Effect.Effect<Option.Option<RepoMetadata>>;
    readonly updateAccessTime: (spec: PackageSpec) => Effect.Effect<void>;
    readonly all: () => Effect.Effect<readonly RepoMetadata[]>;
  }
>()("@cvr/okra/repo/services/metadata/MetadataService") {
  // Live layer using real filesystem with in-memory caching
  static readonly layer = Layer.effect(
    MetadataService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const home = yield* Config.string("HOME").pipe(Config.withDefault("~"));
      const cacheDir = pathService.join(home, ".cache", "repo");
      const metadataPath = pathService.join(cacheDir, "metadata.json");

      const cacheRef = yield* Ref.make<CacheState>({ index: Option.none(), dirty: false });

      const loadFromDisk = (): Effect.Effect<MetadataIndex> =>
        Effect.gen(function* () {
          const exists = yield* fs.exists(metadataPath);
          if (!exists) {
            return { version: 1, repos: [] };
          }
          const content = yield* fs.readFileString(metadataPath);
          return yield* Schema.decodeUnknownEffect(MetadataIndexJson)(content);
        }).pipe(Effect.catch(() => Effect.succeed({ version: 1, repos: [] })));

      const load = (): Effect.Effect<MetadataIndex> =>
        Effect.gen(function* () {
          const cache = yield* Ref.get(cacheRef);
          if (Option.isSome(cache.index)) {
            return cache.index.value;
          }
          const index = yield* loadFromDisk();
          yield* Ref.set(cacheRef, { index: Option.some(index), dirty: false });
          return index;
        });

      const saveToDisk = (index: MetadataIndex): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* fs
            .makeDirectory(cacheDir, { recursive: true })
            .pipe(Effect.catchTag("PlatformError", () => Effect.void));
          const jsonStr = yield* Schema.encodeEffect(MetadataIndexJson)(index);
          const now = yield* Clock.currentTimeMillis;
          const tempPath = `${metadataPath}.tmp.${now}`;
          yield* fs.writeFileString(tempPath, jsonStr);
          yield* fs.rename(tempPath, metadataPath);
        }).pipe(Effect.catch((e) => Effect.logWarning(`Failed to save metadata: ${e}`)));

      const save = (index: MetadataIndex): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* saveToDisk(index);
          yield* Ref.set(cacheRef, { index: Option.some(index), dirty: false });
        });

      const updateCache = (index: MetadataIndex): Effect.Effect<void> =>
        Ref.set(cacheRef, { index: Option.some(index), dirty: true });

      const add = (metadata: RepoMetadata): Effect.Effect<void> =>
        Effect.gen(function* () {
          const index = yield* load();
          const filtered = index.repos.filter((r) => !specMatches(r.spec, metadata.spec));
          const newIndex: MetadataIndex = {
            ...index,
            repos: [...filtered, metadata],
          };
          yield* save(newIndex);
        });

      const remove = (spec: PackageSpec): Effect.Effect<boolean> =>
        Effect.gen(function* () {
          const index = yield* load();
          const originalLength = index.repos.length;
          const filtered = index.repos.filter((r) => !specMatches(r.spec, spec));
          if (filtered.length === originalLength) {
            return false;
          }
          yield* save({ ...index, repos: filtered });
          return true;
        });

      const find = (spec: PackageSpec): Effect.Effect<Option.Option<RepoMetadata>> =>
        load().pipe(
          Effect.map((index) =>
            Option.fromNullishOr(index.repos.find((r) => specMatches(r.spec, spec))),
          ),
        );

      const updateAccessTime = (spec: PackageSpec): Effect.Effect<void> =>
        Effect.gen(function* () {
          const index = yield* load();
          const now = yield* Clock.currentTimeMillis;
          const nowStr = new Date(Number(now)).toISOString();
          const updated = index.repos.map((r) => {
            if (specMatches(r.spec, spec)) {
              return { ...r, lastAccessedAt: nowStr };
            }
            return r;
          });
          yield* updateCache({ ...index, repos: updated });
        });

      const all = (): Effect.Effect<readonly RepoMetadata[]> =>
        load().pipe(Effect.map((index) => index.repos));

      return { load, save, add, remove, find, updateAccessTime, all };
    }),
  );
}
