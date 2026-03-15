import { Schema } from "effect";
import { Provider } from "../shared/provider.js";

export { Provider };

export const Direction = Schema.Literals(["min", "max"]);
export type Direction = typeof Direction.Type;

export const ResultStatus = Schema.Literals(["pending", "kept", "discarded", "failed"]);
export type ResultStatus = typeof ResultStatus.Type;

export const ResultKind = Schema.Literals(["baseline", "trial"]);
export type ResultKind = typeof ResultKind.Type;

export const LifecycleEvent = Schema.Literals([
  "started",
  "paused",
  "recovery",
  "budget_exhausted",
  "setup_discover",
  "setup_replay",
  "benchmark_frozen",
]);
export type LifecycleEvent = typeof LifecycleEvent.Type;

// --- Session ---

export class Session extends Schema.Class<Session>("Session")(
  Schema.Struct({
    name: Schema.String,
    unit: Schema.String,
    direction: Direction,
    provider: Provider,
    objective: Schema.String,
    benchmarkCmd: Schema.String,
    maxIterations: Schema.Number,
    maxFailures: Schema.Number,
    deadline: Schema.optional(Schema.String),
    projectRoot: Schema.String,
    segment: Schema.Number,
    currentIteration: Schema.Number,
    bestValue: Schema.optional(Schema.Number),
    bestCommit: Schema.optional(Schema.String),
    createdAt: Schema.String,
  }),
) {}

export const SessionJson = Schema.fromJsonString(Session);
export const decodeSession = Schema.decodeUnknownSync(SessionJson);
export const encodeSession = Schema.encodeSync(SessionJson);

// --- JSONL Events ---

export class ConfigEvent extends Schema.Class<ConfigEvent>("ConfigEvent")(
  Schema.TaggedStruct("config", {
    timestamp: Schema.String,
    segment: Schema.Number,
    name: Schema.String,
    unit: Schema.String,
    direction: Direction,
    provider: Provider,
    sourceCommit: Schema.String,
    benchmarkCmd: Schema.String,
    benchmarkDigest: Schema.String,
    setupDigest: Schema.optional(Schema.String),
  }),
) {}

export class BenchmarkFailure extends Schema.Class<BenchmarkFailure>("BenchmarkFailure")(
  Schema.Struct({
    exitCode: Schema.Number,
    output: Schema.String,
  }),
) {}

export class ResultEvent extends Schema.Class<ResultEvent>("ResultEvent")(
  Schema.TaggedStruct("result", {
    timestamp: Schema.String,
    segment: Schema.Number,
    iteration: Schema.Number,
    kind: ResultKind,
    status: ResultStatus,
    value: Schema.optional(Schema.Number),
    durationMs: Schema.Number,
    summary: Schema.String,
    provider: Schema.optional(Provider),
    commit: Schema.optional(Schema.String),
    diff: Schema.optional(Schema.String),
    failure: Schema.optional(BenchmarkFailure),
  }),
) {}

export class DecisionEvent extends Schema.Class<DecisionEvent>("DecisionEvent")(
  Schema.TaggedStruct("decision", {
    timestamp: Schema.String,
    segment: Schema.Number,
    iteration: Schema.Number,
    status: Schema.Literals(["kept", "discarded", "failed"]),
    value: Schema.optional(Schema.Number),
  }),
) {}

export class SteerEvent extends Schema.Class<SteerEvent>("SteerEvent")(
  Schema.TaggedStruct("steer", {
    timestamp: Schema.String,
    segment: Schema.Number,
    iteration: Schema.Number,
    guidance: Schema.String,
  }),
) {}

export class CommittedEvent extends Schema.Class<CommittedEvent>("CommittedEvent")(
  Schema.TaggedStruct("committed", {
    timestamp: Schema.String,
    segment: Schema.Number,
    iteration: Schema.Number,
    commit: Schema.String,
  }),
) {}

export class LifecycleEventEntry extends Schema.Class<LifecycleEventEntry>("LifecycleEventEntry")(
  Schema.TaggedStruct("lifecycle", {
    timestamp: Schema.String,
    event: LifecycleEvent,
    detail: Schema.optional(Schema.String),
  }),
) {}

export const ExperimentEvent = Schema.Union([
  ConfigEvent,
  ResultEvent,
  DecisionEvent,
  CommittedEvent,
  SteerEvent,
  LifecycleEventEntry,
]);
export type ExperimentEvent = typeof ExperimentEvent.Type;

export const ExperimentEventJson = Schema.fromJsonString(ExperimentEvent);
export const decodeExperimentEvent = Schema.decodeUnknownSync(ExperimentEventJson);
export const encodeExperimentEvent = Schema.encodeSync(ExperimentEventJson);

// --- Benchmark Result ---

export class BenchmarkResult extends Schema.Class<BenchmarkResult>("BenchmarkResult")(
  Schema.Struct({
    stdout: Schema.String,
    stderr: Schema.String,
    exitCode: Schema.Number,
    durationMs: Schema.Number,
    value: Schema.optional(Schema.Number),
  }),
) {}

// --- Agent Result ---

export class AgentResult extends Schema.Class<AgentResult>("AgentResult")(
  Schema.Struct({
    exitCode: Schema.Number,
    output: Schema.String,
    stderr: Schema.String,
    durationMs: Schema.Number,
  }),
) {}

// --- Setup Manifest ---

export class SetupManifest extends Schema.Class<SetupManifest>("SetupManifest")(
  Schema.Struct({
    files: Schema.optional(
      Schema.Array(
        Schema.Struct({
          source: Schema.String,
          destination: Schema.String,
        }),
      ),
    ),
    symlinks: Schema.optional(
      Schema.Array(
        Schema.Struct({
          source: Schema.String,
          destination: Schema.String,
        }),
      ),
    ),
    commands: Schema.optional(Schema.Array(Schema.String)),
  }),
) {}

export const SetupManifestJson = Schema.fromJsonString(SetupManifest);
export const decodeSetupManifest = Schema.decodeUnknownSync(SetupManifestJson);
export const encodeSetupManifest = Schema.encodeSync(SetupManifestJson);

// --- Reconstructed State ---

export interface ExperimentState {
  readonly segment: number;
  readonly iteration: number;
  readonly baseline: ResultEvent | undefined;
  readonly best: ResultEvent | undefined;
  readonly results: ReadonlyArray<ResultEvent>;
  readonly steers: ReadonlyArray<SteerEvent>;
  readonly lastPendingResult: ResultEvent | undefined;
  readonly hasDecisionForLastPending: boolean;
  /** Commit SHA from a committed event for the last pending result (crash recovery) */
  readonly lastPendingCommit: string | undefined;
}
