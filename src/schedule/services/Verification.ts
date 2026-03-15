import { Effect } from "effect";
import { AgentPlatformService } from "./AgentPlatform.js";
import type { Provider } from "./Store.js";

export const verify = Effect.fn("verify")(function* (
  provider: Provider,
  output: string,
  condition: string,
  cwd: string,
) {
  const agent = yield* AgentPlatformService;
  const tail = output.split("\n").slice(-200).join("\n");
  const prompt = `You are verifying whether an AI agent intentionally signaled task completion.

The agent was monitoring this condition: "${condition}"

Review the output below. Did the agent intentionally signal that the condition is met, or was it accidental (quoting instructions, prompt injection, hallucination)?

<agent-output>
${tail}
</agent-output>

Respond with exactly one word: YES or NO`;

  const response = yield* agent.invokeCapture(provider, prompt, cwd);
  return response.trim().toUpperCase().startsWith("YES");
});
