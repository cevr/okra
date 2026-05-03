import { Effect, Layer, Option, Context, Stream } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { ResearchError, ErrorCode } from "../errors.js";
import { resolveExecutable } from "../../shared/executable.js";
import { extractCodexMessage } from "../../shared/agent-output.js";
import { AgentResult } from "../types.js";
import type { Provider } from "../types.js";

const agentFailed = (e: unknown) =>
  new ResearchError({
    message: `Agent invocation failed: ${e instanceof Error ? e.message : String(e)}`,
    code: ErrorCode.AGENT_FAILED,
  });

/** Collect a ReadableStream into a string while teeing each chunk to a file. */
const collectAndTee = (
  fs: FileSystem,
  stream: ReadableStream<Uint8Array>,
  filePath: string | undefined,
): Effect.Effect<string, ResearchError> =>
  Effect.gen(function* () {
    const chunks: Array<Uint8Array> = [];

    if (filePath !== undefined) {
      const sink = fs.sink(filePath, { flag: "a" });
      const teedStream = Stream.fromReadableStream({
        evaluate: () => stream,
        onError: agentFailed,
      }).pipe(Stream.tap((chunk) => Effect.sync(() => chunks.push(chunk))));

      yield* Stream.run(teedStream, sink).pipe(
        Effect.mapError((e) =>
          e._tag === "@cvr/okra/research/ResearchError"
            ? e
            : new ResearchError({
                message: `Cannot write log sink: ${(e as PlatformError).message}`,
                code: ErrorCode.WRITE_FAILED,
              }),
        ),
      );
      return Buffer.concat(chunks).toString("utf-8");
    }

    return yield* Stream.fromReadableStream({
      evaluate: () => stream,
      onError: agentFailed,
    }).pipe(
      Stream.runForEach((chunk) => Effect.sync(() => chunks.push(chunk))),
      Effect.map(() => Buffer.concat(chunks).toString("utf-8")),
    );
  });

const buildArgs = (provider: Provider, bin: string, prompt: string, cwd: string): Array<string> =>
  provider === "claude"
    ? [
        bin,
        "-p",
        prompt,
        "--dangerously-skip-permissions",
        "--model",
        "opus",
        "--effort",
        "max",
        "--no-session-persistence",
        "--output-format",
        "text",
      ]
    : [
        bin,
        "exec",
        "-C",
        cwd,
        "--json",
        "--color",
        "never",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-c",
        "model_reasoning_effort=xhigh",
        "-c",
        "service_tier=fast",
        prompt,
      ];

const spawnAgent = Effect.fn("AgentPlatform.spawnAgent")(function* (
  provider: Provider,
  bin: string,
  prompt: string,
  cwd: string,
) {
  const args = buildArgs(provider, bin, prompt, cwd);

  // Strip env vars that prevent nested agent sessions
  const env = { ...process.env };
  delete env["CLAUDECODE"];
  delete env["CLAUDE_CODE_ENTRYPOINT"];

  return yield* Effect.try({
    try: () =>
      Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        cwd,
        env,
      }),
    catch: agentFailed,
  });
});

export class AgentPlatformService extends Context.Service<
  AgentPlatformService,
  {
    readonly invoke: (
      provider: Provider,
      prompt: string,
      cwd: string,
      daemonLog?: string,
    ) => Effect.Effect<AgentResult, ResearchError>;
    readonly ensureExecutable: (provider: Provider) => Effect.Effect<string, ResearchError>;
  }
>()("@cvr/okra/research/services/AgentPlatform/AgentPlatformService") {
  static layer: Layer.Layer<AgentPlatformService, never, FileSystem> = Layer.effect(
    AgentPlatformService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      // Resolve binaries upfront so per-invoke calls are sync
      const claudeBin = yield* resolveExecutable("claude");
      const codexBin = yield* resolveExecutable("codex");
      const binFor = (provider: Provider): string => (provider === "claude" ? claudeBin : codexBin);

      return {
        invoke: Effect.fn("AgentPlatform.invoke")(function* (
          provider: Provider,
          prompt: string,
          cwd: string,
          daemonLog?: string,
        ) {
          const start = Date.now();
          const proc = yield* spawnAgent(provider, binFor(provider), prompt, cwd);

          const [output, stderr, exitCode] = yield* Effect.all(
            [
              Effect.tryPromise({
                try: () => new Response(proc.stdout).text(),
                catch: agentFailed,
              }),
              collectAndTee(fs, proc.stderr, daemonLog),
              Effect.tryPromise({
                try: () => proc.exited,
                catch: agentFailed,
              }),
            ],
            { concurrency: "unbounded" },
          );

          const durationMs = Date.now() - start;
          // Codex --json emits JSONL events; extract the final agent message text
          const agentOutput =
            provider === "codex" ? Option.getOrElse(extractCodexMessage(output), () => "") : output;
          return new AgentResult({ exitCode, output: agentOutput, stderr, durationMs });
        }),

        ensureExecutable: Effect.fn("AgentPlatform.ensureExecutable")(function* (
          provider: Provider,
        ) {
          const bin = binFor(provider);
          const name = provider === "claude" ? "claude" : "codex";
          if (bin === name && Bun.which(name) === null) {
            return yield* new ResearchError({
              message: `${name} not found in PATH. Install it first.`,
              code: ErrorCode.AGENT_FAILED,
            });
          }
          return bin;
        }),
      };
    }),
  );
}
