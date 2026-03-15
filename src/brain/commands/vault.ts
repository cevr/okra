import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { ConfigService } from "../services/Config.js";
import { BrainError } from "../errors/index.js";

const projectFlag = Flag.boolean("project").pipe(
  Flag.withAlias("p"),
  Flag.withDescription("Show project vault path"),
);
const globalFlag = Flag.boolean("global").pipe(
  Flag.withAlias("g"),
  Flag.withDescription("Show global vault path"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const vault = Command.make("vault", {
  project: projectFlag,
  global: globalFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Print active vault path"),
  Command.withHandler(({ project, global, json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigService;

      if (json) {
        const globalPath = yield* config.globalVaultPath();
        const projectPath = yield* config.projectVaultPath();
        const active = yield* config.activeVaultPath();
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(
          JSON.stringify({
            global: globalPath,
            project: Option.getOrNull(projectPath),
            active,
          }),
        );
        return;
      }

      if (global) {
        yield* Console.log(yield* config.globalVaultPath());
      } else if (project) {
        const p = yield* config.projectVaultPath();
        if (Option.isSome(p)) {
          yield* Console.log(p.value);
        } else {
          return yield* new BrainError({
            message: "No project vault found",
            code: "NOT_INITIALIZED",
          });
        }
      } else {
        yield* Console.log(yield* config.activeVaultPath());
      }
    }),
  ),
);
