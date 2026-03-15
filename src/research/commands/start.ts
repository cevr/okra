// @effect-diagnostics effect/nodeBuiltinImport:off
import { basename } from "node:path";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { Session } from "../types.js";
import { ResearchError, ErrorCode } from "../errors.js";
import { SessionService } from "../services/Session.js";
import { DaemonService } from "../services/Daemon.js";
import { AgentPlatformService } from "../services/AgentPlatform.js";
import { xpPaths } from "../paths.js";
import { mkdirSync } from "node:fs";

const parseUntil = (raw: string): Date => {
  // Try full ISO datetime first
  const full = new Date(raw);
  if (!Number.isNaN(full.getTime()) && raw.includes("T")) {
    return full;
  }
  // Date-only → EOD local
  const dateOnly = new Date(`${raw}T23:59:59.999`);
  if (Number.isNaN(dateOnly.getTime())) {
    throw new Error(`Invalid date: ${raw}`);
  }
  return dateOnly;
};

export const startCommand = Command.make(
  "start",
  {
    name: Flag.string("name").pipe(
      Flag.optional,
      Flag.withDescription("Experiment name (default: directory name)"),
    ),
    unit: Flag.string("unit").pipe(Flag.withDefault(""), Flag.withDescription("Metric unit")),
    direction: Flag.choice("direction", ["min", "max"]).pipe(
      Flag.withDescription("Optimization direction"),
    ),
    benchmark: Flag.string("benchmark").pipe(Flag.withDescription("Benchmark command to run")),
    objective: Flag.string("objective").pipe(
      Flag.withDescription("Optimization objective description"),
    ),
    maxIterations: Flag.integer("max-iterations").pipe(
      Flag.withDefault(50),
      Flag.withDescription("Maximum iterations"),
    ),
    maxFailures: Flag.integer("max-failures").pipe(
      Flag.withDefault(5),
      Flag.withDescription("Maximum consecutive failures before stopping"),
    ),
    provider: Flag.choice("provider", ["claude", "codex"]).pipe(
      Flag.withDefault("claude" as const),
      Flag.withDescription("Agent provider"),
    ),
    maxMinutes: Flag.integer("max-minutes").pipe(
      Flag.optional,
      Flag.withDescription("Maximum wall-clock runtime in minutes"),
    ),
    until: Flag.string("until").pipe(
      Flag.optional,
      Flag.withDescription(
        "Deadline as ISO date or datetime (e.g. 2026-03-15 or 2026-03-15T14:00:00)",
      ),
    ),
  },
  ({
    name: nameOpt,
    unit,
    direction,
    benchmark,
    objective,
    maxIterations,
    maxFailures,
    provider,
    maxMinutes,
    until: untilOpt,
  }) =>
    Effect.gen(function* () {
      const sessionSvc = yield* SessionService;
      const daemon = yield* DaemonService;
      const agentPlatform = yield* AgentPlatformService;

      const projectRoot = process.cwd();
      const paths = xpPaths(projectRoot);

      // Ensure .xp directory exists
      mkdirSync(paths.xpDir, { recursive: true });

      const name = Option.getOrElse(nameOpt, () => basename(projectRoot));

      // Check if resuming
      const exists = yield* sessionSvc.exists(projectRoot);
      if (exists) {
        // Resume existing session
        const session = yield* sessionSvc.load(projectRoot);
        yield* Console.log(`Resuming experiment: ${session.name}`);

        const isRunning = yield* daemon.isRunning(projectRoot);
        if (isRunning) {
          yield* Console.log("Daemon already running.");
          return;
        }

        yield* agentPlatform.ensureExecutable(session.provider);
        const pid = yield* daemon.start(projectRoot);
        yield* Console.log(`Daemon started (pid ${pid})`);
        return;
      }

      // Validate provider is available
      yield* agentPlatform.ensureExecutable(provider as "claude" | "codex");

      // Validate mutual exclusivity of --max-minutes and --until
      const hasMaxMinutes = maxMinutes._tag === "Some";
      const hasUntil = untilOpt._tag === "Some";

      if (hasMaxMinutes && hasUntil) {
        yield* Console.error("Error: --max-minutes and --until are mutually exclusive");
        return;
      }

      // Normalize to deadline
      let deadline: string | undefined;
      if (hasMaxMinutes) {
        deadline = new Date(Date.now() + maxMinutes.value * 60_000).toISOString();
      } else if (hasUntil) {
        const parsed = yield* Effect.try({
          try: () => parseUntil(untilOpt.value),
          catch: (e) =>
            new ResearchError({
              message: `Invalid --until value: ${e instanceof Error ? e.message : String(e)}`,
              code: ErrorCode.SESSION_NOT_FOUND,
            }),
        });
        deadline = parsed.toISOString();
      }

      const session = new Session({
        name,
        unit,
        direction: direction as "min" | "max",
        provider: provider as "claude" | "codex",
        objective,
        benchmarkCmd: benchmark,
        maxIterations,
        maxFailures,
        deadline,
        projectRoot,
        segment: 1,
        currentIteration: 0,
        createdAt: new Date().toISOString(),
      });

      yield* sessionSvc.init(session);
      yield* Console.log(`Experiment "${name}" initialized.`);
      yield* Console.log(`  direction: ${direction}`);
      yield* Console.log(`  benchmark: ${benchmark}`);
      yield* Console.log(`  provider: ${provider}`);
      yield* Console.log(`  max iterations: ${maxIterations}`);
      if (deadline !== undefined) {
        yield* Console.log(`  deadline: ${deadline}`);
      }

      yield* Console.log(`Starting daemon...`);
      const pid = yield* daemon.start(projectRoot);
      yield* Console.log(`Daemon started (pid ${pid})`);
      yield* Console.log(`Tip: run 'okra research logs -f' to watch progress`);
    }),
).pipe(Command.withDescription("Initialize and start an experiment"));
