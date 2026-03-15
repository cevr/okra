#!/usr/bin/env bun
import { Console, Effect, Layer, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { scheduleCommand, ScheduleServiceLayer } from "./schedule/index.js";
import { ScheduleError } from "./schedule/errors.js";
import { counselCommand } from "./counsel/index.js";
import { isCounselError } from "./counsel/errors.js";
import { researchCommand, ResearchServiceLayer } from "./research/index.js";
import { ResearchError } from "./research/errors.js";
import { brainCommand, BrainServiceLayer, isBrainDomainError } from "./brain/index.js";

const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";

const isScheduleError = Schema.is(ScheduleError);
const isResearchError = Schema.is(ResearchError);

const RECOVERY_HINTS: Record<string, string> = {
  NOT_FOUND: "Run 'okra schedule ls' to see available tasks.",
  INVALID_SCHEDULE: "See 'okra schedule --help' for schedule formats.",
};

const root = Command.make("okra", {}, () => Effect.void).pipe(
  Command.withDescription("AI agent orchestration toolkit"),
  Command.withSubcommands([scheduleCommand, counselCommand, researchCommand, brainCommand]),
);

const cli = Command.run(root, { version: VERSION });

const ServiceLayer = Layer.mergeAll(
  ScheduleServiceLayer,
  ResearchServiceLayer,
  BrainServiceLayer,
).pipe(Layer.provideMerge(BunServices.layer));

const program = cli.pipe(
  Effect.tapDefect((defect) => Console.error(`Internal error: ${String(defect)}`)),
  Effect.tapCause((cause) =>
    Effect.gen(function* () {
      for (const reason of cause.reasons) {
        if (reason._tag !== "Fail") continue;
        const err = reason.error;
        if (isScheduleError(err)) {
          yield* Console.error(err.message);
          const hint = RECOVERY_HINTS[err.code];
          if (hint !== undefined) {
            yield* Console.error(hint);
          }
        } else if (isCounselError(err)) {
          yield* Console.error(`[${err.code}] ${err.message}`);
        } else if (isResearchError(err)) {
          yield* Console.error(`[${err.code}] ${err.message}`);
        } else if (isBrainDomainError(err)) {
          yield* Console.error(err.message);
        }
      }
    }),
  ),
);

// @effect-diagnostics-next-line effect/strictEffectProvide:off
BunRuntime.runMain(program.pipe(Effect.provide(ServiceLayer)), { disableErrorReporting: true });
