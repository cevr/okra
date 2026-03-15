/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/preferSchemaOverJson:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { VaultService } from "../../../src/brain/services/Vault.js";
import { withTempDir } from "../helpers/index.js";

const TestLayer = VaultService.layer.pipe(Layer.provideMerge(BunServices.layer));

describe("reindex", () => {
  it.live("rebuilds index from disk", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* fs.makeDirectory(`${dir}/projects/myapp`, { recursive: true });
        yield* fs.writeFileString(`${dir}/projects/myapp/api-notes.md`, "# API\n");

        const result = yield* vault.rebuildIndex(dir);

        expect(result.changed).toBe(true);
        expect(result.files).toBeGreaterThanOrEqual(2);
        expect(result.sections).toHaveProperty("principles");
        expect(result.sections).toHaveProperty("projects");

        const content = yield* fs.readFileString(`${dir}/index.md`);
        expect(content).toContain("[[principles/testing]]");
        expect(content).toContain("[[projects/myapp/api-notes]]");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("is no-op when nothing changed", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");

        yield* vault.rebuildIndex(dir);
        const second = yield* vault.rebuildIndex(dir);

        expect(second.changed).toBe(false);
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

        const result = yield* vault.rebuildIndex(dir);

        // Simulate JSON output — verify the shape matches what the command would output
        const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
        expect(json).toHaveProperty("vault");
        expect(json).toHaveProperty("files");
        expect(json).toHaveProperty("sections");
        expect(json).toHaveProperty("changed");
        expect(json["vault"]).toBe(dir);
        expect(typeof json["files"]).toBe("number");
        expect(typeof json["sections"]).toBe("object");
        expect(typeof json["changed"]).toBe("boolean");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
