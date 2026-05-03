import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { BunServices } from "@effect/platform-bun";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRemove } from "../../../src/skills/commands/remove.js";
import { GitHub, type GitHubShape } from "../../../src/skills/services/GitHub.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { SkillStore, SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { SkillsError } from "../../../src/skills/errors.js";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "skills-remove-test-"));

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
  it.live("removes a single skill by name", () => {
    const dir = makeTempDir();

    return Effect.gen(function* () {
      const store = yield* SkillStore;
      const lock = yield* SkillLock;
      yield* store.installDir("alpha", [{ path: "SKILL.md", content: skillMd("alpha") }]);
      yield* lock.add("alpha", "acme/repo@alpha", "skills/alpha/SKILL.md");

      yield* runRemove(["alpha"]);

      expect(Option.isNone(yield* lock.get("alpha"))).toBe(true);
      expect(existsSync(join(dir, "alpha"))).toBe(false);
    }).pipe(Effect.provide(makeTestLayer(dir)));
  });

  it.live("variadic: removes multiple skills in one invocation", () => {
    const dir = makeTempDir();

    return Effect.gen(function* () {
      const store = yield* SkillStore;
      const lock = yield* SkillLock;
      yield* store.installDir("a", [{ path: "SKILL.md", content: skillMd("a") }]);
      yield* store.installDir("b", [{ path: "SKILL.md", content: skillMd("b") }]);
      yield* store.installDir("c", [{ path: "SKILL.md", content: skillMd("c") }]);
      yield* lock.add("a", "acme/repo@a", "skills/a/SKILL.md");
      yield* lock.add("b", "acme/repo@b", "skills/b/SKILL.md");
      yield* lock.add("c", "acme/repo@c", "skills/c/SKILL.md");

      yield* runRemove(["a", "b", "c"]);

      expect(Option.isNone(yield* lock.get("a"))).toBe(true);
      expect(Option.isNone(yield* lock.get("b"))).toBe(true);
      expect(Option.isNone(yield* lock.get("c"))).toBe(true);
      expect(existsSync(join(dir, "a"))).toBe(false);
      expect(existsSync(join(dir, "b"))).toBe(false);
      expect(existsSync(join(dir, "c"))).toBe(false);
    }).pipe(Effect.provide(makeTestLayer(dir)));
  });

  it.live("removes all matching skills when given a local folder path", () => {
    const dir = makeTempDir();
    const sourceDir = makeTempDir();
    mkdirSync(join(sourceDir, "skills", "one"), { recursive: true });
    mkdirSync(join(sourceDir, "skills", "two"), { recursive: true });
    writeFileSync(join(sourceDir, "skills", "one", "SKILL.md"), skillMd("one"));
    writeFileSync(join(sourceDir, "skills", "two", "SKILL.md"), skillMd("two"));

    return Effect.gen(function* () {
      const store = yield* SkillStore;
      const lock = yield* SkillLock;
      yield* store.installDir("one", [{ path: "SKILL.md", content: skillMd("one") }]);
      yield* store.installDir("two", [{ path: "SKILL.md", content: skillMd("two") }]);
      yield* lock.add("one", `local:${join(sourceDir, "skills", "one")}`, "SKILL.md");
      yield* lock.add("two", `local:${join(sourceDir, "skills", "two")}`, "SKILL.md");

      yield* runRemove([sourceDir]);

      expect(Option.isNone(yield* lock.get("one"))).toBe(true);
      expect(Option.isNone(yield* lock.get("two"))).toBe(true);
      expect(existsSync(join(dir, "one"))).toBe(false);
      expect(existsSync(join(dir, "two"))).toBe(false);
    }).pipe(Effect.provide(makeTestLayer(dir)));
  });
});
