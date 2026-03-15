/** @effect-diagnostics effect/strictEffectProvide:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { VaultService } from "../../../src/brain/services/Vault.js";

const TestLayer = VaultService.layer.pipe(Layer.provideMerge(BunServices.layer));

describe("VaultService", () => {
  describe("init", () => {
    it.scoped("creates directories and seed files", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        const created = yield* vault.init(dir);

        expect(created).toContain("index.md");
        expect(created).toContain("principles.md");
        expect(created).toContain("plans/index.md");

        expect(yield* fs.exists(`${dir}/principles`)).toBe(true);
        expect(yield* fs.exists(`${dir}/plans`)).toBe(true);
        expect(yield* fs.exists(`${dir}/projects`)).toBe(true);
        expect(yield* fs.exists(`${dir}/index.md`)).toBe(true);
        expect(yield* fs.exists(`${dir}/principles.md`)).toBe(true);

        const indexContent = yield* fs.readFileString(`${dir}/index.md`);
        expect(indexContent).toBe("# Brain\n");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("is idempotent — second call creates nothing", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* vault.init(dir);
        const second = yield* vault.init(dir);

        expect(second).toEqual([]);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("minimal mode creates only dir and index.md", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        const created = yield* vault.init(dir, { minimal: true });

        expect(created).toEqual(["index.md"]);
        expect(yield* fs.exists(`${dir}/index.md`)).toBe(true);
        expect(yield* fs.exists(`${dir}/principles`)).toBe(false);
        expect(yield* fs.exists(`${dir}/plans`)).toBe(false);
        expect(yield* fs.exists(`${dir}/projects`)).toBe(false);
        expect(yield* fs.exists(`${dir}/principles.md`)).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("listFiles", () => {
    it.scoped("returns .md files sans extension, excludes index.md and node_modules", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* vault.init(dir);

        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* fs.writeFileString(`${dir}/plans/roadmap.md`, "# Roadmap\n");
        yield* fs.writeFileString(`${dir}/standalone.md`, "# Standalone\n");
        yield* fs.makeDirectory(`${dir}/node_modules`, { recursive: true });
        yield* fs.writeFileString(`${dir}/node_modules/pkg.md`, "junk");

        const files = yield* vault.listFiles(dir);

        expect(files).toContain("principles/testing");
        expect(files).toContain("plans/roadmap");
        expect(files).toContain("standalone");
        // principles.md is a seed file (not index.md), should be listed
        expect(files).toContain("principles");
        // index.md excluded
        expect(files).not.toContain("index");
        // node_modules excluded
        expect(files.some((f) => f.includes("node_modules"))).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("rebuildIndex", () => {
    it.scoped("generates correct index with sections", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* fs.writeFileString(`${dir}/plans/roadmap.md`, "# Roadmap\n");

        const result = yield* vault.rebuildIndex(dir);

        expect(result.changed).toBe(true);
        expect(result.sections).toHaveProperty("principles");
        expect(result.sections).toHaveProperty("plans");

        const content = yield* fs.readFileString(`${dir}/index.md`);
        expect(content).toContain("## Principles");
        expect(content).toContain("- [[principles/testing]]");
        expect(content).toContain("## Plans");
        expect(content).toContain("- [[plans/roadmap]]");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("is no-op when unchanged", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");

        yield* vault.rebuildIndex(dir);
        const second = yield* vault.rebuildIndex(dir);

        expect(second.changed).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("strips wikilink anchors in comparison", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");

        // Build normal index first
        yield* vault.rebuildIndex(dir);

        // Manually add an anchor to the wikilink
        const indexPath = `${dir}/index.md`;
        const content = yield* fs.readFileString(indexPath);
        yield* fs.writeFileString(
          indexPath,
          content.replace("[[principles/testing]]", "[[principles/testing#section]]"),
        );

        // Should still be no-op since anchors are stripped for comparison
        const result = yield* vault.rebuildIndex(dir);
        expect(result.changed).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("includes standalone files under Other section", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/standalone.md`, "# Standalone\n");

        yield* vault.rebuildIndex(dir);

        const content = yield* fs.readFileString(`${dir}/index.md`);
        expect(content).toContain("## Other");
        expect(content).toContain("- [[standalone]]");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("excludes seed file principles from auto-index Other section", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* vault.init(dir);
        // principles.md is a seed file created by init

        yield* vault.rebuildIndex(dir);

        const content = yield* fs.readFileString(`${dir}/index.md`);
        // principles should NOT appear under Other
        expect(content).not.toContain("- [[principles]]");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("status", () => {
    it.scoped("returns correct file count, sections, orphans", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* vault.init(dir);
        yield* fs.writeFileString(`${dir}/principles/testing.md`, "# Testing\n");
        yield* fs.writeFileString(`${dir}/orphan.md`, "# Orphan\n");

        // Build index only for principles/testing
        yield* vault.rebuildIndex(dir);

        // Now add a new file that won't be in the index
        yield* fs.writeFileString(`${dir}/principles/unindexed.md`, "# Unindexed\n");

        const s = yield* vault.status(dir);

        expect(s.vault).toBe(dir);
        // principles.md (seed) + principles/testing + orphan + principles/unindexed = 4
        expect(s.files).toBe(4);
        expect(s.sections["principles"]).toBe(2);
        // Root-level files (principles.md seed + orphan.md) bucketed under "other"
        expect(s.sections["other"]).toBe(2);
        expect(s.orphans).toContain("principles/unindexed");
        // Seed file "principles" should NOT be reported as orphan
        expect(s.orphans).not.toContain("principles");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("snapshot", () => {
    it.scoped("concatenates files with delimiters", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* fs.makeDirectory(`${dir}/vault`, { recursive: true });
        yield* fs.writeFileString(`${dir}/vault/a.md`, "Alpha content");
        yield* fs.writeFileString(`${dir}/vault/b.md`, "Beta content");

        const result = yield* vault.snapshot(`${dir}/vault`, Option.none());

        expect(result).toContain("=== a.md ===");
        expect(result).toContain("Alpha content");
        expect(result).toContain("=== b.md ===");
        expect(result).toContain("Beta content");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("creates parent directories for output", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* fs.makeDirectory(`${dir}/vault`, { recursive: true });
        yield* fs.writeFileString(`${dir}/vault/a.md`, "content");

        const outPath = `${dir}/nested/deep/snapshot.md`;
        const result = yield* vault.snapshot(`${dir}/vault`, Option.some(outPath));

        expect(result).toBe(outPath);
        expect(yield* fs.exists(outPath)).toBe(true);

        const written = yield* fs.readFileString(outPath);
        expect(written).toContain("=== a.md ===");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("excludes node_modules", () =>
      Effect.gen(function* () {
        const vault = yield* VaultService;
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();

        yield* fs.makeDirectory(`${dir}/vault/node_modules`, { recursive: true });
        yield* fs.writeFileString(`${dir}/vault/real.md`, "Real content");
        yield* fs.writeFileString(`${dir}/vault/node_modules/junk.md`, "Junk");

        const result = yield* vault.snapshot(`${dir}/vault`, Option.none());

        expect(result).toContain("=== real.md ===");
        expect(result).not.toContain("junk");
      }).pipe(Effect.provide(TestLayer)),
    );
  });
});
