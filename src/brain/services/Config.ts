import { Config, ConfigProvider, Console, Effect, Layer, Option, Schema, ServiceMap } from "effect";
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

export class ConfigService extends ServiceMap.Service<
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
  static layer: Layer.Layer<ConfigService, never, FileSystem | Path> = Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      const home = process.env["HOME"] ?? process.env["USERPROFILE"];
      if (home === undefined) {
        return yield* Effect.die(
          new ConfigError({ message: "HOME environment variable is not set", code: "READ_FAILED" }),
        );
      }
      const xdgConfig = process.env["XDG_CONFIG_HOME"] ?? path.join(home, ".config");

      const resolveConfigFilePath = () =>
        Effect.succeed(path.join(xdgConfig, "brain", "config.json"));

      const loadConfigFile = Effect.fn("ConfigService.loadConfigFile")(function* () {
        const cfgPath = path.join(xdgConfig, "brain", "config.json");
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
            Console.error(`Warning: corrupt config, using defaults: ${e}`).pipe(Effect.as({})),
          ),
        );
      });

      const globalVaultPath = Effect.fn("ConfigService.globalVaultPath")(function* () {
        const envDir = process.env["BRAIN_DIR"];
        if (envDir !== undefined) return envDir;

        const cfg = yield* loadConfigFile();
        if (cfg.globalVault !== undefined) return cfg.globalVault;

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

        const explicit = process.env["BRAIN_PROJECT_DIR"];
        if (explicit !== undefined) {
          const exists = yield* checkIndex(explicit);
          return exists ? Option.some(explicit) : Option.none<string>();
        }

        const claudeDir = process.env["CLAUDE_PROJECT_DIR"];
        if (claudeDir !== undefined) {
          const brainDir = path.join(claudeDir, "brain");
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
        const envProject = yield* Config.option(Config.string("BRAIN_PROJECT"))
          .parse(ConfigProvider.fromEnv())
          .pipe(
            Effect.mapError(
              () =>
                new ConfigError({
                  message: "Cannot read BRAIN_PROJECT config",
                  code: "READ_FAILED",
                }),
            ),
          );
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
