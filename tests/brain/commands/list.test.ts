/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/preferSchemaOverJson:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { VaultService } from "../../../src/brain/services/Vault.js";
import { withTempDir } from "../helpers/index.js";

const TestLayer = VaultService.layer.pipe(Layer.provideMerge(BunServices.layer));

describe("list", () => {
  it.live("lists vault files", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* fs.makeDirectory(`${dir}/projects/myapp`, { recursive: true });
        yield* fs.writeFileString(`${dir}/projects/myapp/api.md`, "# API\n");

        const files = yield* vault.listFiles(dir);

        expect(files).toContain("principles/testing");
        expect(files).toContain("projects/myapp/api");
        // principles.md seed file should also be listed
        expect(files).toContain("principles");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("empty vault returns only seed files", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;

        yield* vault.init(dir);

        const files = yield* vault.listFiles(dir);

        // Only principles.md seed file (index.md is excluded, plans/index.md is excluded)
        expect(files).toEqual(["principles"]);
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

        const files = yield* vault.listFiles(dir);

        // Simulate the JSON output shape from the list command
        const json = JSON.parse(JSON.stringify({ vault: dir, files })) as Record<string, unknown>;
        expect(json).toHaveProperty("vault");
        expect(json).toHaveProperty("files");
        expect(json["vault"]).toBe(dir);
        expect(Array.isArray(json["files"])).toBe(true);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
