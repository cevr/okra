import { Console, Effect, Option } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { StoreService } from "../services/Store.js";
import { LaunchdService } from "../services/Launchd.js";
import { AgentPlatformService } from "../services/AgentPlatform.js";
import { buildPromptWithContext } from "../context.js";
import * as StopEvaluator from "../services/StopEvaluator.js";
import * as Verification from "../services/Verification.js";

const generateNonce = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `OKRA_STOP_${hex}`;
};

const buildStopSignalBlock = (condition: string, nonce: string): string =>
  `\n<stop-signal>
When you determine that the following condition is met: "${condition}"
Output this exact line at the end of your response: ${nonce}
This signals the scheduler to verify and stop future runs.
</stop-signal>`;

const complete = Effect.fn("run.complete")(function* (id: string, reason: string) {
  const store = yield* StoreService;
  const launchd = yield* LaunchdService;
  yield* store.update(id, { status: "completed" });
  yield* launchd.uninstall(id);
  yield* Console.error(`[okra schedule] Task ${id} completed: ${reason}`);
});

export const run = Command.make("run", { id: Argument.string("id") }, (config) =>
  Effect.gen(function* () {
    const store = yield* StoreService;
    const task = yield* store.get(config.id);

    // Pre-run: check stop conditions before invoking agent
    const preStop = StopEvaluator.evaluate(task);
    if (Option.isSome(preStop)) {
      yield* complete(task.id, preStop.value.description);
      return;
    }

    // Build prompt
    let prompt = buildPromptWithContext(task.prompt, task.cwd, task.context);

    // Generate nonce for conditional stop
    const nonce = task.conditionalStop !== undefined ? generateNonce() : undefined;

    if (task.conditionalStop !== undefined && nonce !== undefined) {
      prompt += buildStopSignalBlock(task.conditionalStop.condition, nonce);
    }

    yield* Console.error(`[okra schedule] Running task ${task.id}: ${task.prompt}`);

    // Run agent — update lifecycle state regardless of outcome
    const agent = yield* AgentPlatformService;
    const runResult = yield* agent.invoke(task.provider, prompt, task.cwd).pipe(Effect.exit);

    const newRunCount = task.runCount + 1;
    const isOneshot = task.schedule._tag === "Oneshot";

    if (runResult._tag === "Failure") {
      yield* store.update(task.id, {
        lastRun: new Date().toISOString(),
        runCount: newRunCount,
      });
      yield* Console.error(`[okra schedule] Task ${task.id} failed on run #${String(newRunCount)}`);
      // Re-raise the original failure
      yield* runResult;
      return;
    }

    const { output } = runResult.value;

    yield* store.update(task.id, {
      lastRun: new Date().toISOString(),
      runCount: newRunCount,
      status: isOneshot ? "completed" : task.status,
    });

    if (isOneshot) {
      yield* complete(task.id, "oneshot");
      return;
    }

    // Post-run: re-evaluate with updated runCount
    const updated = yield* store.get(task.id);
    const postStop = StopEvaluator.evaluate(updated);
    if (Option.isSome(postStop)) {
      yield* complete(task.id, postStop.value.description);
      return;
    }

    // Conditional stop: signal detection + verification
    if (task.conditionalStop !== undefined && nonce !== undefined && output.includes(nonce)) {
      yield* Console.error(`[okra schedule] Signal detected for task ${task.id}, verifying...`);
      const verified = yield* Verification.verify(
        task.provider,
        output,
        task.conditionalStop.condition,
        task.cwd,
      );
      if (verified) {
        yield* complete(task.id, `condition met: ${task.conditionalStop.condition}`);
        return;
      }
      yield* Console.error(
        `[okra schedule] Verification rejected signal for task ${task.id}, continuing`,
      );
    }

    yield* Console.error(`[okra schedule] Task ${task.id} completed (run #${String(newRunCount)})`);
  }),
).pipe(Command.withDescription("Execute a scheduled task (called by launchd)"));
