/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/preferSchemaOverJson:skip-file */
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
      buildInvocation: (_provider, promptFilePath, _profile, cwd) =>
        Effect.succeed({
          cmd: "codex",
          args: ["exec", `Read ${promptFilePath}`],
          cwd,
        }),
    }),
  ),
  Layer.provideMerge(
    InvocationRunnerService.layerTest({
      execute: (_invocation, outputFile, stderrFile) =>
        Effect.promise(async () => {
          await Promise.all([
            Bun.write(outputFile, "second opinion\n"),
            Bun.write(stderrFile, "warning\n"),
          ]);
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
      expect(manifest.source).toBe("codex");
      expect(manifest.target).toBe("claude");
      expect(manifest.profile).toBe("deep");
      expect(manifest.status).toBe("success");
      expect(promptText).toBe("check the command wiring");
      expect(outputText).toContain("second opinion");
      expect(stderrText).toContain("warning");
      expect(yield* fs.exists(path.join(path.dirname(manifest.outputFile), "run.json"))).toBe(
        false,
      );
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
