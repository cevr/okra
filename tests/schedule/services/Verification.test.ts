/** @effect-diagnostics effect/strictEffectProvide:skip-file */
import { describe, expect, it } from "effect-bun-test";
import { Effect, Layer } from "effect";
import { AgentPlatformService } from "../../../src/schedule/services/AgentPlatform.js";
import * as Verification from "../../../src/schedule/services/Verification.js";

const mockAgent = (response: string) =>
  Layer.succeed(AgentPlatformService, {
    invoke: () => Effect.succeed({ exitCode: 0, output: "" }),
    invokeCapture: () => Effect.succeed(response),
  });

describe("Verification", () => {
  it.live("returns true when agent responds YES", () =>
    Verification.verify("claude", "some output with signal", "the PR is merged", "/tmp").pipe(
      Effect.map((result) => expect(result).toBe(true)),
      Effect.provide(mockAgent("YES")),
    ),
  );

  it.live("returns true when agent responds YES with trailing whitespace", () =>
    Verification.verify("claude", "output", "PR merged", "/tmp").pipe(
      Effect.map((result) => expect(result).toBe(true)),
      Effect.provide(mockAgent("  YES  \n")),
    ),
  );

  it.live("returns false when agent responds NO", () =>
    Verification.verify("claude", "output", "PR merged", "/tmp").pipe(
      Effect.map((result) => expect(result).toBe(false)),
      Effect.provide(mockAgent("NO")),
    ),
  );

  it.live("returns false when agent responds with something else", () =>
    Verification.verify("claude", "output", "PR merged", "/tmp").pipe(
      Effect.map((result) => expect(result).toBe(false)),
      Effect.provide(mockAgent("I'm not sure about that")),
    ),
  );

  it.live("truncates output to last 200 lines", () => {
    const longOutput = Array.from({ length: 300 }, (_, i) => `line ${String(i)}`).join("\n");
    return Verification.verify("claude", longOutput, "condition", "/tmp").pipe(
      Effect.map((result) => expect(result).toBe(true)),
      Effect.provide(mockAgent("YES")),
    );
  });
});
