import { Console, Effect, Option } from "effect";
import { AgentPlatformService } from "../../services/AgentPlatform.js";
import type { Provider } from "../../../shared/provider.js";
import { ConfigService } from "../../services/Config.js";
import { acquireLock, modifyState, releaseLock } from "./state.js";

interface RunMeditateOptions {
  readonly executorProvider?: Provider;
}

const buildMeditatePrompt = (brainDir: string): string =>
  [
    "You are running the brain meditate daemon.",
    `Brain vault: ${brainDir}`,
    "",
    "Audit the vault quality. Prune low-value notes, merge overlap, tighten principles, and improve structure.",
    "Prefer reduction over growth.",
  ].join("\n");

/** Run the meditate daemon job — audits, prunes, and distills vault quality */
export const runMeditate = Effect.fn("runMeditate")(function* (opts: RunMeditateOptions = {}) {
  const config = yield* ConfigService;
  const platform = yield* AgentPlatformService;
  const brainDir = yield* config.globalVaultPath();
  const executorId = yield* platform.resolveDaemonExecutor(
    opts.executorProvider === undefined ? undefined : Option.some(opts.executorProvider),
  );
  const executor = yield* platform.getProvider(executorId);

  yield* acquireLock(brainDir, "meditate");

  yield* Effect.gen(function* () {
    yield* Console.error(`Meditating with ${executorId}...`);
    yield* executor.invoke(buildMeditatePrompt(brainDir), "deep", brainDir);

    yield* modifyState(brainDir, (state) => ({
      ...state,
      meditate: { lastRun: new Date().toISOString() },
    }));

    yield* Console.error("Meditate complete");
  }).pipe(Effect.ensuring(releaseLock(brainDir, "meditate")));
});
