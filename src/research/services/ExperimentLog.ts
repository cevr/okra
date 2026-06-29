import { Effect, Layer, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { ResearchError, ErrorCode } from "../errors.js";
import { decodeExperimentEvent, encodeExperimentEvent, ResultEvent } from "../types.js";
import type { Direction, ExperimentEvent, ExperimentState, Session, SteerEvent } from "../types.js";
import { buildXpPaths } from "../paths.js";
import { formatResultForLog } from "../prompt.js";
import { shouldKeep } from "../scoring.js";

const wrapIO = (e: PlatformError, code: ErrorCode = ErrorCode.WRITE_FAILED) =>
  new ResearchError({ message: e.message, code });

const isBetterBest = (
  candidate: ResultEvent,
  current: ResultEvent | undefined,
  direction: Direction | undefined,
): boolean => {
  if (current === undefined || current.value === undefined) return true;
  if (candidate.value === undefined) return false;
  if (direction === undefined) return true;
  return shouldKeep(direction, candidate.value, current.value);
};

interface MutableState {
  segment: number;
  iteration: number;
  direction: Direction | undefined;
  baseline: ResultEvent | undefined;
  best: ResultEvent | undefined;
  results: Array<ResultEvent>;
  steers: Array<SteerEvent>;
  lastPendingResult: ResultEvent | undefined;
  hasDecisionForLastPending: boolean;
  lastPendingCommit: string | undefined;
}

const applyResultEvent = (s: MutableState, event: ResultEvent): void => {
  s.iteration = Math.max(s.iteration, event.iteration);
  s.results.push(event);
  if (event.kind === "baseline" && event.status !== "failed") {
    s.baseline = event;
    if (s.best === undefined) s.best = event;
  }
  if (
    event.status === "kept" &&
    event.value !== undefined &&
    isBetterBest(event, s.best, s.direction)
  ) {
    s.best = event;
  }
  if (event.status === "pending") {
    s.lastPendingResult = event;
    s.hasDecisionForLastPending = false;
  }
};

const applyDecisionEvent = (
  s: MutableState,
  event: Extract<ExperimentEvent, { readonly _tag: "decision" }>,
): void => {
  s.iteration = Math.max(s.iteration, event.iteration);
  if (s.lastPendingResult === undefined || s.lastPendingResult.iteration !== event.iteration) {
    return;
  }
  s.hasDecisionForLastPending = true;
  const idx = s.results.findIndex((r) => r.iteration === event.iteration && r.status === "pending");
  const r = idx !== -1 ? s.results[idx] : undefined;
  if (r === undefined) return;
  const updated = new ResultEvent({
    timestamp: r.timestamp,
    segment: r.segment,
    iteration: r.iteration,
    kind: r.kind,
    status: event.status,
    value: event.value ?? r.value,
    durationMs: r.durationMs,
    summary: r.summary,
    provider: r.provider,
    commit: r.commit,
    diff: r.diff,
    failure: r.failure,
  });
  s.results[idx] = updated;
  if (
    event.status === "kept" &&
    updated.value !== undefined &&
    isBetterBest(updated, s.best, s.direction)
  ) {
    s.best = updated;
  }
};

const reconstructFromEvents = (events: ReadonlyArray<ExperimentEvent>): ExperimentState => {
  const s: MutableState = {
    segment: 0,
    iteration: 0,
    direction: undefined,
    baseline: undefined,
    best: undefined,
    results: [],
    steers: [],
    lastPendingResult: undefined,
    hasDecisionForLastPending: true,
    lastPendingCommit: undefined,
  };

  for (const event of events) {
    switch (event._tag) {
      case "config":
        s.segment = event.segment;
        s.direction = event.direction;
        break;
      case "result":
        applyResultEvent(s, event);
        break;
      case "decision":
        applyDecisionEvent(s, event);
        break;
      case "committed":
        if (
          s.lastPendingResult !== undefined &&
          s.lastPendingResult.iteration === event.iteration
        ) {
          s.lastPendingCommit = event.commit;
        }
        break;
      case "steer":
        s.steers.push(event);
        break;
      case "lifecycle":
        break;
    }
  }

  return {
    segment: s.segment,
    iteration: s.iteration,
    baseline: s.baseline,
    best: s.best,
    results: s.results,
    steers: s.steers,
    lastPendingResult: s.lastPendingResult,
    hasDecisionForLastPending: s.hasDecisionForLastPending,
    lastPendingCommit: s.lastPendingCommit,
  };
};

const generateMarkdown = (session: Session, state: ExperimentState): string => {
  const lines: Array<string> = [];
  lines.push(`# Experiment: ${session.name}`);
  lines.push("");
  lines.push(`**Objective**: ${session.objective}`);
  lines.push(
    `**Goal**: ${session.direction === "min" ? "minimize" : "maximize"} (${session.unit || "unitless"})`,
  );
  lines.push(`**Provider**: ${session.provider}`);
  lines.push(`**Segment**: ${state.segment} | **Iteration**: ${state.iteration}`);
  lines.push("");

  if (state.baseline !== undefined) {
    lines.push(`## Baseline`);
    lines.push(formatResultForLog(state.baseline, session));
    lines.push("");
  }

  if (state.best !== undefined && state.best !== state.baseline) {
    lines.push(`## Best Result`);
    lines.push(formatResultForLog(state.best, session));
    lines.push("");
  }

  const trials = state.results.filter((r) => r.kind === "trial");
  if (trials.length > 0) {
    lines.push(`## Trial History (${trials.length} total)`);
    for (const trial of trials.slice(-10)) {
      lines.push(formatResultForLog(trial, session));
    }
    lines.push("");
  }

  if (state.steers.length > 0) {
    lines.push(`## User Guidance`);
    for (const s of state.steers.slice(-5)) {
      lines.push(`- ${s.guidance}`);
    }
    lines.push("");
  }

  return lines.join("\n");
};

export class ExperimentLogService extends Context.Service<
  ExperimentLogService,
  {
    readonly append: (
      projectRoot: string,
      event: ExperimentEvent,
    ) => Effect.Effect<void, ResearchError>;
    readonly readAll: (
      projectRoot: string,
    ) => Effect.Effect<ReadonlyArray<ExperimentEvent>, ResearchError>;
    readonly reconstructState: (
      projectRoot: string,
    ) => Effect.Effect<ExperimentState, ResearchError>;
    readonly regenerateMarkdown: (
      projectRoot: string,
      session: Session,
    ) => Effect.Effect<void, ResearchError>;
  }
>()("@cvr/okra/research/services/ExperimentLog/ExperimentLogService") {
  static layer: Layer.Layer<ExperimentLogService, never, FileSystem | Path> = Layer.effect(
    ExperimentLogService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      return {
        append: Effect.fn("ExperimentLog.append")(function* (projectRoot, event) {
          const paths = buildXpPaths(path, projectRoot);
          const json = encodeExperimentEvent(event);
          yield* fs
            .writeFileString(paths.experimentsJsonl, json + "\n", { flag: "a" })
            .pipe(Effect.mapError((e) => wrapIO(e)));
        }),

        readAll: Effect.fn("ExperimentLog.readAll")(function* (projectRoot) {
          const paths = buildXpPaths(path, projectRoot);
          const exists = yield* fs
            .exists(paths.experimentsJsonl)
            .pipe(Effect.orElseSucceed(() => false));
          if (!exists) return [] as ReadonlyArray<ExperimentEvent>;
          const raw = yield* fs
            .readFileString(paths.experimentsJsonl)
            .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.READ_FAILED)));
          return yield* Effect.try({
            try: () =>
              raw
                .split("\n")
                .filter((line) => line.trim().length > 0)
                .map((line) => decodeExperimentEvent(line)),
            catch: (e) =>
              new ResearchError({
                message: `Failed to decode experiment log: ${String(e)}`,
                code: ErrorCode.READ_FAILED,
              }),
          });
        }),

        reconstructState: Effect.fn("ExperimentLog.reconstructState")(function* (projectRoot) {
          const paths = buildXpPaths(path, projectRoot);
          const exists = yield* fs
            .exists(paths.experimentsJsonl)
            .pipe(Effect.orElseSucceed(() => false));
          if (!exists) {
            return {
              segment: 0,
              iteration: 0,
              baseline: undefined,
              best: undefined,
              results: [],
              steers: [],
              lastPendingResult: undefined,
              hasDecisionForLastPending: true,
              lastPendingCommit: undefined,
            } satisfies ExperimentState;
          }
          const raw = yield* fs
            .readFileString(paths.experimentsJsonl)
            .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.READ_FAILED)));
          const events: Array<ExperimentEvent> = [];
          for (const line of raw.split("\n")) {
            if (line.trim().length === 0) continue;
            const decoded = yield* Effect.try({
              try: () => decodeExperimentEvent(line),
              catch: () => "decode-failed" as const,
            }).pipe(
              Effect.catch(() =>
                Effect.as(
                  Effect.logWarning(
                    `[okra research] skipping malformed JSONL line: ${line.slice(0, 80)}`,
                  ),
                  undefined,
                ),
              ),
            );
            if (decoded !== undefined) events.push(decoded);
          }
          return reconstructFromEvents(events);
        }),

        regenerateMarkdown: Effect.fn("ExperimentLog.regenerateMarkdown")(
          function* (projectRoot, session) {
            const paths = buildXpPaths(path, projectRoot);
            const exists = yield* fs
              .exists(paths.experimentsJsonl)
              .pipe(Effect.orElseSucceed(() => false));
            if (!exists) return;
            const raw = yield* fs
              .readFileString(paths.experimentsJsonl)
              .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.READ_FAILED)));
            const events = raw
              .split("\n")
              .filter((line) => line.trim().length > 0)
              .map((line) => decodeExperimentEvent(line));
            const state = reconstructFromEvents(events);
            const md = generateMarkdown(session, state);
            yield* fs
              .writeFileString(paths.experimentMd, md)
              .pipe(Effect.mapError((e) => wrapIO(e)));
          },
        ),
      };
    }),
  );
}
