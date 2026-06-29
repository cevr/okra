import { createHash } from "node:crypto";
import { DateTime, Effect, Layer, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { ResearchError, ErrorCode } from "../errors.js";
import {
  CommittedEvent,
  ConfigEvent,
  DecisionEvent,
  LifecycleEventEntry,
  ResultEvent,
  SteerEvent,
} from "../types.js";
import type { ExperimentState, Session } from "../types.js";
import { buildXpPaths } from "../paths.js";
import { buildExperimentPrompt, buildSetupPrompt } from "../prompt.js";
import { shouldKeep } from "../scoring.js";
import { AgentPlatformService } from "./AgentPlatform.js";
import { BudgetService } from "./Budget.js";
import { ExperimentLogService } from "./ExperimentLog.js";
import { GitService } from "./Git.js";
import { RunnerService } from "./Runner.js";
import { SessionService } from "./Session.js";
import { WorkspaceService } from "./Workspace.js";

const wrapIO = (e: PlatformError, code: ErrorCode = ErrorCode.WRITE_FAILED) =>
  new ResearchError({ message: e.message, code });

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const logProgress = (fs: FileSystem, daemonLog: string, message: string) =>
  Effect.gen(function* () {
    const stamp = yield* nowIso;
    yield* fs
      .writeFileString(daemonLog, `[${stamp}] ${message}\n`, { flag: "a" })
      .pipe(Effect.catch(() => Effect.void));
  });

const hashFiles = (fs: FileSystem, files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const hash = createHash("sha256");
    for (const file of files) {
      const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        const buf = yield* fs
          .readFile(file)
          .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.BENCHMARK_FAILED)));
        hash.update(buf);
      }
    }
    return hash.digest("hex");
  });

const parseBenchmarkFiles = (fs: FileSystem, path: Path, cmd: string, cwd: string) =>
  Effect.gen(function* () {
    const parts = cmd.split(/\s+/);
    const files: Array<string> = [];
    for (const part of parts) {
      const resolved = path.join(cwd, part);
      const exists = yield* fs.exists(resolved).pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        files.push(resolved);
      }
    }
    return files as ReadonlyArray<string>;
  });

export class LoopService extends Context.Service<
  LoopService,
  {
    readonly run: (projectRoot: string) => Effect.Effect<void, ResearchError>;
  }
>()("@cvr/okra/research/services/Loop/LoopService") {
  static layer: Layer.Layer<
    LoopService,
    never,
    | AgentPlatformService
    | BudgetService
    | ExperimentLogService
    | GitService
    | RunnerService
    | SessionService
    | WorkspaceService
    | FileSystem
    | Path
  > = Layer.effect(
    LoopService,
    Effect.gen(function* () {
      const agent = yield* AgentPlatformService;
      const budget = yield* BudgetService;
      const log = yield* ExperimentLogService;
      const git = yield* GitService;
      const runner = yield* RunnerService;
      const sessionSvc = yield* SessionService;
      const workspace = yield* WorkspaceService;
      const fs = yield* FileSystem;
      const path = yield* Path;

      return {
        run: (projectRoot) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, projectRoot);

            // --- STARTUP ---
            yield* appendLifecycle(log, projectRoot, "started");
            yield* logProgress(fs, paths.daemonLog, "daemon started");
            const session = yield* sessionSvc.load(projectRoot);

            // Reconstruct state from JSONL
            let state = yield* log.reconstructState(projectRoot);

            // Reconciliation
            yield* reconcile(fs, path, log, git, projectRoot, state);
            state = yield* log.reconstructState(projectRoot);

            // Ensure worktree
            const worktreePath = yield* workspace.setup(session);

            // Setup discovery if new session with no setup.json
            const setupExists = yield* fs
              .exists(paths.setupJson)
              .pipe(Effect.orElseSucceed(() => false));
            if (!setupExists && state.iteration === 0) {
              yield* appendLifecycle(log, projectRoot, "setup_discover");
              const setupPrompt = buildSetupPrompt(projectRoot, worktreePath, session.benchmarkCmd);
              yield* agent.invoke(session.provider, setupPrompt, worktreePath, paths.daemonLog);
            } else if (setupExists) {
              yield* appendLifecycle(log, projectRoot, "setup_replay");
            }

            // Freeze benchmark digest
            const benchmarkFiles = yield* parseBenchmarkFiles(
              fs,
              path,
              session.benchmarkCmd,
              worktreePath,
            );
            const benchmarkDigest = yield* hashFiles(fs, benchmarkFiles);
            yield* fs
              .writeFileString(paths.benchmarkDigest, benchmarkDigest)
              .pipe(Effect.mapError((e) => wrapIO(e)));
            yield* appendLifecycle(log, projectRoot, "benchmark_frozen");

            // Baseline if needed
            if (state.baseline === undefined) {
              yield* logProgress(fs, paths.daemonLog, "running baseline benchmark...");
              const baselineResult = yield* runner.run(session.benchmarkCmd, worktreePath);
              const sourceCommit = yield* git.headSha(worktreePath);

              if (baselineResult.exitCode !== 0) {
                return yield* new ResearchError({
                  message: `Baseline benchmark failed (exit ${baselineResult.exitCode}): ${baselineResult.stderr}`,
                  code: ErrorCode.BENCHMARK_FAILED,
                });
              }

              if (baselineResult.value === undefined) {
                return yield* new ResearchError({
                  message: "Baseline benchmark did not emit a RESULT line",
                  code: ErrorCode.RESULT_PARSE_FAILED,
                });
              }

              const baselineValue = baselineResult.value;

              yield* log.append(
                projectRoot,
                new ConfigEvent({
                  _tag: "config",
                  timestamp: yield* nowIso,
                  segment: session.segment,
                  name: session.name,
                  unit: session.unit,
                  direction: session.direction,
                  provider: session.provider,
                  sourceCommit,
                  benchmarkCmd: session.benchmarkCmd,
                  benchmarkDigest,
                }),
              );

              yield* log.append(
                projectRoot,
                new ResultEvent({
                  _tag: "result",
                  timestamp: yield* nowIso,
                  segment: session.segment,
                  iteration: 0,
                  kind: "baseline",
                  status: "kept",
                  value: baselineValue,
                  durationMs: baselineResult.durationMs,
                  summary: "Baseline measurement",
                  commit: sourceCommit,
                }),
              );

              yield* sessionSvc.update(projectRoot, {
                bestValue: baselineValue,
                bestCommit: sourceCommit,
              });

              yield* logProgress(fs, paths.daemonLog, `baseline: ${baselineValue} ${session.unit}`);

              state = yield* log.reconstructState(projectRoot);
            }

            // Compute benchmark timeout: 5x baseline duration, minimum 30s
            const benchmarkTimeoutMs =
              state.baseline !== undefined
                ? Math.max(state.baseline.durationMs * 5, 30_000)
                : undefined;

            yield* log.regenerateMarkdown(projectRoot, session);

            // --- LOOP ---
            while (true) {
              const budgetCheck = yield* budget.check(session, state);
              if (!budgetCheck.canContinue) {
                yield* logProgress(
                  fs,
                  paths.daemonLog,
                  `budget exhausted: ${budgetCheck.reason ?? "unknown"}`,
                );
                yield* appendLifecycle(log, projectRoot, "budget_exhausted", budgetCheck.reason);
                yield* log.regenerateMarkdown(projectRoot, session);
                break;
              }

              // Consume steers
              const steers = yield* consumeSteers(
                fs,
                path,
                paths.steerDir,
                session.segment,
                state.iteration,
              );
              for (const steer of steers) {
                yield* log.append(projectRoot, steer);
              }

              // Verify benchmark integrity
              const currentDigest = yield* hashFiles(fs, benchmarkFiles);
              const storedDigest = yield* fs
                .readFileString(paths.benchmarkDigest)
                .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.READ_FAILED)));
              if (currentDigest !== storedDigest) {
                return yield* new ResearchError({
                  message: "Benchmark files were tampered with",
                  code: ErrorCode.BENCHMARK_TAMPERED,
                });
              }

              const nextIter = state.iteration + 1;
              yield* logProgress(
                fs,
                paths.daemonLog,
                `iter ${nextIter}/${session.maxIterations}: invoking ${session.provider}...`,
              );

              // Build prompt and invoke agent
              const allSteers = [...state.steers, ...steers];
              const prompt = buildExperimentPrompt(
                session,
                state,
                worktreePath,
                projectRoot,
                allSteers,
              );

              const agentResult = yield* agent.invoke(
                session.provider,
                prompt,
                worktreePath,
                paths.daemonLog,
              );

              const nextIteration = state.iteration + 1;

              // Agent failed — revert and log
              if (agentResult.exitCode !== 0) {
                yield* logProgress(
                  fs,
                  paths.daemonLog,
                  `iter ${nextIteration}: agent failed (exit ${agentResult.exitCode})`,
                );
                yield* git.revertWorktree(worktreePath);
                yield* log.append(
                  projectRoot,
                  new ResultEvent({
                    _tag: "result",
                    timestamp: yield* nowIso,
                    segment: session.segment,
                    iteration: nextIteration,
                    kind: "trial",
                    status: "failed",
                    durationMs: agentResult.durationMs,
                    summary: `Agent exited with code ${agentResult.exitCode}`,
                  }),
                );
                yield* sessionSvc.update(projectRoot, { currentIteration: nextIteration });
                state = yield* log.reconstructState(projectRoot);
                yield* log.regenerateMarkdown(projectRoot, session);
                continue;
              }

              // Check if agent made changes
              const isWorktreeClean = yield* git.isClean(worktreePath);

              if (isWorktreeClean) {
                yield* logProgress(
                  fs,
                  paths.daemonLog,
                  `iter ${nextIteration}: no changes — discarded`,
                );
                yield* log.append(
                  projectRoot,
                  new ResultEvent({
                    _tag: "result",
                    timestamp: yield* nowIso,
                    segment: session.segment,
                    iteration: nextIteration,
                    kind: "trial",
                    status: "discarded",
                    durationMs: agentResult.durationMs,
                    summary: "No changes made by agent",
                  }),
                );
                yield* sessionSvc.update(projectRoot, { currentIteration: nextIteration });
                state = yield* log.reconstructState(projectRoot);
                yield* log.regenerateMarkdown(projectRoot, session);
                continue;
              }

              // Capture diff
              const diffOutput = yield* git.diff(worktreePath);

              // Write pending result
              yield* log.append(
                projectRoot,
                new ResultEvent({
                  _tag: "result",
                  timestamp: yield* nowIso,
                  segment: session.segment,
                  iteration: nextIteration,
                  kind: "trial",
                  status: "pending",
                  durationMs: agentResult.durationMs,
                  summary: agentResult.output.trim().slice(-500),
                  diff: diffOutput.slice(0, 1000),
                }),
              );

              // Run benchmark and decide outcome
              const benchResult = yield* runner
                .run(session.benchmarkCmd, worktreePath, benchmarkTimeoutMs)
                .pipe(
                  Effect.catchTag("@cvr/okra/research/ResearchError", (e) =>
                    Effect.succeed({
                      exitCode: 1,
                      stdout: "",
                      stderr: e.message,
                      durationMs: 0,
                      value: undefined as number | undefined,
                    }),
                  ),
                );

              yield* decideBenchmarkOutcome({
                fs,
                git,
                log,
                sessionSvc,
                paths,
                projectRoot,
                session,
                state,
                benchResult,
                nextIteration,
                worktreePath,
              });

              state = yield* log.reconstructState(projectRoot);
              yield* log.regenerateMarkdown(projectRoot, session);
            }

            // Clean exit
            yield* appendLifecycle(log, projectRoot, "paused");
          }),
      };
    }),
  );
}

interface BenchmarkRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly value?: number | undefined;
}

interface DecideArgs {
  fs: FileSystem;
  git: Context.Service.Shape<typeof GitService>;
  log: Context.Service.Shape<typeof ExperimentLogService>;
  sessionSvc: Context.Service.Shape<typeof SessionService>;
  paths: ReturnType<typeof buildXpPaths>;
  projectRoot: string;
  session: Session;
  state: ExperimentState;
  benchResult: BenchmarkRunResult;
  nextIteration: number;
  worktreePath: string;
}

const decideBenchmarkOutcome = (args: DecideArgs) =>
  Effect.gen(function* () {
    const {
      fs,
      git,
      log,
      sessionSvc,
      paths,
      projectRoot,
      session,
      state,
      benchResult,
      nextIteration,
      worktreePath,
    } = args;
    if (benchResult.exitCode !== 0) {
      yield* logProgress(
        fs,
        paths.daemonLog,
        `iter ${nextIteration}: benchmark failed (exit ${benchResult.exitCode}) — reverted`,
      );
      yield* git.revertWorktree(worktreePath);
      yield* log.append(
        projectRoot,
        new DecisionEvent({
          _tag: "decision",
          timestamp: yield* nowIso,
          segment: session.segment,
          iteration: nextIteration,
          status: "failed",
        }),
      );
      return;
    }

    const bestValue = state.best?.value;
    const metricValue = benchResult.value;

    if (
      metricValue !== undefined &&
      bestValue !== undefined &&
      shouldKeep(session.direction, metricValue, bestValue)
    ) {
      const sha = yield* git.commitInWorktree(
        worktreePath,
        `xp(${session.name}): iter ${nextIteration} — ${metricValue}${session.unit !== "" ? " " + session.unit : ""}`,
      );
      yield* log.append(
        projectRoot,
        new CommittedEvent({
          _tag: "committed",
          timestamp: yield* nowIso,
          segment: session.segment,
          iteration: nextIteration,
          commit: sha,
        }),
      );
      yield* log.append(
        projectRoot,
        new DecisionEvent({
          _tag: "decision",
          timestamp: yield* nowIso,
          segment: session.segment,
          iteration: nextIteration,
          status: "kept",
          value: metricValue,
        }),
      );
      yield* sessionSvc.update(projectRoot, {
        currentIteration: nextIteration,
        bestValue: metricValue,
        bestCommit: sha,
      });
      yield* logProgress(
        fs,
        paths.daemonLog,
        `iter ${nextIteration}: ${metricValue} ${session.unit} — KEPT (was ${bestValue} ${session.unit})`,
      );
      return;
    }

    yield* git.revertWorktree(worktreePath);
    yield* log.append(
      projectRoot,
      new DecisionEvent({
        _tag: "decision",
        timestamp: yield* nowIso,
        segment: session.segment,
        iteration: nextIteration,
        status: "discarded",
        value: metricValue,
      }),
    );
    yield* sessionSvc.update(projectRoot, {
      currentIteration: nextIteration,
    });
    yield* logProgress(
      fs,
      paths.daemonLog,
      `iter ${nextIteration}: ${metricValue ?? "N/A"} ${session.unit} — discarded (best: ${bestValue} ${session.unit})`,
    );
  });

const appendLifecycle = Effect.fn("appendLifecycle")(function* (
  log: Context.Service.Shape<typeof ExperimentLogService>,
  projectRoot: string,
  event: LifecycleEventEntry["event"],
  detail?: string,
) {
  yield* log.append(
    projectRoot,
    new LifecycleEventEntry({
      _tag: "lifecycle",
      timestamp: yield* nowIso,
      event,
      detail,
    }),
  );
});

const consumeSteers = (
  fs: FileSystem,
  path: Path,
  steerDir: string,
  segment: number,
  iteration: number,
) =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(steerDir).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return [] as ReadonlyArray<SteerEvent>;
    const allFiles = yield* fs
      .readDirectory(steerDir)
      .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.READ_FAILED)));
    const files = allFiles.filter((f) => f.endsWith(".txt")).sort();
    const steers: Array<SteerEvent> = [];
    for (const file of files) {
      const filePath = path.join(steerDir, file);
      const content = yield* fs
        .readFileString(filePath)
        .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.READ_FAILED)));
      const trimmed = content.trim();
      if (trimmed !== "") {
        steers.push(
          new SteerEvent({
            _tag: "steer",
            timestamp: yield* nowIso,
            segment,
            iteration,
            guidance: trimmed,
          }),
        );
      }
      yield* fs.remove(filePath).pipe(Effect.catch(() => Effect.void));
    }
    return steers as ReadonlyArray<SteerEvent>;
  });

const reconcile = (
  fs: FileSystem,
  path: Path,
  log: Context.Service.Shape<typeof ExperimentLogService>,
  git: Context.Service.Shape<typeof GitService>,
  projectRoot: string,
  state: ExperimentState,
) =>
  Effect.gen(function* () {
    if (state.lastPendingResult === undefined || state.hasDecisionForLastPending) return;

    const paths = buildXpPaths(path, projectRoot);
    const worktreePath = paths.worktree;

    const worktreeExists = yield* fs.exists(worktreePath).pipe(Effect.orElseSucceed(() => false));
    if (!worktreeExists) {
      yield* appendLifecycle(
        log,
        projectRoot,
        "recovery",
        "Worktree missing during reconciliation",
      );
      return;
    }

    const pendingCommit = state.lastPendingCommit;

    if (pendingCommit !== undefined) {
      const headSha = yield* git.headSha(worktreePath);
      if (headSha === pendingCommit) {
        yield* log.append(
          projectRoot,
          new DecisionEvent({
            _tag: "decision",
            timestamp: yield* nowIso,
            segment: state.segment,
            iteration: state.lastPendingResult.iteration,
            status: "kept",
          }),
        );
      } else {
        yield* git.revertWorktree(worktreePath);
        yield* log.append(
          projectRoot,
          new DecisionEvent({
            _tag: "decision",
            timestamp: yield* nowIso,
            segment: state.segment,
            iteration: state.lastPendingResult.iteration,
            status: "discarded",
          }),
        );
      }
    } else {
      yield* git.revertWorktree(worktreePath);
      yield* log.append(
        projectRoot,
        new DecisionEvent({
          _tag: "decision",
          timestamp: yield* nowIso,
          segment: state.segment,
          iteration: state.lastPendingResult.iteration,
          status: "discarded",
        }),
      );
    }

    yield* appendLifecycle(log, projectRoot, "recovery", "Reconciled pending result");
  });
