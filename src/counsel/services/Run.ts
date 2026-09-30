import { DateTime, Effect, Layer, Option, Random, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { cwdBucket } from "../constants.js";
import { CounselError, ErrorCode } from "../errors.js";
import { AgentPlatformService } from "./AgentPlatform.js";
import { InvocationRunnerService } from "./InvocationRunner.js";
import {
  type DryRunPreview,
  encodeRunManifest,
  type Profile,
  type Provider,
  type RunManifest,
  type RunStatus,
} from "../types.js";
import {
  type AgentOutcome,
  readClaudeModel,
  readClaudeOutcome,
  readCodexOutcome,
} from "../../shared/agent-output.js";

export type RunInput = {
  readonly cwd: string;
  readonly prompt: Option.Option<string>;
  readonly file: Option.Option<string>;
  readonly stdinText?: string | undefined;
  readonly from: Option.Option<Provider>;
  readonly deep: boolean;
  readonly outputDir: string;
  readonly dryRun: boolean;
};

export type RunResult =
  | { readonly _tag: "DryRun"; readonly preview: DryRunPreview }
  | { readonly _tag: "Completed"; readonly manifest: RunManifest };

const trimToOption = (text: string | undefined): Option.Option<string> =>
  Option.fromUndefinedOr(text).pipe(Option.filter((value) => value.trim().length > 0));

const profileForDeep = (deep: boolean): Profile => {
  if (deep) return "deep";
  return "standard";
};

const outcomeReaderFor = (target: Provider): ((jsonl: string) => AgentOutcome) => {
  if (target === "codex") return readCodexOutcome;
  return readClaudeOutcome;
};

interface Executed {
  readonly timedOut: boolean;
  readonly exitCode: number;
}

const runStatus = (executed: Executed, outcome: AgentOutcome): RunStatus => {
  if (executed.timedOut) return "timeout";
  if (executed.exitCode !== 0) return "error";
  if (outcome._tag !== "Answered") return "error";
  return "success";
};

/** Why a run did not answer, for the manifest and stderr; `None` for a successful run. */
const runFailure = (
  target: Provider,
  executed: Executed,
  outcome: AgentOutcome,
): Option.Option<string> => {
  if (executed.timedOut) return Option.some(`${target} timed out`);
  if (outcome._tag === "Failed") return Option.some(outcome.message);
  if (outcome._tag === "Silent") return Option.some(`${target} ended without an answer`);
  if (executed.exitCode !== 0)
    return Option.some(`${target} exited with code ${executed.exitCode}`);
  return Option.none();
};

const promptConflict = Effect.fail(
  CounselError.make({
    message: "Provide exactly one prompt source: inline arg, --file, or stdin.",
    code: ErrorCode.PROMPT_CONFLICT,
  }),
);

export const generateSlug = (
  source: Provider,
  target: Provider,
  now: DateTime.Utc,
  suffix: string,
): string => {
  const parts = DateTime.toPartsUtc(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = [String(parts.year), pad(parts.month), pad(parts.day)].join("");
  const time = [pad(parts.hour), pad(parts.minute), pad(parts.second)].join("");
  return `${stamp}-${time}-${source}-to-${target}-${suffix}`;
};

/** Generate a 6-char hex random suffix using the Effect Random module. */
export const randomSlugSuffix = Effect.map(Random.next, (n) =>
  n.toString(16).slice(2, 8).padEnd(6, "0"),
);

export class RunService extends Context.Service<
  RunService,
  {
    readonly run: (input: RunInput) => Effect.Effect<RunResult, CounselError>;
  }
>()("@cvr/okra/counsel/services/Run/RunService") {
  static layer: Layer.Layer<
    RunService,
    never,
    AgentPlatformService | InvocationRunnerService | FileSystem | Path
  > = Layer.effect(
    RunService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const platform = yield* AgentPlatformService;
      const invocationRunner = yield* InvocationRunnerService;

      const resolvePromptInput = Effect.fn("RunService.resolvePromptInput")(function* (
        cwd: string,
        prompt: Option.Option<string>,
        file: Option.Option<string>,
        stdinText?: string,
      ) {
        const stdin = trimToOption(stdinText);
        const sources = [Option.isSome(prompt), Option.isSome(file), Option.isSome(stdin)].filter(
          Boolean,
        );

        if (sources.length > 1) {
          return yield* promptConflict;
        }

        if (Option.isSome(prompt)) {
          return { content: prompt.value, promptSource: "inline" as const };
        }

        if (Option.isSome(file)) {
          const filePath = path.resolve(cwd, file.value);
          const content = yield* fs.readFileString(filePath).pipe(
            Effect.mapError((error: PlatformError) =>
              CounselError.make({
                message: `Failed to read prompt file ${filePath}: ${error.message}`,
                code: ErrorCode.FILE_READ_FAILED,
              }),
            ),
          );
          return { content, promptSource: "file" as const };
        }

        if (Option.isSome(stdin)) {
          return { content: stdin.value, promptSource: "stdin" as const };
        }

        return yield* CounselError.make({
          message: "Missing prompt. Pass an inline prompt, --file, or pipe stdin.",
          code: ErrorCode.PROMPT_MISSING,
        });
      });

      const writeTextFile = Effect.fn("RunService.writeTextFile")(function* (
        filePath: string,
        content: string,
      ) {
        yield* fs.writeFileString(filePath, content).pipe(
          Effect.mapError((error: PlatformError) =>
            CounselError.make({
              message: `Failed to write ${filePath}: ${error.message}`,
              code: ErrorCode.WRITE_FAILED,
            }),
          ),
        );
      });

      const run = Effect.fn("RunService.run")(function* (input: RunInput) {
        const promptInput = yield* resolvePromptInput(
          input.cwd,
          input.prompt,
          input.file,
          input.stdinText,
        );

        const source = yield* platform.resolveSource(input.from);
        const target = platform.resolveTarget(source);
        const profile: Profile = profileForDeep(input.deep);
        const now = yield* DateTime.now;
        const suffix = yield* randomSlugSuffix;
        const slug = generateSlug(source, target, now, suffix);
        const outputBucket = cwdBucket(input.cwd);
        const outputDir = path.resolve(input.cwd, input.outputDir, outputBucket, slug);
        const promptFilePath = path.join(outputDir, "prompt.md");
        const invocations = yield* platform.buildInvocations(
          target,
          promptFilePath,
          profile,
          input.cwd,
        );

        const invocation = invocations[0];

        if (input.dryRun) {
          return {
            _tag: "DryRun" as const,
            preview: {
              source,
              target,
              profile,
              promptSource: promptInput.promptSource,
              outputBucket,
              outputDir,
              promptFilePath,
              invocation: {
                cmd: invocation.cmd,
                args: [...invocation.args],
                cwd: invocation.cwd,
                model: invocation.model,
              },
            },
          };
        }

        yield* fs.makeDirectory(outputDir, { recursive: true }).pipe(
          Effect.mapError((error: PlatformError) =>
            CounselError.make({
              message: `Failed to create ${outputDir}: ${error.message}`,
              code: ErrorCode.WRITE_FAILED,
            }),
          ),
        );

        yield* writeTextFile(promptFilePath, promptInput.content);

        // Both providers emit JSONL (codex --json, claude --output-format stream-json)
        const eventsFile = path.join(outputDir, "events.jsonl");
        const stderrFile = path.join(outputDir, `${target}.stderr`);
        const readEvents = fs.readFileString(eventsFile).pipe(
          Effect.mapError((error: PlatformError) =>
            CounselError.make({
              message: `Failed to read events: ${error.message}`,
              code: ErrorCode.READ_FAILED,
            }),
          ),
        );

        // Each attempt overwrites the event and stderr logs, so they describe the last attempt.
        const readOutcome = outcomeReaderFor(target);
        let attempted = invocation;
        let executed = yield* invocationRunner.execute(invocation, eventsFile, stderrFile);
        let jsonl = yield* readEvents;
        let outcome = readOutcome(jsonl);
        for (const fallback of invocations.slice(1)) {
          const rejected =
            outcome._tag === "Failed" && platform.isModelRejected(target, outcome.message);
          if (!rejected) break;
          attempted = fallback;
          executed = yield* invocationRunner.execute(fallback, eventsFile, stderrFile);
          jsonl = yield* readEvents;
          outcome = readOutcome(jsonl);
        }
        const reportedModel = Option.filter(readClaudeModel(jsonl), () => target === "claude");

        // The .md holds only a real answer; a failure goes to the manifest and stderr instead.
        const outputFile = path.join(outputDir, `${target}.md`);
        let answer = "";
        if (outcome._tag === "Answered") answer = outcome.text;
        yield* writeTextFile(outputFile, answer);

        const manifest: RunManifest = {
          timestamp: DateTime.formatIso(now),
          slug,
          cwd: input.cwd,
          outputBucket,
          promptSource: promptInput.promptSource,
          source,
          target,
          profile,
          status: runStatus(executed, outcome),
          model: Option.getOrElse(reportedModel, () => attempted.model),
          failure: Option.getOrUndefined(runFailure(target, executed, outcome)),
          exitCode: executed.exitCode,
          durationMs: executed.durationMs,
          promptFilePath,
          outputFile,
          stderrFile,
          eventsFile,
        };

        // The record of the run (status, model, failure) sits next to its artifacts.
        const manifestText = yield* encodeRunManifest(manifest).pipe(
          Effect.mapError(() =>
            CounselError.make({
              message: "Failed to serialize the run manifest",
              code: ErrorCode.WRITE_FAILED,
            }),
          ),
        );
        yield* writeTextFile(path.join(outputDir, "manifest.json"), `${manifestText}\n`);

        return { _tag: "Completed" as const, manifest };
      });

      return { run };
    }),
  );
}
