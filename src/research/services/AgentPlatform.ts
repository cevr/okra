// @effect-diagnostics effect/nodeBuiltinImport:off
import { createWriteStream } from "node:fs";
import { Effect, Layer, ServiceMap, Stream } from "effect";
import { ResearchError, ErrorCode } from "../errors.js";
import { resolveExecutable } from "../../shared/executable.js";
import { AgentResult } from "../types.js";
import type { Provider } from "../types.js";

const agentFailed = (e: unknown) =>
  new ResearchError({
    message: `Agent invocation failed: ${e instanceof Error ? e.message : String(e)}`,
    code: ErrorCode.AGENT_FAILED,
  });

/** Collect a ReadableStream into a string while teeing each chunk to a file. */
const collectAndTee = (
  stream: ReadableStream<Uint8Array>,
  filePath: string | undefined,
): Effect.Effect<string, ResearchError> => {
  const chunks: Array<Uint8Array> = [];
  const sink = filePath !== undefined ? createWriteStream(filePath, { flags: "a" }) : undefined;

  return Stream.fromReadableStream({
    evaluate: () => stream,
    onError: agentFailed,
  }).pipe(
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        chunks.push(chunk);
        sink?.write(chunk);
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        sink?.end();
      }),
    ),
    Effect.map(() => Buffer.concat(chunks).toString("utf-8")),
  );
};

const buildArgs = (provider: Provider, prompt: string, cwd: string): Array<string> =>
  provider === "claude"
    ? [
        resolveExecutable("claude"),
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
        resolveExecutable("codex"),
        "exec",
        "-C",
        cwd,
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-c",
        "model_reasoning_effort=xhigh",
        prompt,
      ];

const spawnAgent = Effect.fn("AgentPlatform.spawnAgent")(function* (
  provider: Provider,
  prompt: string,
  cwd: string,
) {
  const args = buildArgs(provider, prompt, cwd);

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

export class AgentPlatformService extends ServiceMap.Service<
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
  static layer: Layer.Layer<AgentPlatformService> = Layer.succeed(AgentPlatformService, {
    invoke: Effect.fn("AgentPlatform.invoke")(function* (
      provider: Provider,
      prompt: string,
      cwd: string,
      daemonLog?: string,
    ) {
      const start = Date.now();
      const proc = yield* spawnAgent(provider, prompt, cwd);

      const [output, stderr, exitCode] = yield* Effect.all(
        [
          Effect.tryPromise({
            try: () => new Response(proc.stdout).text(),
            catch: agentFailed,
          }),
          collectAndTee(proc.stderr, daemonLog),
          Effect.tryPromise({
            try: () => proc.exited,
            catch: agentFailed,
          }),
        ],
        { concurrency: "unbounded" },
      );

      const durationMs = Date.now() - start;
      return new AgentResult({ exitCode, output, stderr, durationMs });
    }),

    ensureExecutable: (provider) =>
      Effect.gen(function* () {
        const name = provider === "claude" ? "claude" : "codex";
        const resolved = resolveExecutable(name);
        if (resolved === name && Bun.which(name) === null) {
          return yield* new ResearchError({
            message: `${name} not found in PATH. Install it first.`,
            code: ErrorCode.AGENT_FAILED,
          });
        }
        return resolved;
      }),
  });
}
