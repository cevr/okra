import { Effect, Layer, Option, ServiceMap } from "effect";
import { CLAUDE_READ_ONLY_TOOLS, sanitizePath } from "../constants.js";
import { CounselError, ErrorCode } from "../errors.js";
import type { Invocation, Profile, Provider } from "../types.js";
import { HostService } from "./Host.js";

const modelReasoningEffort = (profile: Profile): string =>
  profile === "deep" ? "xhigh" : "medium";

export const detectSourceFromEnv = (
  env: Record<string, string | undefined>,
): Effect.Effect<Provider, CounselError> => {
  const inClaude = env["CLAUDECODE"] !== undefined || env["CLAUDE_CODE_ENTRYPOINT"] !== undefined;
  const inCodex = env["CODEX_THREAD_ID"] !== undefined || env["CODEX_CI"] !== undefined;

  if (inClaude === inCodex) {
    return Effect.fail(
      new CounselError({
        message: "Cannot infer the current agent. Pass --from claude or --from codex.",
        code: ErrorCode.AMBIGUOUS_PROVIDER,
      }),
    );
  }

  return Effect.succeed(inClaude ? "claude" : "codex");
};

export const oppositeProvider = (source: Provider): Provider =>
  source === "claude" ? "codex" : "claude";

export const buildPromptInstruction = (promptFilePath: string): string =>
  `Read the file at ${sanitizePath(promptFilePath)} and follow the instructions within it.`;

const claudeEffort = (profile: Profile): string => (profile === "deep" ? "max" : "medium");

export const buildClaudeInvocation = (
  command: string,
  promptFilePath: string,
  profile: Profile,
  cwd: string,
): Invocation => ({
  cmd: command,
  args: [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "opus",
    "--effort",
    claudeEffort(profile),
    "--tools",
    CLAUDE_READ_ONLY_TOOLS,
    "--allowedTools",
    CLAUDE_READ_ONLY_TOOLS,
    "--strict-mcp-config",
    "--no-session-persistence",
    buildPromptInstruction(promptFilePath),
  ],
  cwd,
});

export const buildCodexInvocation = (
  command: string,
  promptFilePath: string,
  profile: Profile,
  cwd: string,
): Invocation => ({
  cmd: command,
  args: [
    "exec",
    "-C",
    cwd,
    "--json",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "-c",
    "web_search=live",
    "-c",
    `model_reasoning_effort=${modelReasoningEffort(profile)}`,
    "--skip-git-repo-check",
    buildPromptInstruction(promptFilePath),
  ],
  cwd,
});

export class AgentPlatformService extends ServiceMap.Service<
  AgentPlatformService,
  {
    readonly resolveSource: (
      requested: Option.Option<Provider>,
    ) => Effect.Effect<Provider, CounselError>;
    readonly resolveTarget: (source: Provider) => Provider;
    readonly ensureExecutable: (provider: Provider) => Effect.Effect<string, CounselError>;
    readonly buildInvocation: (
      provider: Provider,
      promptFilePath: string,
      profile: Profile,
      cwd: string,
    ) => Effect.Effect<Invocation, CounselError>;
  }
>()("@cvr/okra/counsel/services/AgentPlatform/AgentPlatformService") {
  static layer: Layer.Layer<AgentPlatformService, never, HostService> = Layer.effect(
    AgentPlatformService,
    Effect.gen(function* () {
      const host = yield* HostService;
      const commands: Record<Provider, string> = {
        claude: "claude",
        codex: "codex",
      };

      const resolveSource = (requested: Option.Option<Provider>) =>
        Option.isSome(requested)
          ? Effect.succeed(requested.value)
          : host.getEnv().pipe(Effect.flatMap(detectSourceFromEnv));

      const ensureExecutable = (provider: Provider) =>
        Effect.sync(() => Bun.which(commands[provider])).pipe(
          Effect.flatMap((command) =>
            command === null
              ? Effect.fail(
                  new CounselError({
                    message: `Target provider "${provider}" is not installed or not on PATH.`,
                    code: ErrorCode.TARGET_NOT_INSTALLED,
                    command: commands[provider],
                  }),
                )
              : Effect.succeed(command),
          ),
        );

      const buildInvocation = (
        provider: Provider,
        promptFilePath: string,
        profile: Profile,
        cwd: string,
      ) =>
        ensureExecutable(provider).pipe(
          Effect.map((command) =>
            provider === "claude"
              ? buildClaudeInvocation(command, promptFilePath, profile, cwd)
              : buildCodexInvocation(command, promptFilePath, profile, cwd),
          ),
        );

      return {
        resolveSource,
        resolveTarget: oppositeProvider,
        ensureExecutable,
        buildInvocation,
      };
    }),
  );

  static layerTest = (
    impl: Partial<ServiceMap.Service.Shape<typeof AgentPlatformService>> = {},
  ): Layer.Layer<AgentPlatformService> =>
    Layer.succeed(AgentPlatformService, {
      resolveSource: (requested) =>
        Option.isSome(requested) ? Effect.succeed(requested.value) : Effect.succeed("claude"),
      resolveTarget: oppositeProvider,
      ensureExecutable: (provider) => Effect.succeed(provider),
      buildInvocation: (provider, promptFilePath, profile, cwd) =>
        provider === "claude"
          ? Effect.succeed(buildClaudeInvocation("claude", promptFilePath, profile, cwd))
          : Effect.succeed(buildCodexInvocation("codex", promptFilePath, profile, cwd)),
      ...impl,
    });
}
