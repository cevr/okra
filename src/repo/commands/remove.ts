import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { specToString, formatBytes } from "../types.js";
import { CacheService } from "../services/cache.js";
import { MetadataService } from "../services/metadata.js";
import { RegistryService } from "../services/registry.js";

const specArg = Argument.string("spec").pipe(Argument.withDescription("Package spec to remove"));

export const remove = Command.make("remove", { spec: specArg }, ({ spec }) =>
  Effect.gen(function* () {
    const registry = yield* RegistryService;
    const cache = yield* CacheService;
    const metadata = yield* MetadataService;

    const parsedSpec = yield* registry.parseSpec(spec);

    const existingOpt = yield* metadata.find(parsedSpec);
    if (Option.isNone(existingOpt)) {
      yield* Console.error(`Not found: ${specToString(parsedSpec)}`);
      return;
    }

    const existing = existingOpt.value;
    yield* cache.remove(existing.path);
    yield* metadata.remove(parsedSpec);

    yield* Console.error(`Removed: ${specToString(parsedSpec)}`);
    yield* Console.error(`Freed: ${formatBytes(existing.sizeBytes)}`);
    yield* Console.log(existing.path);
  }),
);
