import { Config, Console, Effect, Layer, Option, Schema, Stream, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { ConfigError } from "../errors/index.js";
import type { Provider } from "../../shared/provider.js";

const ProviderSchema = Schema.Union([Schema.Literal("claude"), Schema.Literal("codex")]);

const ConfigFileSchema = Schema.Struct({
  globalVault: Schema.optional(Schema.String),
  defaultProvider: Schema.optional(ProviderSchema),
  daemon: Schema.optional(
    Schema.Struct({
      provider: Schema.optional(ProviderSchema),
    }),
  ),
});

type ConfigFile = typeof ConfigFileSchema.Type;

function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

const ConfigFileJson = Schema.fromJsonString(ConfigFileSchema);
const decodeConfigFile = Schema.decodeUnknownEffect(ConfigFileJson);
const encodeConfigFile = Schema.encodeEffect(ConfigFileJson);

export class ConfigService extends Context.Service<
  ConfigService,
  {
    readonly globalVaultPath: Effect.Effect<string, ConfigError>;
    readonly projectVaultPath: Effect.Effect<Option.Option<string>, ConfigError>;
    readonly activeVaultPath: Effect.Effect<string, ConfigError>;
    readonly currentProjectName: Effect.Effect<Option.Option<string>, ConfigError>;
    readonly configFilePath: Effect.Effect<string, ConfigError>;
    readonly defaultProvider: Effect.Effect<Option.Option<Provider>, ConfigError>;
    readonly loadConfigFile: Effect.Effect<ConfigFile, ConfigError>;
    readonly saveConfigFile: (config: ConfigFile) => Effect.Effect<void, ConfigError>;
  }
>()("@cvr/okra/brain/services/Config/ConfigService") {
  static layer: Layer.Layer<ConfigService, ConfigError, FileSystem | Path | ChildProcessSpawner> =
    Layer.effect(
      ConfigService,
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const spawner = yield* ChildProcessSpawner;

        const readEnv = (key: string): Effect.Effect<Option.Option<string>, ConfigError> =>
          Config.option(Config.string(key)).pipe(
            Effect.mapError(() =>
              ConfigError.make({ message: `Cannot read ${key} config`, code: "READ_FAILED" }),
            ),
          );

        const resolveHome = Effect.fn("ConfigService.resolveHome")(function* () {
          const homeOpt = yield* readEnv("HOME");
          if (Option.isSome(homeOpt)) return homeOpt.value;
          const userProfileOpt = yield* readEnv("USERPROFILE");
          if (Option.isSome(userProfileOpt)) return userProfileOpt.value;
          return yield* ConfigError.make({
            message: "HOME environment variable is not set",
            code: "READ_FAILED",
          });
        });

        const resolveXdgConfig = Effect.fn("ConfigService.resolveXdgConfig")(function* () {
          const xdgConfigOpt = yield* readEnv("XDG_CONFIG_HOME");
          if (Option.isSome(xdgConfigOpt)) return xdgConfigOpt.value;
          const home = yield* resolveHome();
          return path.join(home, ".config");
        });

        const resolveConfigFilePath = Effect.gen(function* () {
          const xdgConfig = yield* resolveXdgConfig();
          return path.join(xdgConfig, "brain", "config.json");
        });

        const loadConfigFile = Effect.gen(function* () {
          const cfgPath = yield* resolveConfigFilePath;
          const exists = yield* fs.exists(cfgPath).pipe(
            Effect.mapError((e: PlatformError) =>
              ConfigError.make({
                message: `Cannot check config: ${e.message}`,
                code: "READ_FAILED",
              }),
            ),
          );
          if (!exists) return {};
          const text = yield* fs.readFileString(cfgPath).pipe(
            Effect.mapError((e: PlatformError) =>
              ConfigError.make({
                message: `Cannot read config: ${e.message}`,
                code: "READ_FAILED",
              }),
            ),
          );
          return yield* decodeConfigFile(text).pipe(
            Effect.catch((e) =>
              Console.error(`Warning: corrupt config, using defaults: ${describeError(e)}`).pipe(
                Effect.as({}),
              ),
            ),
          );
        });

        const globalVaultPath = Effect.gen(function* () {
          const envDir = yield* readEnv("BRAIN_DIR");
          if (Option.isSome(envDir)) return envDir.value;

          const cfg = yield* loadConfigFile;
          if (cfg.globalVault !== undefined) return cfg.globalVault;

          const home = yield* resolveHome();
          return path.join(home, ".brain");
        });

        const projectVaultPath = Effect.gen(function* () {
          const checkIndex = (dir: string) =>
            fs.exists(path.join(dir, "index.md")).pipe(
              Effect.mapError((e: PlatformError) =>
                ConfigError.make({
                  message: `Cannot check project vault: ${e.message}`,
                  code: "READ_FAILED",
                }),
              ),
            );

          const vaultIfIndexed = Effect.fn("ConfigService.vaultIfIndexed")(function* (dir: string) {
            const exists = yield* checkIndex(dir);
            if (exists) {
              return Option.some(dir);
            }
            return Option.none<string>();
          });

          const explicit = yield* readEnv("BRAIN_PROJECT_DIR");
          if (Option.isSome(explicit)) {
            return yield* vaultIfIndexed(explicit.value);
          }

          const claudeDir = yield* readEnv("CLAUDE_PROJECT_DIR");
          if (Option.isSome(claudeDir)) {
            return yield* vaultIfIndexed(path.join(claudeDir.value, "brain"));
          }

          const cwd = process.cwd();
          return yield* vaultIfIndexed(path.join(cwd, "brain"));
        });

        const activeVaultPath = Effect.gen(function* () {
          const project = yield* projectVaultPath;
          if (Option.isSome(project)) return project.value;
          return yield* globalVaultPath;
        });

        const defaultProvider = Effect.gen(function* () {
          const cfg = yield* loadConfigFile;
          return Option.fromUndefinedOr(cfg.defaultProvider);
        });

        const saveConfigFile = Effect.fn("ConfigService.saveConfigFile")(function* (
          config: ConfigFile,
        ) {
          const cfgPath = yield* resolveConfigFilePath;
          const dir = path.dirname(cfgPath);
          yield* fs.makeDirectory(dir, { recursive: true }).pipe(
            Effect.mapError((e: PlatformError) =>
              ConfigError.make({
                message: `Cannot create config dir: ${e.message}`,
                code: "WRITE_FAILED",
              }),
            ),
          );
          const text = yield* encodeConfigFile(config).pipe(
            Effect.mapError(() =>
              ConfigError.make({ message: "Cannot encode config", code: "WRITE_FAILED" }),
            ),
          );
          yield* fs.writeFileString(cfgPath, text + "\n").pipe(
            Effect.mapError((e: PlatformError) =>
              ConfigError.make({
                message: `Cannot write config: ${e.message}`,
                code: "WRITE_FAILED",
              }),
            ),
          );
        });

        const currentProjectName = Effect.gen(function* () {
          // 1. Env override
          const envProject = yield* readEnv("BRAIN_PROJECT");
          if (Option.isSome(envProject) && envProject.value.trim() !== "") {
            return Option.some(envProject.value.trim());
          }

          // 2. Git root basename
          const gitRoot = yield* Effect.gen(function* () {
            const command = ChildProcess.make("git", ["rev-parse", "--show-toplevel"], {
              stdout: "pipe",
              stderr: "ignore",
            });
            const handle = yield* spawner.spawn(command);
            const exitCode = yield* handle.exitCode;
            const stdout = yield* Stream.mkString(Stream.decodeText(handle.stdout));
            if (exitCode !== 0) return Option.none<string>();
            const trimmed = stdout.trim();
            if (trimmed.length === 0) return Option.none<string>();
            return Option.some(trimmed);
          }).pipe(
            Effect.scoped,
            Effect.orElseSucceed(() => Option.none<string>()),
          );

          if (Option.isSome(gitRoot)) {
            const name = path.basename(gitRoot.value);
            if (name.length > 0) return Option.some(name);
          }

          // 3. CWD basename
          const cwdName = path.basename(process.cwd());
          if (cwdName.length > 0 && cwdName !== "/") {
            return Option.some(cwdName);
          }

          return Option.none<string>();
        });

        return {
          globalVaultPath,
          projectVaultPath,
          activeVaultPath,
          currentProjectName,
          configFilePath: resolveConfigFilePath,
          defaultProvider,
          loadConfigFile,
          saveConfigFile,
        };
      }),
    );
}
