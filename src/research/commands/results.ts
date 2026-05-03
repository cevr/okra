import { Console, Effect, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ExperimentLogService } from "../services/ExperimentLog.js";
import { SessionService } from "../services/Session.js";
import { formatResultForLog } from "../prompt.js";
import { ResultEvent } from "../types.js";

const ResultsJson = Schema.fromJsonString(Schema.Array(ResultEvent));
const encodeResultsJson = Schema.encodeSync(ResultsJson);

export const resultsCommand = Command.make(
  "results",
  {
    json: Flag.boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Output as JSON"),
    ),
    last: Flag.integer("last").pipe(Flag.optional, Flag.withDescription("Show last N results")),
  },
  ({ json, last }) =>
    Effect.gen(function* () {
      const experimentLog = yield* ExperimentLogService;
      const sessionSvc = yield* SessionService;
      const projectRoot = process.cwd();

      const session = yield* sessionSvc.load(projectRoot);
      const state = yield* experimentLog.reconstructState(projectRoot);
      const results = last._tag === "Some" ? state.results.slice(-last.value) : state.results;

      if (json) {
        yield* Console.log(encodeResultsJson(results));
      } else {
        if (results.length === 0) {
          yield* Console.log("No results yet.");
          return;
        }
        for (const result of results) {
          yield* Console.log(formatResultForLog(result, session));
        }
      }
    }),
).pipe(Command.withDescription("Show experiment results"));
