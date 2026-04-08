import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { specToString } from "../types.js";
import { RepoError } from "../errors.js";
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
      return yield* new RepoError({
        message: `Not cached: ${specToString(parsedSpec)}. Run: okra repo fetch ${spec}`,
        code: "NOT_CACHED",
      });
    }

    yield* Console.log(existingOpt.value.path);
  }),
);
