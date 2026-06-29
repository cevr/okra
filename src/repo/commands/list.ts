import { Command, Flag } from "effect/unstable/cli";
import { Clock, Console, Effect, Option, Schema } from "effect";
import { formatBytes, formatRelativeTime, specToString } from "../types.js";
import { MetadataService } from "../services/metadata.js";

const JsonUnknown = Schema.fromJsonString(Schema.Unknown);

const registryFlag = Flag.choice("registry", ["github", "npm", "pypi", "crates"] as const).pipe(
  Flag.withAlias("r"),
  Flag.optional,
  Flag.withDescription("Filter by registry"),
);

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Output as JSON"),
);

const sortFlag = Flag.choice("sort", ["date", "size", "name"] as const).pipe(
  Flag.withAlias("s"),
  Flag.withDefault("date" as const),
  Flag.withDescription("Sort by: date, size, name"),
);

export const list = Command.make(
  "list",
  { registry: registryFlag, json: jsonFlag, sort: sortFlag },
  ({ registry, json, sort }) =>
    Effect.gen(function* () {
      const metadata = yield* MetadataService;
      let repos = yield* metadata.all;

      // Filter by registry if specified
      if (Option.isSome(registry)) {
        repos = repos.filter((r) => r.spec.registry === registry.value);
      }

      // Sort
      const sorted = [...repos].sort((a, b) => {
        switch (sort) {
          case "date":
            return Date.parse(b.lastAccessedAt) - Date.parse(a.lastAccessedAt);
          case "size":
            return b.sizeBytes - a.sizeBytes;
          case "name":
            return a.spec.name.localeCompare(b.spec.name);
        }
      });

      if (json) {
        const output = {
          repos: sorted.map((r) => ({
            ...r,
            spec: {
              registry: r.spec.registry,
              name: r.spec.name,
              version: Option.getOrNull(r.spec.version),
            },
          })),
          total: sorted.length,
          totalSize: sorted.reduce((sum, r) => sum + r.sizeBytes, 0),
        };
        const jsonStr = yield* Schema.encodeEffect(JsonUnknown)(output);
        yield* Console.log(jsonStr);
        return;
      }

      if (sorted.length === 0) {
        yield* Console.error("No repositories cached.");
        yield* Console.error('Use "okra repo fetch <spec>" to cache a repository.');
        return;
      }

      yield* Console.log("");
      yield* Console.log(`Cached Repositories (${sorted.length})`);
      yield* Console.log("═".repeat(80));

      const nowMs = yield* Clock.currentTimeMillis;
      for (const repo of sorted) {
        const spec = specToString(repo.spec);
        const size = formatBytes(repo.sizeBytes);
        const date = formatRelativeTime(repo.lastAccessedAt, nowMs);
        const registryStr = repo.spec.registry.padEnd(6);

        yield* Console.log(`${registryStr}  ${spec.padEnd(40)}  ${size.padStart(10)}  ${date}`);
      }

      yield* Console.log("═".repeat(80));
      const totalSize = sorted.reduce((sum, r) => sum + r.sizeBytes, 0);
      yield* Console.log(`Total: ${formatBytes(totalSize)}`);
    }),
);
