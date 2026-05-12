import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { runRemove } from "../../../src/skills/commands/remove.js";
import { GitHub, type GitHubShape } from "../../../src/skills/services/GitHub.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { SkillStore, SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { SkillsError } from "../../../src/skills/errors.js";

const makeTestLayer = (dir: string) =>
  SkillLockLive.pipe(
    Layer.provideMerge(SkillStoreLive),
    Layer.provideMerge(
      GitHub.layerTest({
        listContents: ((..._args: Array<unknown>) =>
          Effect.fail(
            new SkillsError({ message: "n/a", code: "FETCH_FAILED" }),
          )) as GitHubShape["listContents"],
        listTree: ((..._args: Array<unknown>) =>
          Effect.fail(
            new SkillsError({ message: "n/a", code: "FETCH_FAILED" }),
          )) as GitHubShape["listTree"],
        discoverSkills: ((..._args: Array<unknown>) =>
          Effect.fail(
            new SkillsError({ message: "n/a", code: "FETCH_FAILED" }),
          )) as GitHubShape["discoverSkills"],
        fetchRaw: ((..._args: Array<unknown>) =>
          Effect.fail(
            new SkillsError({ message: "n/a", code: "FETCH_FAILED" }),
          )) as GitHubShape["fetchRaw"],
        fetchSkillDir: ((..._args: Array<unknown>) =>
          Effect.fail(
            new SkillsError({ message: "n/a", code: "FETCH_FAILED" }),
          )) as GitHubShape["fetchSkillDir"],
      }),
    ),
    Layer.provideMerge(BunServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
  );

const skillMd = (name: string) => `---\nname: ${name}\ndescription: test\n---\nbody\n`;

describe("runRemove", () => {
  it.scoped("removes a single skill by name", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      const alphaEntry = yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;
        yield* store.installDir("alpha", [{ path: "SKILL.md", content: skillMd("alpha") }]);
        yield* lock.add("alpha", "acme/repo@alpha", "skills/alpha/SKILL.md");

        yield* runRemove(["alpha"]);

        return yield* lock.get("alpha");
      }).pipe(Effect.provide(makeTestLayer(dir)));

      expect(Option.isNone(alphaEntry)).toBe(true);
      expect(yield* fs.exists(`${dir}/alpha`)).toBe(false);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("variadic: removes multiple skills in one invocation", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      const [aEntry, bEntry, cEntry] = yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;
        yield* store.installDir("a", [{ path: "SKILL.md", content: skillMd("a") }]);
        yield* store.installDir("b", [{ path: "SKILL.md", content: skillMd("b") }]);
        yield* store.installDir("c", [{ path: "SKILL.md", content: skillMd("c") }]);
        yield* lock.add("a", "acme/repo@a", "skills/a/SKILL.md");
        yield* lock.add("b", "acme/repo@b", "skills/b/SKILL.md");
        yield* lock.add("c", "acme/repo@c", "skills/c/SKILL.md");

        yield* runRemove(["a", "b", "c"]);

        return [yield* lock.get("a"), yield* lock.get("b"), yield* lock.get("c")] as const;
      }).pipe(Effect.provide(makeTestLayer(dir)));

      expect(Option.isNone(aEntry)).toBe(true);
      expect(Option.isNone(bEntry)).toBe(true);
      expect(Option.isNone(cEntry)).toBe(true);
      expect(yield* fs.exists(`${dir}/a`)).toBe(false);
      expect(yield* fs.exists(`${dir}/b`)).toBe(false);
      expect(yield* fs.exists(`${dir}/c`)).toBe(false);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("removes all matching skills when given a local folder path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const sourceDir = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${sourceDir}/skills/one`, { recursive: true });
      yield* fs.makeDirectory(`${sourceDir}/skills/two`, { recursive: true });
      yield* fs.writeFileString(`${sourceDir}/skills/one/SKILL.md`, skillMd("one"));
      yield* fs.writeFileString(`${sourceDir}/skills/two/SKILL.md`, skillMd("two"));

      const [oneEntry, twoEntry] = yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;
        yield* store.installDir("one", [{ path: "SKILL.md", content: skillMd("one") }]);
        yield* store.installDir("two", [{ path: "SKILL.md", content: skillMd("two") }]);
        yield* lock.add("one", `local:${sourceDir}/skills/one`, "SKILL.md");
        yield* lock.add("two", `local:${sourceDir}/skills/two`, "SKILL.md");

        yield* runRemove([sourceDir]);

        return [yield* lock.get("one"), yield* lock.get("two")] as const;
      }).pipe(Effect.provide(makeTestLayer(dir)));

      expect(Option.isNone(oneEntry)).toBe(true);
      expect(Option.isNone(twoEntry)).toBe(true);
      expect(yield* fs.exists(`${dir}/one`)).toBe(false);
      expect(yield* fs.exists(`${dir}/two`)).toBe(false);
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
