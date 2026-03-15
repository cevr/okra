import { Duration, Effect, Layer, ServiceMap } from "effect";
import { ResearchError, ErrorCode } from "../errors.js";
import { resolveExecutable } from "../../shared/executable.js";
import { AgentResult } from "../types.js";
import type { Provider } from "../types.js";

const DEFAULT_AGENT_TIMEOUT = Duration.minutes(10);

export class AgentPlatformService extends ServiceMap.Service<
  AgentPlatformService,
  {
    readonly invoke: (
      provider: Provider,
      prompt: string,
      cwd: string,
    ) => Effect.Effect<AgentResult, ResearchError>;
    readonly ensureExecutable: (provider: Provider) => Effect.Effect<string, ResearchError>;
  }
>()("@cvr/okra/research/services/AgentPlatform/AgentPlatformService") {
  static layer: Layer.Layer<AgentPlatformService> = Layer.succeed(AgentPlatformService, {
    invoke: (provider, prompt, cwd) =>
      Effect.tryPromise({
        try: async () => {
          const start = Date.now();

          const args =
            provider === "claude"
              ? [
                  resolveExecutable("claude"),
                  "-p",
                  prompt,
                  "--dangerously-skip-permissions",
                  "--model",
                  "opus",
                  "--max-turns",
                  "20",
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

          // Strip env vars that prevent nested agent sessions
          const env = { ...process.env };
          delete env["CLAUDECODE"];
          delete env["CLAUDE_CODE_ENTRYPOINT"];

          const proc = Bun.spawn(args, {
            stdout: "pipe",
            stderr: "pipe",
            cwd,
            env,
          });

          const [output, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);

          const durationMs = Date.now() - start;
          return new AgentResult({ exitCode, output, stderr, durationMs });
        },
        catch: (e) =>
          new ResearchError({
            message: `${provider} invocation failed: ${e instanceof Error ? e.message : String(e)}`,
            code: ErrorCode.AGENT_FAILED,
          }),
      }).pipe(
        Effect.timeout(DEFAULT_AGENT_TIMEOUT),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(
            new ResearchError({
              message: `Agent timed out after ${Duration.toMillis(DEFAULT_AGENT_TIMEOUT)}ms`,
              code: ErrorCode.AGENT_TIMEOUT,
            }),
          ),
        ),
      ),

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
