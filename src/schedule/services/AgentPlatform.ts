import { Effect, Layer, Context } from "effect";
import type { FileSystem } from "effect/FileSystem";
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
  static layer: Layer.Layer<AgentPlatformService, never, FileSystem> = Layer.effect(
    AgentPlatformService,
    Effect.gen(function* () {
      const claudeBin = yield* resolveExecutable("claude");
      const codexBin = yield* resolveExecutable("codex");
      const buildArgs = (provider: Provider, prompt: string, cwd: string): Array<string> =>
        provider === "claude" ? claudeArgs(claudeBin, prompt) : codexArgs(codexBin, prompt, cwd);

      const invokeFailure = (provider: Provider, e: unknown, op: string) =>
        new ScheduleError({
          message: `${provider} ${op} failed: ${e instanceof Error ? e.message : String(e)}`,
          code: "SPAWN_FAILED",
        });

      return {
        invoke: Effect.fn("schedule.AgentPlatform.invoke")(function* (
          provider: Provider,
          prompt: string,
          cwd: string,
        ) {
          const args = buildArgs(provider, prompt, cwd);
          const proc = Bun.spawn(args, { stdout: "pipe", stderr: "inherit", cwd });
          const [tee1, tee2] = proc.stdout.tee();
          const outputPromise = new Response(tee1).text();
          const writePromise = tee2.pipeTo(
            new WritableStream({
              write(chunk) {
                process.stdout.write(chunk);
              },
            }),
          );
          const [exitCode, output] = yield* Effect.tryPromise({
            try: () => Promise.all([proc.exited, outputPromise]),
            catch: (e) => invokeFailure(provider, e, "invocation"),
          });
          yield* Effect.tryPromise({
            try: () => writePromise,
            catch: (e) => invokeFailure(provider, e, "invocation"),
          });
          return { exitCode, output };
        }),

        invokeCapture: Effect.fn("schedule.AgentPlatform.invokeCapture")(function* (
          provider: Provider,
          prompt: string,
          cwd: string,
        ) {
          const args = buildArgs(provider, prompt, cwd);
          const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", cwd });
          const output = yield* Effect.tryPromise({
            try: () => new Response(proc.stdout).text(),
            catch: (e) => invokeFailure(provider, e, "capture"),
          });
          yield* Effect.tryPromise({
            try: () => proc.exited,
            catch: (e) => invokeFailure(provider, e, "capture"),
          });
          return output;
        }),
      };
    }),
  );
}

export { AgentPlatformService };
