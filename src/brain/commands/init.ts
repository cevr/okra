import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { PlatformError } from "effect/PlatformError";
import { ConfigService } from "../services/Config.js";
import { VaultService } from "../services/Vault.js";
import { BuildInfo } from "../services/BuildInfo.js";
import {
  AgentPlatformService,
  allProviderIds,
  isAgentProviderId,
} from "../services/AgentPlatform.js";
import type { Provider } from "../../shared/provider.js";
import { BrainError, ConfigError } from "../errors/index.js";

const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const HookCommand = Schema.Struct({ command: Schema.optional(Schema.String) });
const SessionStartEntry = Schema.Struct({
  matcher: Schema.optional(Schema.String),
  hooks: Schema.optional(Schema.Array(HookCommand)),
});
const PostToolUseEntry = Schema.Struct({
  hooks: Schema.optional(Schema.Array(HookCommand)),
});
const SessionStartArray = Schema.Array(SessionStartEntry);
const PostToolUseArray = Schema.Array(PostToolUseEntry);
const decodeSessionStart = Schema.decodeUnknownOption(SessionStartArray);
const decodePostToolUse = Schema.decodeUnknownOption(PostToolUseArray);

const InitOutput = Schema.Struct({
  vault: Schema.String,
  config: Schema.String,
  files: Schema.Array(Schema.String),
  providers: Schema.Array(
    Schema.Struct({
      provider: Schema.String,
      hooks: Schema.NullOr(Schema.String),
      hooksChanged: Schema.Boolean,
      hooksSkipped: Schema.Boolean,
    }),
  ),
});
const encodeInitOutput = Schema.encodeSync(Schema.fromJsonString(InitOutput));

// Settings file is freeform JSON we read+write — use Unknown for round-tripping unknown keys.
const SettingsJson = Schema.fromJsonString(Schema.Unknown);
const encodeSettingsJson = Schema.encodeSync(SettingsJson);

const projectFlag = Flag.boolean("project").pipe(
  Flag.withAlias("p"),
  Flag.withDescription("Create a project-scoped vault"),
);
const globalFlag = Flag.boolean("global").pipe(
  Flag.withAlias("g"),
  Flag.withDescription("Namespace project vault under global vault"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));
const providerFlag = Flag.string("provider").pipe(
  Flag.optional,
  Flag.withDescription("Provider to configure (claude or codex)"),
);
const allProvidersFlag = Flag.boolean("all-providers").pipe(
  Flag.withDescription("Configure all supported providers"),
);
export const init = Command.make("init", {
  project: projectFlag,
  global: globalFlag,
  json: jsonFlag,
  provider: providerFlag,
  allProviders: allProvidersFlag,
}).pipe(
  Command.withDescription("Initialize a brain vault"),
  Command.withHandler(({ project, global, json, provider, allProviders }) =>
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const platform = yield* AgentPlatformService;
      const vault = yield* VaultService;
      const fs = yield* FileSystem;
      const path = yield* Path;

      if (Option.isSome(provider) && !isAgentProviderId(provider.value)) {
        return yield* new BrainError({
          message: `Unknown provider "${provider.value}". Valid: ${allProviderIds.join(", ")}`,
          code: "UNSUPPORTED_PROVIDER",
        });
      }
      const requestedProvider: Option.Option<Provider> = Option.flatMap(provider, (value) =>
        isAgentProviderId(value) ? Option.some(value) : Option.none(),
      );

      let vaultPath: string;

      if (project) {
        if (global) {
          const globalPath = yield* config.globalVaultPath();
          const cwd = process.cwd();
          const projectName = path.basename(cwd);
          vaultPath = path.join(globalPath, "projects", projectName);
          const targetExists = yield* fs.exists(vaultPath).pipe(
            Effect.mapError(
              (e: PlatformError) =>
                new ConfigError({
                  message: `Cannot check project vault: ${e.message}`,
                  code: "READ_FAILED",
                }),
            ),
          );
          if (targetExists) {
            yield* Console.error(`Warning: project vault already exists at ${vaultPath}`);
          }
        } else {
          const cwd = process.cwd();
          vaultPath = path.join(cwd, "brain");
        }
      } else {
        vaultPath = yield* config.globalVaultPath();
      }

      const isProjectSubVault = project && global;
      const created = yield* vault.init(vaultPath, { minimal: isProjectSubVault });

      // Copy starter principles if principles/ is empty (skip for project sub-vaults)
      if (!isProjectSubVault) {
        yield* copyStarterPrinciples(vaultPath);
      }

      const cfgPath = yield* config.configFilePath();
      const cfgExists = yield* fs.exists(cfgPath).pipe(
        Effect.mapError(
          (e: PlatformError) =>
            new ConfigError({
              message: `Cannot check config: ${e.message}`,
              code: "READ_FAILED",
            }),
        ),
      );
      const existingConfig: {
        globalVault?: string;
        defaultProvider?: Provider;
        daemon?: { provider?: Provider };
      } = yield* config.loadConfigFile().pipe(Effect.catch(() => Effect.succeed({})));

      let providerIds: Array<Provider>;
      if (Option.isSome(requestedProvider)) {
        providerIds = [requestedProvider.value];
      } else if (allProviders) {
        providerIds = ["claude", "codex"];
      } else {
        providerIds = [yield* platform.resolveInteractiveProvider(Option.none())];
      }

      const nextDefaultProvider = Option.getOrElse(
        requestedProvider,
        () => existingConfig.defaultProvider ?? providerIds[0] ?? "claude",
      );

      if (!cfgExists || existingConfig.defaultProvider !== nextDefaultProvider) {
        yield* config.saveConfigFile({
          ...existingConfig,
          defaultProvider: nextDefaultProvider,
        });
      }

      const integrations: Array<{
        provider: string;
        hooks: Option.Option<string>;
        hooksChanged: boolean;
        hooksSkipped: boolean;
      }> = [];

      for (const providerId of providerIds) {
        const agent = yield* platform.getProvider(providerId);
        const hooksChanged = agent.integration.supportsHooks
          ? yield* wireHooks(agent.integration.settingsPath)
          : false;
        const hooksSkipped = !agent.integration.supportsHooks;

        integrations.push({
          provider: providerId,
          hooks: agent.integration.supportsHooks
            ? Option.some(agent.integration.settingsPath)
            : Option.none(),
          hooksChanged,
          hooksSkipped,
        });
      }

      yield* renderInitOutput({
        json,
        vaultPath,
        cfgPath,
        cfgExists,
        created,
        integrations,
      });
    }),
  ),
);

interface InitIntegration {
  readonly provider: string;
  readonly hooks: Option.Option<string>;
  readonly hooksChanged: boolean;
  readonly hooksSkipped: boolean;
}

const renderInitOutput = Effect.fn("brain.init.renderOutput")(function* (args: {
  readonly json: boolean;
  readonly vaultPath: string;
  readonly cfgPath: string;
  readonly cfgExists: boolean;
  readonly created: ReadonlyArray<string>;
  readonly integrations: ReadonlyArray<InitIntegration>;
}) {
  const { json, vaultPath, cfgPath, cfgExists, created, integrations } = args;
  if (json) {
    yield* Console.log(
      encodeInitOutput({
        vault: vaultPath,
        config: cfgPath,
        files: created,
        providers: integrations.map((integration) => ({
          provider: integration.provider,
          hooks: Option.getOrNull(integration.hooks),
          hooksChanged: integration.hooksChanged,
          hooksSkipped: integration.hooksSkipped,
        })),
      }),
    );
    return;
  }
  if (created.length > 0) {
    yield* Console.error(`Created vault at ${vaultPath}`);
    for (const f of created) {
      yield* Console.error(`  ${f}`);
    }
  }
  if (!cfgExists) {
    yield* Console.error(`Wrote config to ${cfgPath}`);
  }
  for (const integration of integrations) {
    if (integration.hooksChanged && Option.isSome(integration.hooks)) {
      yield* Console.error(`Wired ${integration.provider} hooks into ${integration.hooks.value}`);
    }
    if (integration.hooksSkipped) {
      yield* Console.error(`Skipped ${integration.provider} hooks — unsupported`);
    }
  }
  const somethingChanged =
    created.length > 0 ||
    !cfgExists ||
    integrations.some((integration) => integration.hooksChanged);
  if (somethingChanged) {
    yield* Console.error(`\nDone — vault ready at ${vaultPath}`);
  } else {
    yield* Console.error(`Already initialized — vault at ${vaultPath}`);
  }
});

/** @internal */
export const wireHooks = Effect.fn("wireHooks")(function* (settingsPath: string) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const dir = path.dirname(settingsPath);
  yield* fs.makeDirectory(dir, { recursive: true }).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new ConfigError({
          message: `Cannot create settings dir: ${e.message}`,
          code: "WRITE_FAILED",
        }),
    ),
  );

  const existing = yield* fs.readFileString(settingsPath).pipe(
    Effect.catch((e) =>
      e instanceof PlatformError &&
      (e.reason._tag === "NotFound" || e.reason._tag === "BadArgument")
        ? Effect.succeed("{}")
        : Effect.fail(
            new ConfigError({
              message: `Cannot read settings: ${(e as PlatformError).message}`,
              code: "READ_FAILED",
            }),
          ),
    ),
  );

  const parsedRaw = yield* Effect.try({
    try: () => decodeUnknownJson(existing),
    catch: () => new ConfigError({ message: "Cannot parse settings.json", code: "PARSE_FAILED" }),
  });
  if (!isRecord(parsedRaw)) {
    return yield* new ConfigError({
      message: "settings.json is not a JSON object",
      code: "PARSE_FAILED",
    });
  }
  const parsed = parsedRaw;

  // Validate hooks is a plain object before using it
  const rawHooks = parsed["hooks"];
  if (rawHooks !== undefined && !isRecord(rawHooks)) {
    yield* Console.error("Warning: settings.json hooks is not an object — skipping hook wiring");
    return false;
  }
  const hooks: Record<string, unknown> = isRecord(rawHooks) ? rawHooks : {};

  const getHookArray = (key: string): unknown[] => {
    const val = hooks[key];
    return Array.isArray(val) ? val : [];
  };

  let changed = false;

  const sessionStartHook = {
    matcher: "startup|resume",
    hooks: [{ type: "command", command: "okra brain inject" }],
  };

  const postToolUseHook = {
    matcher: "brain/",
    hooks: [{ type: "command", command: "okra brain reindex" }],
  };

  const sessionStartRaw = getHookArray("SessionStart");
  const sessionStart = Array.from(Option.getOrElse(decodeSessionStart(sessionStartRaw), () => []));
  const brainInjectIdx = sessionStart.findIndex(
    (h) => h.hooks?.some((hh) => hh.command === "okra brain inject") ?? false,
  );
  if (brainInjectIdx === -1) {
    hooks["SessionStart"] = [...sessionStart, sessionStartHook];
    changed = true;
  } else {
    const existingEntry = sessionStart[brainInjectIdx];
    if (existingEntry !== undefined && existingEntry.matcher !== "startup|resume") {
      sessionStart[brainInjectIdx] = { ...existingEntry, matcher: "startup|resume" };
      hooks["SessionStart"] = sessionStart;
      changed = true;
    }
  }

  const postToolUseRaw = getHookArray("PostToolUse");
  const postToolUse = Array.from(Option.getOrElse(decodePostToolUse(postToolUseRaw), () => []));
  const hasBrainReindex = postToolUse.some(
    (h) => h.hooks?.some((hh) => hh.command === "okra brain reindex") ?? false,
  );
  if (!hasBrainReindex) {
    hooks["PostToolUse"] = [...postToolUse, postToolUseHook];
    changed = true;
  }

  if (changed) {
    parsed["hooks"] = hooks;
    yield* fs.writeFileString(settingsPath, encodeSettingsJson(parsed) + "\n").pipe(
      Effect.mapError(
        (e: PlatformError) =>
          new ConfigError({
            message: `Cannot write settings: ${e.message}`,
            code: "WRITE_FAILED",
          }),
      ),
    );
  }

  return changed;
});

/** @internal */
export const copyStarterPrinciples = Effect.fn("copyStarterPrinciples")(function* (
  vaultPath: string,
) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const { repoRoot } = yield* BuildInfo;
  const root = repoRoot;
  const principlesDir = path.join(vaultPath, "principles");
  const starterDir = path.join(root, "starter", "principles");

  const isNotFound = (e: unknown): boolean =>
    e instanceof PlatformError && (e.reason._tag === "NotFound" || e.reason._tag === "BadArgument");

  // Check if starter dir exists in the build
  const starterExists = yield* fs.exists(starterDir).pipe(
    Effect.catch((e) =>
      isNotFound(e)
        ? Effect.succeed(false)
        : Effect.fail(
            new ConfigError({
              message: `Cannot check starter dir: ${(e as PlatformError).message}`,
              code: "READ_FAILED",
            }),
          ),
    ),
  );
  if (!starterExists) return;

  // Check if vault principles dir is empty
  const entries = yield* fs.readDirectory(principlesDir).pipe(
    Effect.catch((e) =>
      isNotFound(e)
        ? Effect.succeed([] as string[])
        : Effect.fail(
            new ConfigError({
              message: `Cannot read principles dir: ${(e as PlatformError).message}`,
              code: "READ_FAILED",
            }),
          ),
    ),
  );
  if (entries.length > 0) return;

  // Copy starter principles
  const starterFiles = yield* fs.readDirectory(starterDir).pipe(
    Effect.catch((e) =>
      isNotFound(e)
        ? Effect.succeed([] as string[])
        : Effect.fail(
            new ConfigError({
              message: `Cannot read starter dir: ${(e as PlatformError).message}`,
              code: "READ_FAILED",
            }),
          ),
    ),
  );

  for (const file of starterFiles) {
    const content = yield* fs.readFile(path.join(starterDir, file)).pipe(
      Effect.mapError(
        (e: PlatformError) =>
          new ConfigError({
            message: `Cannot read starter file ${file}: ${e.message}`,
            code: "READ_FAILED",
          }),
      ),
    );
    if (content.length > 0) {
      yield* fs.writeFile(path.join(principlesDir, file), content).pipe(
        Effect.mapError(
          (e: PlatformError) =>
            new ConfigError({
              message: `Cannot write ${file}: ${e.message}`,
              code: "WRITE_FAILED",
            }),
        ),
      );
    }
  }

  // Copy principles.md index
  const indexSrc = path.join(root, "starter", "principles.md");
  const indexSrcExists = yield* fs.exists(indexSrc).pipe(
    Effect.catch((e) =>
      isNotFound(e)
        ? Effect.succeed(false)
        : Effect.fail(
            new ConfigError({
              message: `Cannot check starter principles.md: ${(e as PlatformError).message}`,
              code: "READ_FAILED",
            }),
          ),
    ),
  );
  if (indexSrcExists) {
    const indexContent = yield* fs.readFile(indexSrc).pipe(
      Effect.mapError(
        (e: PlatformError) =>
          new ConfigError({
            message: `Cannot read starter principles.md: ${e.message}`,
            code: "READ_FAILED",
          }),
      ),
    );
    if (indexContent.length > 0) {
      yield* fs.writeFile(path.join(vaultPath, "principles.md"), indexContent).pipe(
        Effect.mapError(
          (e: PlatformError) =>
            new ConfigError({
              message: `Cannot write principles.md: ${e.message}`,
              code: "WRITE_FAILED",
            }),
        ),
      );
    }
  }
});
