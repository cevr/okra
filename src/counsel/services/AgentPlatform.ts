import { Array as Arr, Effect, Layer, Option, Context } from "effect";
import {
  CODEX_FALLBACK_MODEL,
  CodexModelsService,
  isCodexModelRejection,
  resolveCodexSolCandidates,
} from "../../shared/codex-models.js";
import { ModelCatalogService } from "../../shared/model-catalog.js";
import { CLAUDE_READ_ONLY_TOOLS, sanitizePath } from "../constants.js";
import { CounselError, ErrorCode } from "../errors.js";
import type { Invocation, Profile, Provider } from "../types.js";
import { HostService } from "./Host.js";

const codexReasoningEffort = (profile: Profile): string => {
  if (profile === "deep") return "max";
  return "medium";
};

const claudeModel = (profile: Profile): string => {
  if (profile === "deep") return "fable";
  // Alias, not a pin: tracks the latest Opus the installed CLI offers.
  return "opus";
};

export const detectSourceFromEnv = (
  env: Record<string, string | undefined>,
): Effect.Effect<Provider, CounselError> => {
  const inClaude = env["CLAUDECODE"] !== undefined || env["CLAUDE_CODE_ENTRYPOINT"] !== undefined;
  const inCodex = env["CODEX_THREAD_ID"] !== undefined || env["CODEX_CI"] !== undefined;

  if (inClaude === inCodex) {
    return Effect.fail(
      CounselError.make({
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
  model: string,
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
    model,
    "-c",
    "web_search=live",
    "-c",
    `model_reasoning_effort=${codexReasoningEffort(profile)}`,
    "--skip-git-repo-check",
    buildPromptInstruction(promptFilePath),
  ],
  cwd,
});

/** Only codex rejects a model per account; the claude CLI resolves its own aliases. */
export const isModelRejected = (provider: Provider, events: string): boolean =>
  provider === "codex" && isCodexModelRejection(events);

export class AgentPlatformService extends Context.Service<
  AgentPlatformService,
  {
    readonly resolveSource: (
      requested: Option.Option<Provider>,
    ) => Effect.Effect<Provider, CounselError>;
    readonly resolveTarget: (source: Provider) => Provider;
    readonly ensureExecutable: (provider: Provider) => Effect.Effect<string, CounselError>;
    /**
     * Invocations to try in order. Codex gets one per model candidate, because its model list
     * can name a model the backend still rejects; see `isModelRejected`.
     */
    readonly buildInvocations: (
      provider: Provider,
      promptFilePath: string,
      profile: Profile,
      cwd: string,
    ) => Effect.Effect<readonly [Invocation, ...Array<Invocation>], CounselError>;
    /** True when a failed run's events show the provider refused the model itself. */
    readonly isModelRejected: (provider: Provider, events: string) => boolean;
  }
>()("@cvr/okra/counsel/services/AgentPlatform/AgentPlatformService") {
  static layer: Layer.Layer<
    AgentPlatformService,
    never,
    HostService | CodexModelsService | ModelCatalogService
  > = Layer.effect(
    AgentPlatformService,
    Effect.gen(function* () {
      const host = yield* HostService;
      const resolveCodexModels = resolveCodexSolCandidates.pipe(
        Effect.provideService(CodexModelsService, yield* CodexModelsService),
        Effect.provideService(ModelCatalogService, yield* ModelCatalogService),
      );
      const commands: Record<Provider, string> = {
        claude: "claude",
        codex: "codex",
      };

      const resolveSource = (
        requested: Option.Option<Provider>,
      ): Effect.Effect<Provider, CounselError> =>
        Option.match(requested, {
          onNone: () => host.getAgentMarkers.pipe(Effect.flatMap(detectSourceFromEnv)),
          onSome: (provider) => Effect.succeed(provider),
        });

      const ensureExecutable = (provider: Provider) =>
        Effect.sync(() => Bun.which(commands[provider])).pipe(
          Effect.filterOrFail(
            (command): command is string => command !== null,
            () =>
              CounselError.make({
                message: `Target provider "${provider}" is not installed or not on PATH.`,
                code: ErrorCode.TARGET_NOT_INSTALLED,
                command: commands[provider],
              }),
          ),
        );

      const buildInvocations = (
        provider: Provider,
        promptFilePath: string,
        profile: Profile,
        cwd: string,
      ) =>
        Effect.gen(function* () {
          const command = yield* ensureExecutable(provider);
          if (provider === "claude") {
            return [buildClaudeInvocation(command, promptFilePath, profile, cwd)] as const;
          }
          const models = yield* resolveCodexModels;
          return Arr.map(models, (model) =>
            buildCodexInvocation(command, promptFilePath, profile, cwd, model),
          );
        });

      return {
        resolveSource,
        resolveTarget: oppositeProvider,
        ensureExecutable,
        buildInvocations,
        isModelRejected,
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
      buildInvocations: (provider, promptFilePath, profile, cwd) => {
        if (provider === "claude") {
          return Effect.succeed([
            buildClaudeInvocation("claude", promptFilePath, profile, cwd),
          ] as const);
        }
        return Effect.succeed([
          buildCodexInvocation("codex", promptFilePath, profile, cwd, CODEX_FALLBACK_MODEL),
        ] as const);
      },
      isModelRejected,
      ...impl,
    });
}
