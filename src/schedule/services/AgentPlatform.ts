import { Effect, Layer, Context, Stream } from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { Stdio } from "effect/Stdio";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { ScheduleError } from "../errors.js";
import { resolveExecutable } from "../../shared/executable.js";
import type { Provider } from "./Store.js";

const claudeArgs = (claude: string, prompt: string): Array<string> => [
  claude,
  "-p",
  prompt,
  "--dangerously-skip-permissions",
  "--model",
  "sonnet",
  "--no-session-persistence",
];

const codexArgs = (codex: string, prompt: string, cwd: string): Array<string> => [
  codex,
  "exec",
  "-C",
  cwd,
  "--dangerously-bypass-approvals-and-sandbox",
  "--skip-git-repo-check",
  prompt,
];

export type InvokeResult = {
  readonly exitCode: number;
  readonly output: string;
};

class AgentPlatformService extends Context.Service<
  AgentPlatformService,
  {
    readonly invoke: (
      provider: Provider,
      prompt: string,
      cwd: string,
    ) => Effect.Effect<InvokeResult, ScheduleError>;
    readonly invokeCapture: (
      provider: Provider,
      prompt: string,
      cwd: string,
    ) => Effect.Effect<string, ScheduleError>;
  }
>()("@cvr/okra/schedule/services/AgentPlatform/AgentPlatformService") {
  static layer: Layer.Layer<AgentPlatformService, never, FileSystem | ChildProcessSpawner | Stdio> =
    Layer.effect(
      AgentPlatformService,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner;
        const stdio = yield* Stdio;
        const claudeBin = yield* resolveExecutable("claude");
        const codexBin = yield* resolveExecutable("codex");
        const buildArgs = (provider: Provider, prompt: string, cwd: string): Array<string> => {
          if (provider === "claude") return claudeArgs(claudeBin, prompt);
          return codexArgs(codexBin, prompt, cwd);
        };

        const invokeFailure = (provider: Provider, e: PlatformError, op: string) =>
          new ScheduleError({
            message: `${provider} ${op} failed: ${e.message}`,
            code: "SPAWN_FAILED",
          });

        const buildCommand = (
          provider: Provider,
          prompt: string,
          cwd: string,
          stderr: "inherit" | "pipe",
        ) => {
          const [bin, ...args] = buildArgs(provider, prompt, cwd);
          return ChildProcess.make(bin ?? "", args, { cwd, stdout: "pipe", stderr });
        };

        return {
          invoke: Effect.fn("schedule.AgentPlatform.invoke")(
            function* (provider: Provider, prompt: string, cwd: string) {
              const handle = yield* spawner.spawn(buildCommand(provider, prompt, cwd, "inherit"));

              // Mirror the agent's output to our stdout while capturing it.
              const output = yield* Stream.mkString(
                handle.stdout.pipe(
                  Stream.tapSink<Uint8Array, PlatformError, never>(
                    stdio.stdout({ endOnDone: false }),
                  ),
                  Stream.decodeText,
                ),
              );
              const exitCode = yield* handle.exitCode;

              return { exitCode, output };
            },
            Effect.scoped,
            (effect, provider) =>
              effect.pipe(
                Effect.catchTag("PlatformError", (e: PlatformError) =>
                  invokeFailure(provider, e, "invocation"),
                ),
              ),
          ),

          invokeCapture: Effect.fn("schedule.AgentPlatform.invokeCapture")(
            function* (provider: Provider, prompt: string, cwd: string) {
              const handle = yield* spawner.spawn(buildCommand(provider, prompt, cwd, "pipe"));
              const output = yield* Stream.mkString(Stream.decodeText(handle.stdout));
              yield* handle.exitCode;
              return output;
            },
            Effect.scoped,
            (effect, provider) =>
              effect.pipe(
                Effect.catchTag("PlatformError", (e: PlatformError) =>
                  invokeFailure(provider, e, "capture"),
                ),
              ),
          ),
        };
      }),
    );
}

export { AgentPlatformService };
