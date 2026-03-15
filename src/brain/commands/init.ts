import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
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
      const requestedProvider = Option.map(provider, (value) => value as Provider);

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

      const providerIds: Array<Provider> = Option.isSome(requestedProvider)
        ? [requestedProvider.value]
        : allProviders
          ? (["claude", "codex"] as Array<Provider>)
          : [yield* platform.resolveInteractiveProvider(Option.none())];

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

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(
          JSON.stringify({
            vault: vaultPath,
            config: cfgPath,
            files: created,
            providers: integrations,
          }),
        );
      } else {
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
            yield* Console.error(
              `Wired ${integration.provider} hooks into ${integration.hooks.value}`,
            );
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
      }
    }),
  ),
);

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

  const parsed = yield* Effect.try({
    try: () => JSON.parse(existing) as Record<string, unknown>,
    catch: () => new ConfigError({ message: "Cannot parse settings.json", code: "PARSE_FAILED" }),
  });
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return yield* new ConfigError({
      message: "settings.json is not a JSON object",
      code: "PARSE_FAILED",
    });
  }

  // Validate hooks is a plain object before using it
  const rawHooks = parsed["hooks"];
  if (
    rawHooks !== undefined &&
    (typeof rawHooks !== "object" || rawHooks === null || Array.isArray(rawHooks))
  ) {
    yield* Console.error("Warning: settings.json hooks is not an object — skipping hook wiring");
    return false;
  }
  const hooks: Record<string, unknown> =
    typeof rawHooks === "object" && rawHooks !== null && !Array.isArray(rawHooks)
      ? (rawHooks as Record<string, unknown>)
      : {};

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

  const sessionStart = getHookArray("SessionStart") as Array<{
    matcher?: string;
    hooks?: Array<{ command?: string }>;
  }>;
  const brainInjectIdx = sessionStart.findIndex(
    (h) => h?.hooks?.some((hh) => hh.command === "okra brain inject") ?? false,
  );
  if (brainInjectIdx === -1) {
    hooks["SessionStart"] = [...sessionStart, sessionStartHook];
    changed = true;
  } else if (sessionStart[brainInjectIdx]?.matcher !== "startup|resume") {
    // Update matcher on existing hook
    sessionStart[brainInjectIdx] = { ...sessionStart[brainInjectIdx], matcher: "startup|resume" };
    hooks["SessionStart"] = sessionStart;
    changed = true;
  }

  const postToolUse = getHookArray("PostToolUse") as Array<{
    hooks?: Array<{ command?: string }>;
  }>;
  const hasBrainReindex = postToolUse.some(
    (h) => h?.hooks?.some((hh) => hh.command === "okra brain reindex") ?? false,
  );
  if (!hasBrainReindex) {
    hooks["PostToolUse"] = [...postToolUse, postToolUseHook];
    changed = true;
  }

  if (changed) {
    parsed["hooks"] = hooks;
    // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
    yield* fs.writeFileString(settingsPath, JSON.stringify(parsed, null, 2) + "\n").pipe(
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
