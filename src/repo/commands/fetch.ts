import { Argument, Command, Flag } from "effect/unstable/cli";
import { Clock, Console, Effect, Option, Path, Schema } from "effect";
import { formatBytes, specToString } from "../types.js";
import { CacheService } from "../services/cache.js";
import { MetadataService } from "../services/metadata.js";
import { RegistryService } from "../services/registry.js";
import { GitService } from "../services/git.js";
import { pruneByAge } from "./clean.js";

const AUTO_PRUNE_DAYS = 30;

const JsonUnknown = Schema.fromJsonString(Schema.Unknown);

const specArg = Argument.string("spec").pipe(
  Argument.withDescription(
    "Package spec: owner/repo, npm:package[@version], pypi:package, crates:crate",
  ),
);

const forceFlag = Flag.boolean("force").pipe(
  Flag.withAlias("f"),
  Flag.withDefault(false),
  Flag.withDescription("Force re-clone (removes existing and clones fresh)"),
);

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Output as JSON"),
);

export const fetch = Command.make(
  "fetch",
  { spec: specArg, force: forceFlag, json: jsonFlag },
  ({ spec, force, json }) =>
    Effect.gen(function* () {
      const registry = yield* RegistryService;
      const cache = yield* CacheService;
      const metadata = yield* MetadataService;
      const git = yield* GitService;
      const pathService = yield* Path.Path;

      const parsedSpec = yield* registry.parseSpec(spec);
      const specStr = specToString(parsedSpec);

      const existingOpt = yield* metadata.find(parsedSpec);
      const destPath = yield* cache.getPath(parsedSpec);

      let fresh = false;

      if (Option.isSome(existingOpt)) {
        const existing = existingOpt.value;
        const isGit = yield* git.isGitRepo(existing.path);

        if (force) {
          yield* Console.error(`Force re-fetching ${specStr}...`);
          yield* cache.remove(existing.path);
          yield* metadata.remove(parsedSpec);
          fresh = true;
        } else if (isGit) {
          // Only update versionless specs — pinned versions are immutable
          if (Option.isNone(parsedSpec.version)) {
            yield* Console.error(`Updating ${specStr}...`);
            yield* git
              .update(existing.path)
              .pipe(
                Effect.catch((e) =>
                  Console.error(`Update failed, repo may be up to date: ${e._tag}`),
                ),
              );
          } else {
            yield* Console.error(`Already cached (pinned): ${specStr}`);
          }

          const sizeBytes = yield* cache.getSize(existing.path);
          const currentRef = yield* git
            .getCurrentRef(existing.path)
            .pipe(Effect.orElseSucceed(() => "unknown"));

          const nowMs = yield* Clock.currentTimeMillis;
          const now = new Date(nowMs).toISOString();
          yield* metadata.add({
            spec: parsedSpec,
            fetchedAt: existing.fetchedAt,
            lastAccessedAt: now,
            sizeBytes,
            path: existing.path,
          });

          if (Option.isNone(parsedSpec.version)) {
            yield* Console.error(`Updated: ${existing.path}`);
          }
          yield* Console.error(`Ref: ${currentRef}`);
          yield* Console.error(`Size: ${formatBytes(sizeBytes)}`);

          if (json) {
            const output = { path: existing.path, size: sizeBytes, ref: currentRef, fresh: false };
            const jsonStr = yield* Schema.encodeEffect(JsonUnknown)(output);
            yield* Console.log(jsonStr);
          } else {
            yield* Console.log(existing.path);
          }
          return;
        } else {
          yield* metadata.updateAccessTime(parsedSpec);
          yield* Console.error(`Already cached: ${specStr}`);
          yield* Console.error(`Size: ${formatBytes(existing.sizeBytes)}`);

          if (json) {
            const output = {
              path: existing.path,
              size: existing.sizeBytes,
              ref: null,
              fresh: false,
            };
            const jsonStr = yield* Schema.encodeEffect(JsonUnknown)(output);
            yield* Console.log(jsonStr);
          } else {
            yield* Console.log(existing.path);
          }
          return;
        }
      } else {
        fresh = true;
      }

      // Fresh fetch
      yield* Console.error(`Fetching ${specStr}...`);

      const parentPath = pathService.dirname(destPath);
      yield* cache.ensureDir(parentPath);

      yield* registry.fetch(parsedSpec, destPath);

      const sizeBytes = yield* cache.getSize(destPath);

      const isGit = yield* git.isGitRepo(destPath);
      let currentRef: string | null = null;
      if (isGit) {
        currentRef = yield* git.getCurrentRef(destPath).pipe(Effect.orElseSucceed(() => "unknown"));
        yield* Console.error(`Ref: ${currentRef}`);
      }

      const freshNowMs = yield* Clock.currentTimeMillis;
      const freshNow = new Date(freshNowMs).toISOString();
      yield* metadata.add({
        spec: parsedSpec,
        fetchedAt: freshNow,
        lastAccessedAt: freshNow,
        sizeBytes,
        path: destPath,
      });

      yield* Console.error(`Size: ${formatBytes(sizeBytes)}`);

      if (json) {
        const output = { path: destPath, size: sizeBytes, ref: currentRef, fresh };
        const jsonStr = yield* Schema.encodeEffect(JsonUnknown)(output);
        yield* Console.log(jsonStr);
      } else {
        yield* Console.log(destPath);
      }
    }).pipe(Effect.andThen(autoPrune)),
);

const autoPrune = pruneByAge(AUTO_PRUNE_DAYS).pipe(
  Effect.andThen((pruned) =>
    pruned.length > 0
      ? Console.error(
          `Pruned ${pruned.length} stale repo${pruned.length === 1 ? "" : "s"} (>${AUTO_PRUNE_DAYS}d)`,
        )
      : Effect.void,
  ),
);
