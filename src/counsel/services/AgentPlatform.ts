import { Effect, Layer, Option, Context } from "effect";
import { CLAUDE_READ_ONLY_TOOLS, sanitizePath } from "../constants.js";
import { CounselError, ErrorCode } from "../errors.js";
import type { Invocation, Profile, Provider } from "../types.js";
import { HostService } from "./Host.js";

const modelReasoningEffort = (profile: Profile): string => {
  if (profile === "deep") return "xhigh";
  return "medium";
};

const claudeModel = (profile: Profile): string => {
  if (profile === "deep") return "fable";
  return "opus";
};

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

  if (inClaude) return Effect.succeed("claude");
  return Effect.succeed("codex");
};

export const oppositeProvider = (source: Provider): Provider => {
  if (source === "claude") return "codex";
  return "claude";
};

export const buildPromptInstruction = (promptFilePath: string): string =>
  `Read the file at ${sanitizePath(promptFilePath)} and follow the instructions within it.`;

const claudeEffort = (profile: Profile): string => {
  if (profile === "deep") return "max";
  return "medium";
};

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
    claudeModel(profile),
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
    "--model",
    "gpt-5.6-sol",
    "-c",
    "web_search=live",
    "-c",
    `model_reasoning_effort=${modelReasoningEffort(profile)}`,
    "--skip-git-repo-check",
    buildPromptInstruction(promptFilePath),
  ],
  cwd,
});

export class AgentPlatformService extends Context.Service<
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

      const resolveSource = (
        requested: Option.Option<Provider>,
      ): Effect.Effect<Provider, CounselError> =>
        Option.match(requested, {
          onNone: () => host.getEnv.pipe(Effect.flatMap(detectSourceFromEnv)),
          onSome: (provider) => Effect.succeed(provider),
        });

      const ensureExecutable = (provider: Provider) =>
        Effect.sync(() => Bun.which(commands[provider])).pipe(
          Effect.flatMap((command) => {
            if (command === null) {
              return Effect.fail(
                new CounselError({
                  message: `Target provider "${provider}" is not installed or not on PATH.`,
                  code: ErrorCode.TARGET_NOT_INSTALLED,
                  command: commands[provider],
                }),
              );
            }
            return Effect.succeed(command);
          }),
        );

      const buildInvocation = (
        provider: Provider,
        promptFilePath: string,
        profile: Profile,
        cwd: string,
      ) =>
        ensureExecutable(provider).pipe(
          Effect.map((command) => {
            if (provider === "claude") {
              return buildClaudeInvocation(command, promptFilePath, profile, cwd);
            }
            return buildCodexInvocation(command, promptFilePath, profile, cwd);
          }),
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
    impl: Partial<Context.Service.Shape<typeof AgentPlatformService>> = {},
  ): Layer.Layer<AgentPlatformService> =>
    Layer.succeed(AgentPlatformService, {
      resolveSource: (requested) =>
        Option.match(requested, {
          onNone: () => Effect.succeed<Provider>("claude"),
          onSome: (provider) => Effect.succeed(provider),
        }),
      resolveTarget: oppositeProvider,
      ensureExecutable: (provider) => Effect.succeed(provider),
      buildInvocation: (provider, promptFilePath, profile, cwd) => {
        if (provider === "claude") {
          return Effect.succeed(buildClaudeInvocation("claude", promptFilePath, profile, cwd));
        }
        return Effect.succeed(buildCodexInvocation("codex", promptFilePath, profile, cwd));
      },
      ...impl,
    });
}
