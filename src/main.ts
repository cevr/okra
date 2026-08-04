#!/usr/bin/env bun
import { Console, Effect, Layer, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { FetchHttpClient } from "effect/unstable/http";
import { scheduleCommand } from "./schedule/index.js";
import { ScheduleError } from "./schedule/errors.js";
import { counselCommand } from "./counsel/index.js";
import { isCounselError } from "./counsel/errors.js";
import { repoCommand } from "./repo/index.js";
import { isRepoError } from "./repo/errors.js";
import { skillsCommand } from "./skills/index.js";
import { isSkillsError } from "./skills/errors.js";
import { imageCommand } from "./image/index.js";
import { isImageError } from "./image/errors.js";
import { keysCommand, isKeysError } from "./keys/index.js";
import { howCommand, isHowError } from "./how/index.js";

// __VERSION__ is injected by scripts/build.ts; it is absent under `bun run dev`.
const resolveVersion = (): string => {
  if (typeof __VERSION__ === "undefined") return "0.0.0-dev";
  return __VERSION__;
};

const VERSION = resolveVersion();

const isScheduleError = Schema.is(ScheduleError);

const RECOVERY_HINTS: Record<string, string> = {
  NOT_FOUND: "Run 'okra schedule list' to see available tasks.",
  INVALID_SCHEDULE: "See 'okra schedule --help' for schedule formats.",
};

const root = Command.make("okra", {}, () => Effect.void).pipe(
  Command.withDescription("AI agent orchestration toolkit"),
  Command.withSubcommands([
    scheduleCommand,
    counselCommand,
    repoCommand,
    skillsCommand,
    imageCommand,
    keysCommand,
    howCommand,
  ]),
);

const cli = Command.run(root, { version: VERSION });

const PlatformLayer = Layer.mergeAll(BunServices.layer, FetchHttpClient.layer);

const program = cli.pipe(
  Effect.tapDefect((defect) => Console.error(`Internal error: ${String(defect)}`)),
  Effect.tapCause((cause) =>
    Effect.gen(function* () {
      for (const reason of cause.reasons) {
        if (reason._tag !== "Fail") continue;
        const err = reason.error;
        if (isScheduleError(err)) {
          yield* Console.error(`[${err.code}] ${err.message}`);
          const hint = RECOVERY_HINTS[err.code];
          if (hint !== undefined) {
            yield* Console.error(hint);
          }
        } else if (isCounselError(err)) {
          yield* Console.error(`[${err.code}] ${err.message}`);
        } else if (isRepoError(err)) {
          yield* Console.error(`[${err.code}] ${err.message}`);
        } else if (isSkillsError(err)) {
          yield* Console.error(`[${err.code}] ${err.message}`);
        } else if (isImageError(err)) {
          yield* Console.error(`[${err.code}] ${err.message}`);
        } else if (isKeysError(err)) {
          yield* Console.error(`[${err.code}] ${err.message}`);
        } else if (isHowError(err)) {
          yield* Console.error(`[${err.code}] ${err.message}`);
        }
      }
    }),
  ),
);

BunRuntime.runMain(program.pipe(Effect.provide(PlatformLayer)), { disableErrorReporting: true });
