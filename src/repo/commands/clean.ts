import { Command, Flag } from "effect/unstable/cli";
import { Clock, Console, Effect, Option } from "effect";
import { formatBytes, specToString } from "../types.js";
import type { PackageSpec } from "../types.js";
import { CacheService } from "../services/cache.js";
import { MetadataService } from "../services/metadata.js";

/**
 * Prune repos not accessed in `days` days.
 * Returns specs of removed repos (empty if nothing pruned).
 * Shared by `clean --days` and `fetch` auto-prune.
 */
export const pruneByAge = Effect.fn("pruneByAge")(function* (days: number) {
  const cache = yield* CacheService;
  const metadata = yield* MetadataService;

  const repos = yield* metadata.all();
  if (repos.length === 0) return [] as readonly PackageSpec[];

  const nowMs = yield* Clock.currentTimeMillis;
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  const stale = repos.filter((r) => new Date(r.lastAccessedAt).getTime() < cutoff);

  for (const repo of stale) {
    yield* cache.remove(repo.path);
    yield* metadata.remove(repo.spec);
  }

  return stale.map((r) => r.spec);
});

const allFlag = Flag.boolean("all").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Remove all cached repositories"),
);

const confirmFlag = Flag.boolean("yes").pipe(
  Flag.withAlias("y"),
  Flag.withDefault(false),
  Flag.withDescription("Skip confirmation prompt"),
);

const daysFlag = Flag.integer("days").pipe(
  Flag.withAlias("d"),
  Flag.optional,
  Flag.withDescription("Remove repos not accessed in N days"),
);

const maxSizeFlag = Flag.string("max-size").pipe(
  Flag.optional,
  Flag.withDescription("Remove repos larger than size (e.g., 100M, 1G)"),
);

const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Show what would be removed without actually removing"),
);

function parseSize(sizeStr: string): number | null {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|K|KB|M|MB|G|GB)?$/i);
  if (match === null) return null;

  const value = parseFloat(match[1] as string);
  const unit = (match[2] ?? "B").toUpperCase();

  switch (unit) {
    case "B":
      return value;
    case "K":
    case "KB":
      return value * 1024;
    case "M":
    case "MB":
      return value * 1024 * 1024;
    case "G":
    case "GB":
      return value * 1024 * 1024 * 1024;
    default:
      return null;
  }
}

export const clean = Command.make(
  "clean",
  { all: allFlag, yes: confirmFlag, days: daysFlag, maxSize: maxSizeFlag, dryRun: dryRunFlag },
  ({ all, yes, days, maxSize, dryRun }) =>
    Effect.gen(function* () {
      const cache = yield* CacheService;
      const metadata = yield* MetadataService;

      const hasFilter = Option.isSome(days) || Option.isSome(maxSize);

      if (!all && !hasFilter) {
        yield* Console.error("Specify --days, --max-size, or --all");
        return yield* Effect.die("missing-flags");
      }

      const repos = yield* metadata.all();
      if (repos.length === 0) {
        yield* Console.error("Cache is already empty.");
        return;
      }

      if (all) {
        const totalSize = repos.reduce((sum, r) => sum + r.sizeBytes, 0);

        if (!yes) {
          yield* Console.error(
            `This will remove ${repos.length} cached repositories (${formatBytes(totalSize)}).`,
          );
          yield* Console.error("Use --yes to confirm.");
          return;
        }

        yield* cache.removeAll();
        yield* metadata.save({ version: 1, repos: [] });

        yield* Console.error(`Removed ${repos.length} repositories.`);
        yield* Console.log(`Freed: ${formatBytes(totalSize)}`);
        return;
      }

      // Filtered clean (prune logic)
      let toRemove = [...repos];

      if (Option.isSome(days)) {
        const nowMs = yield* Clock.currentTimeMillis;
        const cutoff = nowMs - days.value * 24 * 60 * 60 * 1000;
        toRemove = toRemove.filter((r) => new Date(r.lastAccessedAt).getTime() < cutoff);
      }

      if (Option.isSome(maxSize)) {
        const maxBytes = parseSize(maxSize.value);
        if (maxBytes === null) {
          yield* Console.error(`Invalid size format: ${maxSize.value}`);
          yield* Console.error("Use formats like: 100M, 1G, 500KB");
          return;
        }
        toRemove = toRemove.filter((r) => r.sizeBytes > maxBytes);
      }

      if (toRemove.length === 0) {
        yield* Console.error("No repositories match the criteria.");
        return;
      }

      const totalSize = toRemove.reduce((sum, r) => sum + r.sizeBytes, 0);

      if (dryRun) {
        yield* Console.error(`Would remove ${toRemove.length} repositories:`);
        yield* Console.error("");
        for (const repo of toRemove) {
          yield* Console.error(
            `  ${specToString(repo.spec).padEnd(40)}  ${formatBytes(repo.sizeBytes)}`,
          );
        }
        yield* Console.error("");
        yield* Console.log(`Total: ${formatBytes(totalSize)}`);
        return;
      }

      for (const repo of toRemove) {
        yield* cache.remove(repo.path);
        yield* metadata.remove(repo.spec);
        yield* Console.error(`Removed: ${specToString(repo.spec)}`);
      }

      yield* Console.error("");
      yield* Console.error(`Removed ${toRemove.length} repositories.`);
      yield* Console.log(`Freed: ${formatBytes(totalSize)}`);
    }),
);
