/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/preferSchemaOverJson:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Exit, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { VaultService } from "../../../src/brain/services/Vault.js";
import { VaultError } from "../../../src/brain/errors/index.js";
import { withTempDir } from "../helpers/index.js";

const TestLayer = VaultService.layer.pipe(Layer.provideMerge(BunServices.layer));

describe("status", () => {
  it.live("returns correct counts and sections", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* fs.makeDirectory(`${dir}/projects/myapp`, { recursive: true });
        yield* fs.writeFileString(`${dir}/projects/myapp/api.md`, "# API\n");
        yield* vault.rebuildIndex(dir);

        const result = yield* vault.status(dir);

        expect(result.vault).toBe(dir);
        // principles.md (seed) + principles/testing + projects/myapp/api = 3
        expect(result.files).toBe(3);
        expect(result.sections["principles"]).toBe(1);
        expect(result.sections["projects"]).toBe(1);
        // principles.md seed file → "other" section
        expect(result.sections["other"]).toBe(1);
        expect(result.orphans).toHaveLength(0);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("detects orphaned files", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* vault.rebuildIndex(dir);

        // Add a file after indexing — it won't be in the index
        yield* fs.writeFileString(`${dir}/principles/orphan.md`, "# Orphan\n");

        const result = yield* vault.status(dir);

        expect(result.orphans).toContain("principles/orphan");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("fails on missing vault directory", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;

        const exit = yield* vault.status(`${dir}/nonexistent`).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const reasons = exit.cause.reasons as unknown as ReadonlyArray<{ error: unknown }>;
          expect(reasons[0]!.error).toBeInstanceOf(VaultError);
        }
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("--json shaped output has expected fields", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* vault.rebuildIndex(dir);

        const result = yield* vault.status(dir);

        // Simulate JSON output shape
        const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
        expect(json).toHaveProperty("vault");
        expect(json).toHaveProperty("files");
        expect(json).toHaveProperty("sections");
        expect(json).toHaveProperty("orphans");
        expect(Array.isArray(json["orphans"])).toBe(true);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
