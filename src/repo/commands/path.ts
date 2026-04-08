import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { specToString } from "../types.js";
import { MetadataService } from "../services/metadata.js";
import { RegistryService } from "../services/registry.js";

const specArg = Argument.string("spec").pipe(
  Argument.withDescription("Package spec to get path for"),
);

export const path = Command.make("path", { spec: specArg }, ({ spec }) =>
  Effect.gen(function* () {
    const registry = yield* RegistryService;
    const metadata = yield* MetadataService;

    const parsedSpec = yield* registry.parseSpec(spec);
    const existingOpt = yield* metadata.find(parsedSpec);

    if (Option.isNone(existingOpt)) {
      yield* Console.error(`Not cached: ${specToString(parsedSpec)}`);
      yield* Console.error(`Run: okra repo fetch ${spec}`);
      return yield* Effect.die("not-found");
    }

    yield* Console.log(existingOpt.value.path);
  }),
);
