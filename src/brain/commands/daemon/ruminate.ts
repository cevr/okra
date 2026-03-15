import { Console, Effect, Option } from "effect";
import { AgentPlatformService } from "../../services/AgentPlatform.js";
import type { Provider } from "../../../shared/provider.js";
import { ConfigService } from "../../services/Config.js";
import { acquireLock, modifyState, releaseLock } from "./state.js";

interface RunRuminateOptions {
  readonly executorProvider?: Provider;
  readonly sourceProviders?: ReadonlyArray<Provider>;
}

const buildRuminatePrompt = (brainDir: string, sourceProviders: ReadonlyArray<Provider>): string =>
  [
    "You are running the brain ruminate daemon.",
    `Brain vault: ${brainDir}`,
    `Source providers detected: ${sourceProviders.join(", ")}`,
    "",
    "Deep-mine conversation history for recurring preferences, repeated corrections, workflow patterns, and frustrations that recent reflect passes may have missed.",
    "Update existing notes before creating new ones.",
    "Prefer high-frequency and high-impact findings only.",
  ].join("\n");

/** Run the ruminate daemon job — mines session archives for missed patterns */
export const runRuminate = Effect.fn("runRuminate")(function* (opts: RunRuminateOptions = {}) {
  const config = yield* ConfigService;
  const platform = yield* AgentPlatformService;
  const brainDir = yield* config.globalVaultPath();
  const executorId = yield* platform.resolveDaemonExecutor(
    opts.executorProvider === undefined ? undefined : Option.some(opts.executorProvider),
  );
  const executor = yield* platform.getProvider(executorId);
  const sourceProviders = opts.sourceProviders ?? (yield* platform.listDetectedSourceProviders());

  yield* acquireLock(brainDir, "ruminate");

  yield* Effect.gen(function* () {
    yield* Console.error(`Ruminating with ${executorId}...`);
    yield* executor.invoke(buildRuminatePrompt(brainDir, sourceProviders), "deep", brainDir);

    yield* modifyState(brainDir, (state) => ({
      ...state,
      ruminate: { lastRun: new Date().toISOString() },
    }));

    yield* Console.error("Ruminate complete");
  }).pipe(Effect.ensuring(releaseLock(brainDir, "ruminate")));
});
