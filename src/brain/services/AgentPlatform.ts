import { Effect, Layer, Option, ServiceMap } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { ConfigService } from "./Config.js";
import { BrainError } from "../errors/index.js";
import type { Provider } from "../../shared/provider.js";

export type AgentTaskProfile = "standard" | "deep";

export const isAgentProviderId = (value: string): value is Provider =>
  value === "claude" || value === "codex";

export interface AgentProviderIntegration {
  readonly homeDir: string;
  readonly settingsPath: string;
  readonly skillsDir: string;
  readonly supportsHooks: boolean;
}

export interface AgentProvider {
  readonly id: Provider;
  readonly integration: AgentProviderIntegration;
  readonly reflectRoot: string;
  readonly extractRoot: string;
  readonly detectSource: () => Effect.Effect<boolean, BrainError>;
  readonly isExecutable: () => Effect.Effect<boolean, BrainError>;
  readonly invoke: (
    prompt: string,
    profile: AgentTaskProfile,
    cwd?: string,
  ) => Effect.Effect<void, BrainError>;
}

export const allProviderIds = ["claude", "codex"] as const;

const whichExists = (cmd: string): Effect.Effect<boolean, never> =>
  Effect.sync(() => Bun.which(cmd) !== null);

export class AgentPlatformService extends ServiceMap.Service<
  AgentPlatformService,
  {
    readonly getProvider: (id: Provider) => Effect.Effect<AgentProvider, BrainError>;
    readonly listDetectedSourceProviders: () => Effect.Effect<ReadonlyArray<Provider>, BrainError>;
    readonly listExecutableProviders: () => Effect.Effect<ReadonlyArray<Provider>, BrainError>;
    readonly resolveInteractiveProvider: (
      requested?: Option.Option<Provider>,
    ) => Effect.Effect<Provider, BrainError>;
    readonly resolveDaemonExecutor: (
      requested?: Option.Option<Provider>,
    ) => Effect.Effect<Provider, BrainError>;
  }
>()("@cvr/okra/brain/services/AgentPlatform/AgentPlatformService") {
  static layer: Layer.Layer<AgentPlatformService, BrainError, ConfigService | FileSystem | Path> =
    Layer.effect(
      AgentPlatformService,
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const fs = yield* FileSystem;
        const path = yield* Path;

        const home = process.env["HOME"] ?? process.env["USERPROFILE"];
        if (home === undefined) {
          return yield* new BrainError({
            message: "HOME environment variable is not set",
            code: "NO_HOME",
          });
        }

        const providers: Record<Provider, AgentProvider> = {
          claude: {
            id: "claude",
            integration: {
              homeDir: path.join(home, ".claude"),
              settingsPath: path.join(home, ".claude", "settings.json"),
              skillsDir: path.join(home, ".claude", "skills"),
              supportsHooks: true,
            },
            reflectRoot: path.join(home, ".claude", "projects"),
            extractRoot: path.join(home, ".claude", "projects"),
            detectSource: () =>
              fs.exists(path.join(home, ".claude")).pipe(Effect.catch(() => Effect.succeed(false))),
            isExecutable: () =>
              Effect.all([
                fs
                  .exists(path.join(home, ".claude"))
                  .pipe(Effect.catch(() => Effect.succeed(false))),
                whichExists("claude"),
              ]).pipe(Effect.map(([exists, which]) => exists && which)),
            invoke: (prompt, profile) =>
              Effect.tryPromise({
                try: async () => {
                  const effort = profile === "deep" ? "max" : "medium";
                  const proc = Bun.spawn(
                    [
                      "claude",
                      "-p",
                      prompt,
                      "--dangerously-skip-permissions",
                      "--model",
                      "opus",
                      "--effort",
                      effort,
                      "--no-session-persistence",
                    ],
                    { stdout: "ignore", stderr: "inherit" },
                  );
                  const code = await proc.exited;
                  if (code !== 0) throw new Error(`claude exited with code ${code}`);
                },
                catch: (e) =>
                  new BrainError({
                    message: `Claude invocation failed: ${e instanceof Error ? e.message : String(e)}`,
                    code: "SPAWN_FAILED",
                  }),
              }),
          },
          codex: {
            id: "codex",
            integration: {
              homeDir: path.join(home, ".codex"),
              settingsPath: path.join(home, ".codex", "config.toml"),
              skillsDir: path.join(home, ".codex", "skills"),
              supportsHooks: false,
            },
            reflectRoot: path.join(home, ".codex", "sessions"),
            extractRoot: path.join(home, ".codex", "sessions"),
            detectSource: () =>
              fs.exists(path.join(home, ".codex")).pipe(Effect.catch(() => Effect.succeed(false))),
            isExecutable: () =>
              Effect.all([
                fs
                  .exists(path.join(home, ".codex"))
                  .pipe(Effect.catch(() => Effect.succeed(false))),
                whichExists("codex"),
              ]).pipe(Effect.map(([exists, which]) => exists && which)),
            invoke: (prompt, profile, cwd) =>
              Effect.tryPromise({
                try: async () => {
                  const args = [
                    "codex",
                    "exec",
                    "-C",
                    cwd ?? process.cwd(),
                    "-c",
                    `model_reasoning_effort=${profile === "deep" ? '"high"' : '"medium"'}`,
                    "-c",
                    "service_tier=fast",
                    "--dangerously-bypass-approvals-and-sandbox",
                    "--skip-git-repo-check",
                    prompt,
                  ];
                  const proc = Bun.spawn(args, {
                    stdout: "ignore",
                    stderr: "inherit",
                  });
                  const code = await proc.exited;
                  if (code !== 0) throw new Error(`codex exited with code ${code}`);
                },
                catch: (e) =>
                  new BrainError({
                    message: `Codex invocation failed: ${e instanceof Error ? e.message : String(e)}`,
                    code: "SPAWN_FAILED",
                  }),
              }),
          },
        };

        const getProvider = (id: Provider) =>
          Effect.succeed(providers[id]).pipe(
            Effect.flatMap((provider) =>
              provider === undefined
                ? Effect.fail(
                    new BrainError({
                      message: `Unsupported provider "${id}"`,
                      code: "UNSUPPORTED_PROVIDER",
                    }),
                  )
                : Effect.succeed(provider),
            ),
          );

        const listDetectedSourceProviders = () =>
          Effect.forEach(allProviderIds, (id) =>
            providers[id]
              .detectSource()
              .pipe(Effect.map((detected) => (detected ? Option.some(id) : Option.none()))),
          ).pipe(Effect.map((ids) => ids.filter(Option.isSome).map((id) => id.value)));

        const listExecutableProviders = () =>
          Effect.forEach(allProviderIds, (id) =>
            providers[id]
              .isExecutable()
              .pipe(Effect.map((detected) => (detected ? Option.some(id) : Option.none()))),
          ).pipe(Effect.map((ids) => ids.filter(Option.isSome).map((id) => id.value)));

        const resolveRequested = (
          requested: Option.Option<Provider> | undefined,
        ): Option.Option<Provider> => requested ?? Option.none();

        const resolveInteractiveProvider = (
          requested?: Option.Option<Provider>,
        ): Effect.Effect<Provider, BrainError> =>
          Effect.gen(function* () {
            const requestedId = resolveRequested(requested);
            if (Option.isSome(requestedId)) return requestedId.value;

            const envProvider = process.env["BRAIN_PROVIDER"];
            if (envProvider === "claude" || envProvider === "codex") return envProvider;

            if (process.env["CLAUDE_PROJECT_DIR"] !== undefined) return "claude";

            const cfg = yield* config.loadConfigFile().pipe(
              Effect.mapError(
                (e) =>
                  new BrainError({
                    message: e.message,
                    code: e.code,
                  }),
              ),
            );
            if (cfg.defaultProvider !== undefined) return cfg.defaultProvider;

            const detected = yield* listDetectedSourceProviders();
            if (detected.length === 1) {
              const provider = detected[0];
              if (provider !== undefined) return provider;
            }

            return yield* new BrainError({
              message: "Provider is ambiguous — use --provider or set defaultProvider",
              code: "AMBIGUOUS_PROVIDER",
            });
          });

        const resolveDaemonExecutor = (
          requested?: Option.Option<Provider>,
        ): Effect.Effect<Provider, BrainError> =>
          Effect.gen(function* () {
            const requestedId = resolveRequested(requested);
            if (Option.isSome(requestedId)) return requestedId.value;

            const cfg = yield* config.loadConfigFile().pipe(
              Effect.mapError(
                (e) =>
                  new BrainError({
                    message: e.message,
                    code: e.code,
                  }),
              ),
            );

            if (cfg.daemon?.provider !== undefined) return cfg.daemon.provider;
            if (cfg.defaultProvider !== undefined) return cfg.defaultProvider;

            const executable = yield* listExecutableProviders();
            if (executable.length === 1) {
              const provider = executable[0];
              if (provider !== undefined) return provider;
            }

            return yield* new BrainError({
              message:
                "Daemon executor is ambiguous — use --executor-provider or set daemon.provider",
              code: "AMBIGUOUS_PROVIDER",
            });
          });

        return {
          getProvider,
          listDetectedSourceProviders,
          listExecutableProviders,
          resolveInteractiveProvider,
          resolveDaemonExecutor,
        };
      }),
    );
}
