import { describe, expect, it } from "effect-bun-test";
import { BunCrypto, BunServices } from "@effect/platform-bun";
import { ConfigProvider, Console, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { runAdd } from "../../../src/skills/commands/add.js";
import { runUpdate, UpdateReport } from "../../../src/skills/commands/update.js";
import { GitHub, GitHubHttp } from "../../../src/skills/services/GitHub.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { SkillStore, SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { hashFiles } from "../../../src/skills/lib/hash.js";
import { repoLayer, skillMd, binary } from "../test-utils/github.js";

const decodeReport = Schema.decodeUnknownSync(Schema.fromJsonString(UpdateReport));
const reportUpdate = Effect.gen(function* () {
  const lines: Array<string> = [];
  yield* runUpdate({ json: true }).pipe(
    Effect.provideService(Console.Console, {
      ...globalThis.console,
      log: (line: unknown) => {
        lines.push(String(line));
      },
    }),
  );
  return decodeReport(lines[0]);
});

const makeLayer = (dir: string, links: Record<string, string> = {}) =>
  SkillLockLive.pipe(
    Layer.provideMerge(SkillStoreLive),
    Layer.provideMerge(Layer.effect(GitHub, GitHubHttp).pipe(Layer.provide(repoLayer(links)))),
    Layer.provideMerge(BunServices.layer),
    Layer.provideMerge(BunCrypto.layerDigest),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
  );

describe("symlinked GitHub skills", () => {
  it.scoped("add installs the canonical directory and records its real path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* Effect.gen(function* () {
        yield* runAdd(["acme/repo@domain"]);
        const lock = yield* SkillLock;
        const entry = yield* lock.get("domain");
        expect(Option.isSome(entry)).toBe(true);
        if (Option.isSome(entry))
          expect(entry.value.skillPath).toBe("packages/domain/skills/domain/SKILL.md");
        expect(yield* fs.readFileString(`${dir}/domain/references/guide.md`)).toBe("guide");
        expect(yield* fs.readFile(`${dir}/domain/references/nested/data.bin`)).toEqual(binary);
      }).pipe(Effect.provide(makeLayer(dir)));
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped(
    "update repairs an old provider-path lock and keeps the full file set on later updates",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        yield* Effect.gen(function* () {
          const store = yield* SkillStore;
          const lock = yield* SkillLock;
          const oldFiles = [{ path: "SKILL.md", content: new TextEncoder().encode(skillMd) }];
          yield* store.installDir("domain", oldFiles);
          yield* lock.add(
            "domain",
            "acme/repo@domain",
            ".agents/skills/domain/SKILL.md",
            "main",
            yield* hashFiles(oldFiles),
          );
          expect((yield* reportUpdate).failed).toEqual([]);
          expect(yield* store.readDir("domain")).toHaveLength(3);
          expect(yield* fs.readFileString(`${dir}/domain/references/guide.md`)).toBe("guide");
          expect(yield* fs.readFile(`${dir}/domain/references/nested/data.bin`)).toEqual(binary);
          expect((yield* reportUpdate).unchanged).toBe(1);
          expect(yield* store.readDir("domain")).toHaveLength(3);
        }).pipe(Effect.provide(makeLayer(dir)));
      }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("an invalid link fails add before writing any files or lock entry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* Effect.gen(function* () {
        const errors: Array<string> = [];
        yield* runAdd(["https://github.com/acme/repo/tree/main/.agents/skills/domain"]).pipe(
          Effect.provideService(Console.Console, {
            ...globalThis.console,
            error: (line: unknown) => {
              errors.push(String(line));
            },
          }),
        );
        expect(errors.join("\n")).toContain("Invalid symlink .agents/skills/domain/references");
        expect(yield* fs.exists(`${dir}/domain`)).toBe(false);
        const lock = yield* SkillLock;
        expect(Option.isNone(yield* lock.get("domain"))).toBe(true);
      }).pipe(
        Effect.provide(makeLayer(dir, { ".agents/skills/domain/references": "../../../missing" })),
      );
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("an invalid link fails update without changing installed files or its lock", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;
        const files = [{ path: "SKILL.md", content: new TextEncoder().encode(skillMd) }];
        yield* store.installDir("domain", files);
        yield* lock.add(
          "domain",
          "acme/repo@domain",
          ".agents/skills/domain/SKILL.md",
          "main",
          yield* hashFiles(files),
        );
        const before = yield* lock.read;
        const report = yield* reportUpdate;
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]?.reason).toContain(".agents/skills/domain/references");
        expect(yield* store.readDir("domain")).toEqual(files);
        expect(yield* lock.read).toEqual(before);
      }).pipe(
        Effect.provide(
          makeLayer(dir, { ".agents/skills/domain/references": "../../../../outside" }),
        ),
      );
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
