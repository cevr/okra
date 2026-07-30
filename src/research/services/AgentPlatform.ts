import { Clock, Effect, Layer, Option, Context, Stream } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { ResearchError, ErrorCode } from "../errors.js";
import { resolveExecutable } from "../../shared/executable.js";
import { extractCodexMessage } from "../../shared/agent-output.js";
import { AgentResult } from "../types.js";
import type { Provider } from "../types.js";

const agentFailed = (e: PlatformError) =>
  ResearchError.make({
    message: `Agent invocation failed: ${e.message}`,
    code: ErrorCode.AGENT_FAILED,
  });

/** Collect a byte stream into a string while teeing each chunk to a file. */
const collectAndTee = (
  fs: FileSystem,
  stream: Stream.Stream<Uint8Array, PlatformError>,
  filePath: string | undefined,
): Effect.Effect<string, ResearchError> =>
  Effect.gen(function* () {
    const chunks: Array<Uint8Array> = [];
    const collecting = stream.pipe(Stream.tap((chunk) => Effect.sync(() => chunks.push(chunk))));

    if (filePath !== undefined) {
      yield* Stream.run(collecting, fs.sink(filePath, { flag: "a" })).pipe(
        Effect.mapError((e: PlatformError) =>
          ResearchError.make({
            message: `Cannot write log sink: ${e.message}`,
            code: ErrorCode.WRITE_FAILED,
          }),
        ),
      );
      return Buffer.concat(chunks).toString("utf-8");
    }

    yield* Stream.runDrain(collecting).pipe(Effect.mapError(agentFailed));
    return Buffer.concat(chunks).toString("utf-8");
  });

/** `command -v` is the POSIX PATH lookup; a non-zero exit means the binary is absent. */
const isOnPath = (spawner: ChildProcessSpawner["Service"], name: string): Effect.Effect<boolean> =>
  spawner
    .exitCode(ChildProcess.make("command", ["-v", name], { stdout: "ignore", stderr: "ignore" }))
    .pipe(
      Effect.map((code) => code === 0),
      Effect.orElseSucceed(() => false),
    );

/** Codex emits JSONL events; its final agent message is the payload. Claude prints text directly. */
const extractAgentOutput = (provider: Provider, output: string): string => {
  if (provider === "codex") return Option.getOrElse(extractCodexMessage(output), () => "");
  return output;
};

const providerBinaryName = (provider: Provider): string => {
  if (provider === "claude") return "claude";
  return "codex";
};

const buildArgs = (provider: Provider, prompt: string, cwd: string): Array<string> => {
  if (provider === "claude") {
    return [
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
    ];
  }
  return [
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
};

const spawnAgent = Effect.fn("AgentPlatform.spawnAgent")(function* (
  spawner: ChildProcessSpawner["Service"],
  provider: Provider,
  bin: string,
  prompt: string,
  cwd: string,
) {
  const args = buildArgs(provider, prompt, cwd);

  // Strip env vars that prevent nested agent sessions.
  // Full process.env spread is required so the child inherits the user's environment;
  // Config only exposes individually-declared keys.
  // eslint-disable-next-line node/no-process-env
  const env = { ...process.env };
  delete env["CLAUDECODE"];
  delete env["CLAUDE_CODE_ENTRYPOINT"];

  return yield* spawner
    .spawn(
      ChildProcess.make(bin, args, {
        stdout: "pipe",
        stderr: "pipe",
        cwd,
        env,
      }),
    )
    .pipe(Effect.mapError(agentFailed));
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
  static layer: Layer.Layer<AgentPlatformService, never, FileSystem | ChildProcessSpawner> =
    Layer.effect(
      AgentPlatformService,
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const spawner = yield* ChildProcessSpawner;
        // Resolve binaries upfront so per-invoke calls are sync
        const claudeBin = yield* resolveExecutable("claude");
        const codexBin = yield* resolveExecutable("codex");
        const binFor = (provider: Provider): string => {
          if (provider === "claude") return claudeBin;
          return codexBin;
        };

        return {
          invoke: Effect.fn("AgentPlatform.invoke")(function* (
            provider: Provider,
            prompt: string,
            cwd: string,
            daemonLog?: string,
          ) {
            const start = yield* Clock.currentTimeMillis;
            const proc = yield* spawnAgent(spawner, provider, binFor(provider), prompt, cwd);

            const [output, stderr, exitCode] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(proc.stdout)).pipe(Effect.mapError(agentFailed)),
                collectAndTee(fs, proc.stderr, daemonLog),
                proc.exitCode.pipe(Effect.mapError(agentFailed)),
              ],
              { concurrency: "unbounded" },
            );

            const end = yield* Clock.currentTimeMillis;
            const durationMs = end - start;
            const agentOutput = extractAgentOutput(provider, output);
            return AgentResult.make({ exitCode, output: agentOutput, stderr, durationMs });
          }, Effect.scoped),

          ensureExecutable: Effect.fn("AgentPlatform.ensureExecutable")(function* (
            provider: Provider,
          ) {
            const bin = binFor(provider);
            const name = providerBinaryName(provider);
            // resolveExecutable falls back to the bare name when nothing was found on disk.
            if (bin === name && !(yield* isOnPath(spawner, name))) {
              return yield* ResearchError.make({
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
