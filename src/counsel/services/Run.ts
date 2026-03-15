import { DateTime, Effect, Layer, Option, ServiceMap } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { CounselError, ErrorCode } from "../errors.js";
import { AgentPlatformService } from "./AgentPlatform.js";
import { InvocationRunnerService } from "./InvocationRunner.js";
import type { DryRunPreview, Profile, Provider, RunManifest } from "../types.js";

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
  text !== undefined && text.trim().length > 0 ? Option.some(text) : Option.none();

const promptConflict = Effect.fail(
  new CounselError({
    message: "Provide exactly one prompt source: inline arg, --file, or stdin.",
    code: ErrorCode.PROMPT_CONFLICT,
  }),
);

export const generateSlug = (source: Provider, target: Provider, now: DateTime.Utc): string => {
  const parts = DateTime.toPartsUtc(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = [String(parts.year), pad(parts.month), pad(parts.day)].join("");
  const time = [pad(parts.hours), pad(parts.minutes), pad(parts.seconds)].join("");
  const suffix = crypto.randomUUID().slice(0, 6);
  return `${stamp}-${time}-${source}-to-${target}-${suffix}`;
};

export class RunService extends ServiceMap.Service<
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
            Effect.mapError(
              (error: PlatformError) =>
                new CounselError({
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

        return yield* new CounselError({
          message: "Missing prompt. Pass an inline prompt, --file, or pipe stdin.",
          code: ErrorCode.PROMPT_MISSING,
        });
      });

      const writeTextFile = Effect.fn("RunService.writeTextFile")(function* (
        filePath: string,
        content: string,
      ) {
        yield* fs.writeFileString(filePath, content).pipe(
          Effect.mapError(
            (error: PlatformError) =>
              new CounselError({
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
        const profile: Profile = input.deep ? "deep" : "standard";
        const now = yield* DateTime.now;
        const slug = generateSlug(source, target, now);
        const outputDir = path.resolve(input.cwd, input.outputDir, slug);
        const promptFilePath = path.join(outputDir, "prompt.md");
        const invocation = yield* platform.buildInvocation(
          target,
          promptFilePath,
          profile,
          input.cwd,
        );

        if (input.dryRun) {
          return {
            _tag: "DryRun" as const,
            preview: {
              source,
              target,
              profile,
              promptSource: promptInput.promptSource,
              outputDir,
              promptFilePath,
              invocation: {
                cmd: invocation.cmd,
                args: [...invocation.args],
                cwd: invocation.cwd,
              },
            },
          };
        }

        yield* fs.makeDirectory(outputDir, { recursive: true }).pipe(
          Effect.mapError(
            (error: PlatformError) =>
              new CounselError({
                message: `Failed to create ${outputDir}: ${error.message}`,
                code: ErrorCode.WRITE_FAILED,
              }),
          ),
        );

        yield* writeTextFile(promptFilePath, promptInput.content);

        const outputFile = path.join(outputDir, `${target}.md`);
        const stderrFile = path.join(outputDir, `${target}.stderr`);
        const executed = yield* invocationRunner.execute(invocation, outputFile, stderrFile);

        const manifest: RunManifest = {
          timestamp: DateTime.formatIso(now),
          slug,
          cwd: input.cwd,
          promptSource: promptInput.promptSource,
          source,
          target,
          profile,
          status: executed.timedOut ? "timeout" : executed.exitCode === 0 ? "success" : "error",
          exitCode: executed.exitCode,
          durationMs: executed.durationMs,
          promptFilePath,
          outputFile,
          stderrFile,
        };

        return { _tag: "Completed" as const, manifest };
      });

      return { run };
    }),
  );
}
