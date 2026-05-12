import { Config, Console, Effect, Layer, Option, Schema, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
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

const ConfigFileJson = Schema.fromJsonString(ConfigFileSchema);
const decodeConfigFile = Schema.decodeUnknownEffect(ConfigFileJson);
const encodeConfigFile = Schema.encodeEffect(ConfigFileJson);

export class ConfigService extends Context.Service<
  ConfigService,
  {
    readonly globalVaultPath: () => Effect.Effect<string, ConfigError>;
    readonly projectVaultPath: () => Effect.Effect<Option.Option<string>, ConfigError>;
    readonly activeVaultPath: () => Effect.Effect<string, ConfigError>;
    readonly currentProjectName: () => Effect.Effect<Option.Option<string>, ConfigError>;
    readonly configFilePath: () => Effect.Effect<string, ConfigError>;
    readonly defaultProvider: () => Effect.Effect<Option.Option<Provider>, ConfigError>;
    readonly loadConfigFile: () => Effect.Effect<ConfigFile, ConfigError>;
    readonly saveConfigFile: (config: ConfigFile) => Effect.Effect<void, ConfigError>;
  }
>()("@cvr/okra/brain/services/Config/ConfigService") {
  static layer: Layer.Layer<ConfigService, ConfigError, FileSystem | Path> = Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      const readEnv = (key: string): Effect.Effect<Option.Option<string>, ConfigError> =>
        Config.option(Config.string(key))
          .asEffect()
          .pipe(
            Effect.mapError(
              () => new ConfigError({ message: `Cannot read ${key} config`, code: "READ_FAILED" }),
            ),
          );

      const resolveHome = Effect.fn("ConfigService.resolveHome")(function* () {
        const homeOpt = yield* readEnv("HOME");
        if (Option.isSome(homeOpt)) return homeOpt.value;
        const userProfileOpt = yield* readEnv("USERPROFILE");
        if (Option.isSome(userProfileOpt)) return userProfileOpt.value;
        return yield* new ConfigError({
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

      const resolveConfigFilePath = Effect.fn("ConfigService.configFilePath")(function* () {
        const xdgConfig = yield* resolveXdgConfig();
        return path.join(xdgConfig, "brain", "config.json");
      });

      const loadConfigFile = Effect.fn("ConfigService.loadConfigFile")(function* () {
        const cfgPath = yield* resolveConfigFilePath();
        const exists = yield* fs.exists(cfgPath).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new ConfigError({
                message: `Cannot check config: ${e.message}`,
                code: "READ_FAILED",
              }),
          ),
        );
        if (!exists) return {};
        const text = yield* fs.readFileString(cfgPath).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new ConfigError({
                message: `Cannot read config: ${e.message}`,
                code: "READ_FAILED",
              }),
          ),
        );
        return yield* decodeConfigFile(text).pipe(
          Effect.catch((e) =>
            Console.error(
              `Warning: corrupt config, using defaults: ${e instanceof Error ? e.message : String(e)}`,
            ).pipe(Effect.as({})),
          ),
        );
      });

      const globalVaultPath = Effect.fn("ConfigService.globalVaultPath")(function* () {
        const envDir = yield* readEnv("BRAIN_DIR");
        if (Option.isSome(envDir)) return envDir.value;

        const cfg = yield* loadConfigFile();
        if (cfg.globalVault !== undefined) return cfg.globalVault;

        const home = yield* resolveHome();
        return path.join(home, ".brain");
      });

      const projectVaultPath = Effect.fn("ConfigService.projectVaultPath")(function* () {
        const checkIndex = (dir: string) =>
          fs.exists(path.join(dir, "index.md")).pipe(
            Effect.mapError(
              (e: PlatformError) =>
                new ConfigError({
                  message: `Cannot check project vault: ${e.message}`,
                  code: "READ_FAILED",
                }),
            ),
          );

        const explicit = yield* readEnv("BRAIN_PROJECT_DIR");
        if (Option.isSome(explicit)) {
          const exists = yield* checkIndex(explicit.value);
          return exists ? Option.some(explicit.value) : Option.none<string>();
        }

        const claudeDir = yield* readEnv("CLAUDE_PROJECT_DIR");
        if (Option.isSome(claudeDir)) {
          const brainDir = path.join(claudeDir.value, "brain");
          const exists = yield* checkIndex(brainDir);
          return exists ? Option.some(brainDir) : Option.none<string>();
        }

        const cwd = process.cwd();
        const cwdBrain = path.join(cwd, "brain");
        const exists = yield* checkIndex(cwdBrain);
        return exists ? Option.some(cwdBrain) : Option.none<string>();
      });

      const activeVaultPath = Effect.fn("ConfigService.activeVaultPath")(function* () {
        const project = yield* projectVaultPath();
        if (Option.isSome(project)) return project.value;
        return yield* globalVaultPath();
      });

      const defaultProvider = Effect.fn("ConfigService.defaultProvider")(function* () {
        const cfg = yield* loadConfigFile();
        return cfg.defaultProvider !== undefined
          ? Option.some(cfg.defaultProvider)
          : Option.none<Provider>();
      });

      const saveConfigFile = Effect.fn("ConfigService.saveConfigFile")(function* (
        config: ConfigFile,
      ) {
        const cfgPath = yield* resolveConfigFilePath();
        const dir = path.dirname(cfgPath);
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new ConfigError({
                message: `Cannot create config dir: ${e.message}`,
                code: "WRITE_FAILED",
              }),
          ),
        );
        const text = yield* encodeConfigFile(config).pipe(
          Effect.mapError(
            () => new ConfigError({ message: "Cannot encode config", code: "WRITE_FAILED" }),
          ),
        );
        yield* fs.writeFileString(cfgPath, text + "\n").pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new ConfigError({
                message: `Cannot write config: ${e.message}`,
                code: "WRITE_FAILED",
              }),
          ),
        );
      });

      const currentProjectName = Effect.fn("ConfigService.currentProjectName")(function* () {
        // 1. Env override
        const envProject = yield* readEnv("BRAIN_PROJECT");
        if (Option.isSome(envProject) && envProject.value.trim() !== "") {
          return Option.some(envProject.value.trim());
        }

        // 2. Git root basename
        const gitRoot = yield* Effect.try({
          try: () => {
            const proc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
              stderr: "ignore",
            });
            if (!proc.success) return Option.none<string>();
            const trimmed = new TextDecoder().decode(proc.stdout).trim();
            return trimmed.length > 0 ? Option.some(trimmed) : Option.none<string>();
          },
          catch: () => new ConfigError({ message: "git detection failed", code: "READ_FAILED" }),
        }).pipe(Effect.catch(() => Effect.succeed(Option.none<string>())));

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
