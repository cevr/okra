import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Console, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { Command } from "effect/cli";
import { BunCrypto, BunServices } from "@effect/platform-bun";
import { FetchHttpClient } from "effect/http";
import { runAdd } from "../../../src/skills/commands/add.js";
import { runUpdate, UpdateReport } from "../../../src/skills/commands/update.js";
import { skillsRoot } from "../../../src/skills/commands/index.js";
import { GitHub, type GitHubShape } from "../../../src/skills/services/GitHub.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { SkillStore, SkillStoreLive } from "../../../src/skills/services/SkillStore.js";

const skillMd = "---\nname: guarded\ndescription: test\n---\nOriginal\n";
const decodeReport = Schema.decodeUnknownSync(Schema.fromJsonString(UpdateReport));
const cli = Command.runWith(skillsRoot, { version: "test" });

const capture = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const stdout: Array<string> = [];
    const stderr: Array<string> = [];
    yield* effect.pipe(
      Effect.provideService(Console.Console, {
        ...globalThis.console,
        log: (line: unknown) => {
          stdout.push(String(line));
        },
        error: (line: unknown) => {
          stderr.push(String(line));
        },
      }),
    );
    return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  });

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped();
  const sourceDir = yield* fs.makeTempDirectoryScoped();
  yield* fs.writeFileString(`${sourceDir}/SKILL.md`, skillMd);
  const unexpected = () => Effect.die("Unexpected GitHub operation");
  const github: GitHubShape = {
    listContents: unexpected,
    listTree: unexpected,
    discoverSkills: unexpected,
    fetchRaw: () => Effect.succeed(new TextEncoder().encode(skillMd)),
    fetchSkillDir: () =>
      Effect.succeed([{ path: "SKILL.md", content: new TextEncoder().encode(skillMd) }]),
  };
  const layer = SkillLockLive.pipe(
    Layer.provideMerge(SkillStoreLive),
    Layer.provideMerge(GitHub.layerTest(github)),
    Layer.provideMerge(BunServices.layer),
    Layer.provideMerge(BunCrypto.layerDigest),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
  );
  return { fs, dir, sourceDir, layer };
});

describe("update protects installed edits", () => {
  for (const source of ["local", "github"] as const) {
    it.scoped(`skips and lists a modified skill from ${source}`, () =>
      Effect.gen(function* () {
        const { fs, dir, sourceDir, layer } = yield* fixture;
        yield* Effect.gen(function* () {
          let input = sourceDir;
          if (source === "github") input = "acme/repo@guarded";
          yield* runAdd([input]);
          const lockBefore = yield* fs.readFileString(`${dir}/.skill-lock.json`);
          yield* fs.writeFileString(`${dir}/guarded/SKILL.md`, "My local edit");
          const output = yield* capture(runUpdate({ json: true }));
          const report = decodeReport(output.stdout);
          expect(report.modified).toEqual([
            {
              name: "guarded",
              source: expect.any(String),
              reason: expect.stringContaining("--force"),
            },
          ]);
          expect(report.outdated).toEqual([]);
          expect(report.failed).toEqual([]);
          expect(report.unchanged).toBe(0);
          expect(output.stderr).toContain("move the edit to the source");
          expect(output.stderr).toContain("--force");
          expect(yield* fs.readFileString(`${dir}/guarded/SKILL.md`)).toBe("My local edit");
          expect(yield* fs.readFileString(`${dir}/.skill-lock.json`)).toBe(lockBefore);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(BunServices.layer)),
    );
  }

  it.scoped("--force overwrites edits and records the new baseline through the CLI", () =>
    Effect.gen(function* () {
      const { fs, dir, sourceDir, layer } = yield* fixture;
      yield* Effect.gen(function* () {
        yield* runAdd([sourceDir]);
        const lock = yield* SkillLock;
        const original = Option.getOrThrow(yield* lock.get("guarded"));
        expect(original.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        yield* fs.writeFileString(`${dir}/guarded/SKILL.md`, "My local edit");
        yield* fs.writeFileString(`${dir}/guarded/.local`, "Extra file");
        yield* fs.writeFileString(`${sourceDir}/SKILL.md`, `${skillMd}New upstream\n`);
        const output = yield* capture(cli(["update", "--force", "--json"]));
        const report = decodeReport(output.stdout);
        expect(report.modified).toEqual([]);
        expect(report.outdated.map((skill) => skill.name)).toEqual(["guarded"]);
        expect(yield* fs.readFileString(`${dir}/guarded/SKILL.md`)).toBe(
          `${skillMd}New upstream\n`,
        );
        expect(yield* fs.exists(`${dir}/guarded/.local`)).toBe(false);
        const updated = Option.getOrThrow(yield* lock.get("guarded"));
        expect(updated.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(updated.hash).not.toBe(original.hash);
        expect(updated.installedAt).toBe(original.installedAt);
        const check = yield* capture(runUpdate({ dryRun: true, json: true }));
        expect(decodeReport(check.stdout).unchanged).toBe(1);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("dry-run reports modified without writing files or the lock through the CLI", () =>
    Effect.gen(function* () {
      const { fs, dir, sourceDir, layer } = yield* fixture;
      yield* Effect.gen(function* () {
        yield* runAdd([sourceDir]);
        yield* fs.writeFileString(`${dir}/guarded/SKILL.md`, "My local edit");
        const before = yield* fs.readFileString(`${dir}/.skill-lock.json`);
        const output = yield* capture(cli(["update", "--dry-run", "--json"]));
        const report = decodeReport(output.stdout);
        expect(report.dryRun).toBe(true);
        expect(report.modified.map((skill) => skill.name)).toEqual(["guarded"]);
        expect(report.outdated).toEqual([]);
        expect(yield* fs.readFileString(`${dir}/guarded/SKILL.md`)).toBe("My local edit");
        expect(yield* fs.readFileString(`${dir}/.skill-lock.json`)).toBe(before);
        const forced = yield* capture(cli(["update", "--dry-run", "--force", "--json"]));
        expect(decodeReport(forced.stdout).outdated.map((skill) => skill.name)).toEqual([
          "guarded",
        ]);
        expect(yield* fs.readFileString(`${dir}/.skill-lock.json`)).toBe(before);
        expect(yield* fs.readFileString(`${dir}/guarded/SKILL.md`)).toBe("My local edit");
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("--force refreshes the baseline when local and source edits already match", () =>
    Effect.gen(function* () {
      const { fs, dir, sourceDir, layer } = yield* fixture;
      yield* Effect.gen(function* () {
        yield* runAdd([sourceDir]);
        yield* fs.writeFileString(`${sourceDir}/SKILL.md`, `${skillMd}Shared edit\n`);
        yield* fs.writeFileString(`${dir}/guarded/SKILL.md`, `${skillMd}Shared edit\n`);
        yield* runUpdate({ force: true });
        const output = yield* capture(runUpdate({ json: true }));
        expect(decodeReport(output.stdout).modified).toEqual([]);
        expect(decodeReport(output.stdout).unchanged).toBe(1);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("backfills an unchanged legacy entry without replacing its files", () =>
    Effect.gen(function* () {
      const { fs, dir, sourceDir, layer } = yield* fixture;
      yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;
        yield* store.installDir("guarded", [
          { path: "SKILL.md", content: new TextEncoder().encode(skillMd) },
        ]);
        yield* lock.add("guarded", `local:${sourceDir}`, "SKILL.md");
        const lockBefore = yield* fs.readFileString(`${dir}/.skill-lock.json`);
        const fileBefore = yield* fs.stat(`${dir}/guarded/SKILL.md`);
        yield* runUpdate({ dryRun: true });
        expect(yield* fs.readFileString(`${dir}/.skill-lock.json`)).toBe(lockBefore);
        const output = yield* capture(runUpdate({ json: true }));
        expect(decodeReport(output.stdout).unchanged).toBe(1);
        expect(output.stderr).not.toContain("Warning");
        const entry = Option.getOrThrow(yield* lock.get("guarded"));
        expect(entry.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        const fileAfter = yield* fs.stat(`${dir}/guarded/SKILL.md`);
        expect(fileAfter.ino).toEqual(fileBefore.ino);
        expect(fileAfter.mtime).toEqual(fileBefore.mtime);
        yield* fs.writeFileString(`${dir}/guarded/SKILL.md`, "Edited after backfill");
        const check = yield* capture(runUpdate({ json: true }));
        expect(decodeReport(check.stdout).modified.map((skill) => skill.name)).toEqual(["guarded"]);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("warns when a legacy entry needs an update and then records a baseline", () =>
    Effect.gen(function* () {
      const { fs, dir, sourceDir, layer } = yield* fixture;
      yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;
        yield* store.installDir("guarded", [
          { path: "SKILL.md", content: new TextEncoder().encode("Old content") },
        ]);
        yield* lock.add("guarded", `local:${sourceDir}`, "SKILL.md");
        const before = yield* fs.readFileString(`${dir}/.skill-lock.json`);
        const check = yield* capture(runUpdate({ dryRun: true, json: true }));
        expect(check.stderr).toContain("no hash baseline existed");
        expect(yield* fs.readFileString(`${dir}/.skill-lock.json`)).toBe(before);
        expect(yield* fs.readFileString(`${dir}/guarded/SKILL.md`)).toBe("Old content");
        const output = yield* capture(runUpdate({ json: true }));
        expect(output.stderr).toContain("no hash baseline existed");
        expect(yield* fs.readFileString(`${dir}/guarded/SKILL.md`)).toBe(skillMd);
        expect(Option.getOrThrow(yield* lock.get("guarded")).hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(BunServices.layer)),
  );

  for (const change of [
    "add",
    "hidden",
    "delete",
    "rename",
    "binary",
    "missing directory",
  ] as const) {
    it.scoped(`protects a skill after ${change}`, () =>
      Effect.gen(function* () {
        const { fs, dir, sourceDir, layer } = yield* fixture;
        yield* fs.writeFile(`${sourceDir}/asset`, new Uint8Array([0xff, 0, 0x80]));
        yield* Effect.gen(function* () {
          yield* runAdd([sourceDir]);
          const before = yield* fs.readFileString(`${dir}/.skill-lock.json`);
          switch (change) {
            case "add":
              yield* fs.writeFileString(`${dir}/guarded/extra`, "Local addition");
              break;
            case "hidden":
              yield* fs.makeDirectory(`${dir}/guarded/.private`);
              yield* fs.writeFileString(`${dir}/guarded/.private/edit`, "Local addition");
              break;
            case "delete":
              yield* fs.remove(`${dir}/guarded/asset`);
              break;
            case "rename":
              yield* fs.rename(`${dir}/guarded/asset`, `${dir}/guarded/renamed`);
              break;
            case "binary":
              yield* fs.writeFile(`${dir}/guarded/asset`, new Uint8Array([0xfe, 0, 0x80]));
              break;
            case "missing directory":
              yield* fs.remove(`${dir}/guarded`, { recursive: true });
              break;
          }
          const output = yield* capture(runUpdate({ json: true }));
          expect(decodeReport(output.stdout).modified.map((skill) => skill.name)).toEqual([
            "guarded",
          ]);
          expect(yield* fs.readFileString(`${dir}/.skill-lock.json`)).toBe(before);
          if (change === "missing directory")
            expect(yield* fs.exists(`${dir}/guarded`)).toBe(false);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(BunServices.layer)),
    );
  }
});
