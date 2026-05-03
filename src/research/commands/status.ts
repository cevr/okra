import { Console, Effect, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { DaemonService } from "../services/Daemon.js";
import { SessionService } from "../services/Session.js";
import { ExperimentLogService } from "../services/ExperimentLog.js";
import { Direction, Provider } from "../types.js";

const NoSessionOutput = Schema.Struct({
  running: Schema.Literal(false),
  session: Schema.Null,
});
const encodeNoSessionOutput = Schema.encodeSync(Schema.fromJsonString(NoSessionOutput));

const StatusInfo = Schema.Struct({
  running: Schema.Boolean,
  pid: Schema.optional(Schema.Number),
  name: Schema.String,
  unit: Schema.String,
  direction: Direction,
  provider: Provider,
  iteration: Schema.Number,
  maxIterations: Schema.Number,
  deadline: Schema.optional(Schema.String),
  bestValue: Schema.optional(Schema.Number),
  baselineValue: Schema.optional(Schema.Number),
  totalTrials: Schema.Number,
  keptTrials: Schema.Number,
  failedTrials: Schema.Number,
});
const encodeStatusInfo = Schema.encodeSync(Schema.fromJsonString(StatusInfo));

export const statusCommand = Command.make(
  "status",
  {
    json: Flag.boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Output as JSON"),
    ),
  },
  ({ json }) =>
    Effect.gen(function* () {
      const daemon = yield* DaemonService;
      const sessionSvc = yield* SessionService;
      const experimentLog = yield* ExperimentLogService;
      const projectRoot = process.cwd();

      const daemonStatus = yield* daemon.status(projectRoot);
      const exists = yield* sessionSvc.exists(projectRoot);

      if (!exists) {
        if (json) {
          yield* Console.log(encodeNoSessionOutput({ running: false, session: null }));
        } else {
          yield* Console.log("No experiment session found.");
        }
        return;
      }

      const session = yield* sessionSvc.load(projectRoot);
      const state = yield* experimentLog.reconstructState(projectRoot);

      const info = {
        running: daemonStatus.running,
        pid: daemonStatus.pid,
        name: session.name,
        unit: session.unit,
        direction: session.direction,
        provider: session.provider,
        iteration: state.iteration,
        maxIterations: session.maxIterations,
        deadline: session.deadline,
        bestValue: state.best?.value,
        baselineValue: state.baseline?.value,
        totalTrials: state.results.filter((r) => r.kind === "trial").length,
        keptTrials: state.results.filter((r) => r.status === "kept").length,
        failedTrials: state.results.filter((r) => r.status === "failed").length,
      };

      if (json) {
        yield* Console.log(encodeStatusInfo(info));
      } else {
        const statusIcon = daemonStatus.running ? "running" : "stopped";
        yield* Console.log(`Experiment: ${session.name} [${statusIcon}]`);
        if (daemonStatus.pid !== undefined) yield* Console.log(`  pid: ${daemonStatus.pid}`);
        yield* Console.log(`  direction: ${session.direction}`);
        yield* Console.log(`  iteration: ${state.iteration}/${session.maxIterations}`);
        if (session.deadline !== undefined) yield* Console.log(`  deadline: ${session.deadline}`);
        if (state.baseline?.value !== undefined) {
          yield* Console.log(`  baseline: ${state.baseline.value} ${session.unit}`);
        }
        if (state.best?.value !== undefined) {
          yield* Console.log(`  best: ${state.best.value} ${session.unit}`);
        }
        yield* Console.log(
          `  trials: ${info.totalTrials} total, ${info.keptTrials} kept, ${info.failedTrials} failed`,
        );
      }
    }),
).pipe(Command.withDescription("Show experiment status"));
