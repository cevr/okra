import { Effect, Layer, ServiceMap } from "effect";
import { ScheduleError } from "../errors.js";
import { resolveExecutable } from "../../shared/executable.js";
import type { Provider } from "./Store.js";

const claudeArgs = (prompt: string): Array<string> => [
  resolveExecutable("claude"),
  "-p",
  prompt,
  "--dangerously-skip-permissions",
  "--model",
  "sonnet",
  "--no-session-persistence",
];

const codexArgs = (prompt: string, cwd: string): Array<string> => [
  resolveExecutable("codex"),
  "exec",
  "-C",
  cwd,
  "--dangerously-bypass-approvals-and-sandbox",
  "--skip-git-repo-check",
  prompt,
];

const providerArgs: Record<Provider, (prompt: string, cwd: string) => Array<string>> = {
  claude: (prompt) => claudeArgs(prompt),
  codex: (prompt, cwd) => codexArgs(prompt, cwd),
};

export type InvokeResult = {
  readonly exitCode: number;
  readonly output: string;
};

class AgentPlatformService extends ServiceMap.Service<
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
  static layer = Layer.succeed(AgentPlatformService, {
    invoke: (provider, prompt, cwd) =>
      Effect.tryPromise({
        try: async () => {
          const args = providerArgs[provider](prompt, cwd);
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
          const [exitCode, output] = await Promise.all([proc.exited, outputPromise]);
          await writePromise;
          return { exitCode, output };
        },
        catch: (e) =>
          new ScheduleError({
            message: `${provider} invocation failed: ${e instanceof Error ? e.message : String(e)}`,
            code: "SPAWN_FAILED",
          }),
      }),

    invokeCapture: (provider, prompt, cwd) =>
      Effect.tryPromise({
        try: async () => {
          const args = providerArgs[provider](prompt, cwd);
          const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", cwd });
          const output = await new Response(proc.stdout).text();
          await proc.exited;
          return output;
        },
        catch: (e) =>
          new ScheduleError({
            message: `${provider} capture failed: ${e instanceof Error ? e.message : String(e)}`,
            code: "SPAWN_FAILED",
          }),
      }),
  });
}

export { AgentPlatformService };
