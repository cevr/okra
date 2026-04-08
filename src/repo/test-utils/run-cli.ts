// @effect-diagnostics strictEffectProvide:off
import { Command } from "effect/unstable/cli";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Ref, Result } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { expect } from "bun:test";

import { repoRoot } from "../commands/index.js";

import { createTestLayer, type CreateTestLayerOptions } from "./index.js";
import type { ExpectedCall, RecordedCall } from "./sequence.js";

export type { ExpectedCall } from "./sequence.js";

function assertSequenceContains(actual: RecordedCall[], expected: ExpectedCall[]): void {
  let actualIndex = 0;

  for (const exp of expected) {
    let found = false;

    while (actualIndex < actual.length) {
      // actualIndex is within bounds due to while condition
      const act = actual[actualIndex] as RecordedCall;
      actualIndex++;

      if (act.service === exp.service && act.method === exp.method) {
        if (exp.match !== undefined) {
          expect(act.args).toMatchObject(exp.match);
        }
        found = true;
        break;
      }
    }

    if (!found) {
      const remainingCalls = actual.slice(Math.max(0, actualIndex - 1));
      const formattedCalls = remainingCalls.map((c) => `  ${c.service}.${c.method}`).join("\n");
      throw new Error(
        `Expected ${exp.service}.${exp.method} not found in sequence.\n` +
          `Remaining calls:\n${formattedCalls || "  (none)"}\n` +
          `Full sequence:\n${actual.map((c) => `  ${c.service}.${c.method}`).join("\n")}`,
      );
    }
  }
}

function runWithLayer(args: string[], layerOptions: CreateTestLayerOptions) {
  const { layer, sequenceRef } = createTestLayer(layerOptions);
  const cli = Command.runWith(repoRoot, { version: "0.0.0-test" });
  const platformLayer = Layer.mergeAll(BunServices.layer, FetchHttpClient.layer);
  const fullLayer = layer.pipe(Layer.provideMerge(platformLayer));
  const run = cli(args).pipe(Effect.provide(fullLayer), Effect.result);
  return { run, sequenceRef };
}

export interface CliTestRunner {
  expectSequence(expected: ExpectedCall[]): Effect.Effect<void>;
  expectError(errorTag: string): Effect.Effect<void>;
  expectSuccess(): Effect.Effect<void>;
  getSequence(): Effect.Effect<RecordedCall[]>;
}

function createCliTestRunner(args: string[], layerOptions: CreateTestLayerOptions): CliTestRunner {
  return {
    expectSequence: (expected) =>
      Effect.gen(function* () {
        const { run, sequenceRef } = runWithLayer(args, layerOptions);
        yield* run;
        const actual = yield* Ref.get(sequenceRef);
        assertSequenceContains(actual, expected);
      }),

    expectError: (errorTag) =>
      Effect.gen(function* () {
        const { run } = runWithLayer(args, layerOptions);
        const result = yield* run;
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          const error = result.failure as { _tag?: string };
          expect(error._tag).toBe(errorTag);
        }
      }),

    expectSuccess: () =>
      Effect.gen(function* () {
        const { run } = runWithLayer(args, layerOptions);
        yield* run;
      }),

    getSequence: () =>
      Effect.gen(function* () {
        const { run, sequenceRef } = runWithLayer(args, layerOptions);
        yield* run;
        return yield* Ref.get(sequenceRef);
      }),
  };
}

/** Creates a CLI test runner with the given arguments and options. */
export function runCli(args: string, options: CreateTestLayerOptions = {}): CliTestRunner {
  return createCliTestRunner(args.split(/\s+/), options);
}
