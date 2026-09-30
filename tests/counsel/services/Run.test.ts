import { BunServices } from "@effect/platform-bun";
import { describe, expect, it } from "effect-bun-test";
import { Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { AgentPlatformService } from "../../../src/counsel/services/AgentPlatform.js";
import { InvocationRunnerService } from "../../../src/counsel/services/InvocationRunner.js";
import { RunService } from "../../../src/counsel/services/Run.js";

const RunLayer = RunService.layer.pipe(
  Layer.provideMerge(
    AgentPlatformService.layerTest({
      ensureExecutable: () => Effect.succeed("codex"),
      buildInvocations: (_provider, promptFilePath, _profile, cwd) =>
        Effect.succeed([
          {
            cmd: "codex",
            args: ["exec", `Read ${promptFilePath}`],
            cwd,
            model: "fable",
          },
        ] as const),
    }),
  ),
  Layer.provideMerge(
    InvocationRunnerService.layerTest({
      execute: (_invocation, outputFile, stderrFile) =>
        Effect.gen(function* () {
          // Mock writes JSONL matching the provider's stream format.
          // Target is claude (source=codex), so write claude stream-json.
          const claudeJsonl = [
            '{"type":"system","subtype":"init","session_id":"test","model":"claude-fable-5-1"}',
            '{"type":"result","subtype":"success","is_error":false,"result":"second opinion"}',
          ].join("\n");
          yield* Effect.gen(function* () {
            const fs = yield* FileSystem;
            yield* fs.writeFileString(outputFile, claudeJsonl);
            yield* fs.writeFileString(stderrFile, "warning\n");
          }).pipe(Effect.provide(BunServices.layer), Effect.orDie);
          return {
            exitCode: 0,
            durationMs: 12,
            timedOut: false,
          };
        }),
    }),
  ),
  Layer.provideMerge(BunServices.layer),
);

const TestLayer = Layer.mergeAll(RunLayer, BunServices.layer);

describe("RunService", () => {
  it.scopedLive("returns a dry-run preview without writing files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const run = yield* RunService;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "counsel-run-test-" });
      const result = yield* run.run({
        cwd,
        prompt: Option.some("review this"),
        file: Option.none(),
        from: Option.some("claude"),
        deep: false,
        outputDir: "./agents/counsel",
        dryRun: true,
      });

      expect(result._tag).toBe("DryRun");
      if (result._tag !== "DryRun") {
        return;
      }

      expect(result.preview.source).toBe("claude");
      expect(result.preview.target).toBe("codex");
      expect(result.preview.promptSource).toBe("inline");
      expect(yield* fs.exists(result.preview.promptFilePath)).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scopedLive("reads a prompt file and writes the run artifacts", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const run = yield* RunService;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "counsel-run-test-" });
      const promptFilePath = path.join(cwd, "prompt.md");
      yield* fs.writeFileString(promptFilePath, "check the command wiring");

      const result = yield* run.run({
        cwd,
        prompt: Option.none(),
        file: Option.some("prompt.md"),
        from: Option.some("codex"),
        deep: true,
        outputDir: "./agents/counsel",
        dryRun: false,
      });

      expect(result._tag).toBe("Completed");
      if (result._tag !== "Completed") {
        return;
      }

      const manifest = result.manifest;
      const outputText = yield* fs.readFileString(manifest.outputFile);
      const stderrText = yield* fs.readFileString(manifest.stderrFile);
      const promptText = yield* fs.readFileString(manifest.promptFilePath);

      expect(manifest.promptSource).toBe("file");
      expect(manifest.outputBucket).toMatch(/[a-f0-9]{8}$/);
      expect(manifest.source).toBe("codex");
      expect(manifest.target).toBe("claude");
      expect(manifest.profile).toBe("deep");
      expect(manifest.status).toBe("success");
      // Claude's init event names the concrete model behind the requested alias.
      expect(manifest.model).toBe("claude-fable-5-1");
      expect(promptText).toBe("check the command wiring");
      expect(outputText).toBe("second opinion");
      expect(stderrText).toContain("warning");
      expect(manifest.eventsFile).toContain("events.jsonl");
      expect(yield* fs.exists(manifest.eventsFile)).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scopedLive("fails when more than one prompt source is provided", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const run = yield* RunService;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "counsel-run-test-" });
      const failure = yield* run
        .run({
          cwd,
          prompt: Option.some("inline"),
          file: Option.none(),
          stdinText: "stdin",
          from: Option.some("claude"),
          deep: false,
          outputDir: "./agents/counsel",
          dryRun: true,
        })
        .pipe(Effect.flip);

      expect(failure.code).toBe("PROMPT_CONFLICT");
    }).pipe(Effect.provide(TestLayer)),
  );
});

const REJECTION_EVENTS = [
  '{"type":"thread.started","thread_id":"t"}',
  `{"type":"turn.failed","error":{"message":"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."}}`,
].join("\n");
const OTHER_FAILURE_EVENTS = '{"type":"turn.failed","error":{"message":"rate limited"}}';
const CODEX_SUCCESS_EVENTS =
  '{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"codex opinion"}}';

// The first attempt fails with the layer's `firstEvents`; any later attempt succeeds.
const ATTEMPTS: ReadonlyArray<{ readonly events?: string; readonly exitCode?: number }> = [
  {},
  { events: CODEX_SUCCESS_EVENTS, exitCode: 0 },
];

/** Codex target with two model candidates; the first attempt fails with `firstEvents`. */
const makeRetryLayer = (firstEvents: string, executedModels: Array<string>, firstExitCode = 1) =>
  Layer.mergeAll(
    RunService.layer.pipe(
      Layer.provideMerge(
        AgentPlatformService.layerTest({
          buildInvocations: (_provider, _promptFilePath, _profile, cwd) =>
            Effect.succeed([
              { cmd: "codex", args: ["gpt-6.1-sol"], cwd, model: "gpt-6.1-sol" },
              { cmd: "codex", args: ["gpt-6-sol"], cwd, model: "gpt-6-sol" },
            ] as const),
        }),
      ),
      Layer.provideMerge(
        InvocationRunnerService.layerTest({
          execute: (invocation, outputFile, stderrFile) =>
            Effect.gen(function* () {
              const model = invocation.args[0] ?? "";
              executedModels.push(model);
              const attempt = ATTEMPTS[Math.min(executedModels.length - 1, 1)];
              const events = attempt?.events ?? firstEvents;
              yield* Effect.gen(function* () {
                const fs = yield* FileSystem;
                yield* fs.writeFileString(outputFile, events);
                yield* fs.writeFileString(stderrFile, "");
              }).pipe(Effect.provide(BunServices.layer), Effect.orDie);
              return {
                exitCode: attempt?.exitCode ?? firstExitCode,
                durationMs: 1,
                timedOut: false,
              };
            }),
        }),
      ),
      Layer.provideMerge(BunServices.layer),
    ),
    BunServices.layer,
  );

const runCodexTarget = Effect.gen(function* () {
  const fs = yield* FileSystem;
  const run = yield* RunService;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "counsel-run-test-" });
  return yield* run.run({
    cwd,
    prompt: Option.some("review this"),
    file: Option.none(),
    from: Option.some("claude"),
    deep: false,
    outputDir: "./agents/counsel",
    dryRun: false,
  });
});

describe("RunService model fallback", () => {
  it.scopedLive("retries the next model when codex rejects the first", () => {
    const executedModels: Array<string> = [];
    return Effect.gen(function* () {
      const fs = yield* FileSystem;
      const result = yield* runCodexTarget;
      expect(executedModels).toEqual(["gpt-6.1-sol", "gpt-6-sol"]);
      expect(result._tag).toBe("Completed");
      if (result._tag !== "Completed") return;
      expect(result.manifest.status).toBe("success");
      expect(result.manifest.model).toBe("gpt-6-sol");
      expect(yield* fs.readFileString(result.manifest.outputFile)).toBe("codex opinion");
      const path = yield* Path;
      const record = yield* fs.readFileString(
        path.join(path.dirname(result.manifest.outputFile), "manifest.json"),
      );
      expect(record).toContain('"model":"gpt-6-sol"');
      expect(record).toContain('"status":"success"');
    }).pipe(Effect.provide(makeRetryLayer(REJECTION_EVENTS, executedModels)));
  });

  it.scopedLive("does not retry a failure that is not a model rejection", () => {
    const executedModels: Array<string> = [];
    return Effect.gen(function* () {
      const result = yield* runCodexTarget;
      expect(executedModels).toEqual(["gpt-6.1-sol"]);
      expect(result._tag).toBe("Completed");
      if (result._tag !== "Completed") return;
      expect(result.manifest.status).toBe("error");
      expect(result.manifest.model).toBe("gpt-6.1-sol");
    }).pipe(Effect.provide(makeRetryLayer(OTHER_FAILURE_EVENTS, executedModels)));
  });
});

describe("RunService failure detection", () => {
  it.scopedLive("fails a usage-limited run even when codex exits 0", () => {
    const executedModels: Array<string> = [];
    const limit = "You've hit your usage limit. Try again at Sep 28th, 2026 8:28 PM.";
    const events = [
      '{"type":"thread.started","thread_id":"t"}',
      `{"type":"turn.failed","error":{"message":"${limit}"}}`,
    ].join("\n");
    return Effect.gen(function* () {
      const fs = yield* FileSystem;
      const result = yield* runCodexTarget;
      expect(executedModels).toEqual(["gpt-6.1-sol"]);
      expect(result._tag).toBe("Completed");
      if (result._tag !== "Completed") return;
      expect(result.manifest.exitCode).toBe(0);
      expect(result.manifest.status).toBe("error");
      expect(result.manifest.failure).toBe(limit);
      expect(yield* fs.readFileString(result.manifest.outputFile)).toBe("");
    }).pipe(Effect.provide(makeRetryLayer(events, executedModels, 0)));
  });

  it.scopedLive("fails a run that exits 0 without an answer", () => {
    const executedModels: Array<string> = [];
    return Effect.gen(function* () {
      const result = yield* runCodexTarget;
      expect(result._tag).toBe("Completed");
      if (result._tag !== "Completed") return;
      expect(result.manifest.status).toBe("error");
      expect(result.manifest.failure).toBe("codex ended without an answer");
    }).pipe(
      Effect.provide(
        makeRetryLayer('{"type":"thread.started","thread_id":"t"}', executedModels, 0),
      ),
    );
  });
});
