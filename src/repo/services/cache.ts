import { Config, Effect, FileSystem, Layer, Option, Path, ServiceMap } from "effect";
import type { PackageSpec } from "../types.js";

// Service interface
export class CacheService extends ServiceMap.Service<
  CacheService,
  {
    readonly cacheDir: string;
    readonly getPath: (spec: PackageSpec) => Effect.Effect<string>;
    readonly remove: (path: string) => Effect.Effect<void>;
    readonly removeAll: () => Effect.Effect<void>;
    readonly getSize: (path: string) => Effect.Effect<number>;
    readonly ensureDir: (path: string) => Effect.Effect<void>;
  }
>()("@cvr/okra/repo/services/cache/CacheService") {
  // Live layer using real filesystem
  static readonly layer = Layer.effect(
    CacheService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const home = yield* Config.string("HOME").pipe(Config.withDefault("~"));
      const cacheDir = pathService.join(home, ".cache", "repo");

      yield* fs
        .makeDirectory(cacheDir, { recursive: true })
        .pipe(
          Effect.catchTag("PlatformError", (e) =>
            e.reason._tag === "AlreadyExists" ? Effect.void : Effect.fail(e),
          ),
        );

      const getPath = (spec: PackageSpec) =>
        Effect.gen(function* () {
          const version = Option.getOrElse(spec.version, () => "default");
          switch (spec.registry) {
            case "github": {
              const normalizedPath = pathService.join(cacheDir, spec.name);

              if (yield* fs.exists(normalizedPath)) return normalizedPath;

              // spec.name guaranteed to be "owner/repo" format for github registry
              const [owner, repo] = spec.name.split("/") as [string, string];

              const cacheExists = yield* fs.exists(cacheDir);
              if (!cacheExists) return normalizedPath;

              const entries = yield* fs.readDirectory(cacheDir);
              for (const entry of entries) {
                if (entry.toLowerCase() === owner) {
                  const ownerPath = pathService.join(cacheDir, entry);
                  const ownerStat = yield* fs.stat(ownerPath);
                  if (ownerStat.type !== "Directory") continue;

                  const repoEntries = yield* fs.readDirectory(ownerPath);
                  for (const repoEntry of repoEntries) {
                    if (repoEntry.toLowerCase() === repo) {
                      return pathService.join(ownerPath, repoEntry);
                    }
                  }
                }
              }

              return normalizedPath;
            }
            case "npm":
            case "pypi":
            case "crates":
              return pathService.join(cacheDir, spec.name, version);
          }
        }).pipe(Effect.orDie);

      const remove = (path: string) =>
        Effect.gen(function* () {
          const pathExists = yield* fs.exists(path);
          if (pathExists) {
            yield* fs.remove(path, { recursive: true });
          }
        }).pipe(
          Effect.catchTag("PlatformError", (e) =>
            Effect.logWarning(`Failed to remove ${path}: ${e}`),
          ),
        );

      const removeAll = () =>
        Effect.gen(function* () {
          const pathExists = yield* fs.exists(cacheDir);
          if (pathExists) {
            yield* fs.remove(cacheDir, { recursive: true });
            yield* fs.makeDirectory(cacheDir, { recursive: true });
          }
        }).pipe(
          Effect.catchTag("PlatformError", (e) => Effect.logWarning(`Failed to clean cache: ${e}`)),
        );

      const getSize = (path: string): Effect.Effect<number> =>
        Effect.gen(function* () {
          const pathExists = yield* fs.exists(path);
          if (!pathExists) return 0;

          const calculateSize = (dir: string): Effect.Effect<number> =>
            Effect.gen(function* () {
              const stat = yield* fs.stat(dir);

              if (stat.type === "Directory") {
                const entries = yield* fs.readDirectory(dir);
                const sizes = yield* Effect.forEach(entries, (entry) =>
                  calculateSize(pathService.join(dir, entry)),
                );
                return sizes.reduce((a, b) => a + b, 0);
              }
              return Number(stat.size);
            }).pipe(Effect.catch(() => Effect.succeed(0)));

          return yield* calculateSize(path);
        }).pipe(Effect.catch(() => Effect.succeed(0)));

      const ensureDir = (path: string) =>
        fs
          .makeDirectory(path, { recursive: true })
          .pipe(Effect.catchTag("PlatformError", () => Effect.void));

      return { cacheDir, getPath, remove, removeAll, getSize, ensureDir };
    }),
  );
}
