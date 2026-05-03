import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { BunServices } from "@effect/platform-bun";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAdd } from "../../../src/skills/commands/add.js";
import { GitHub, type GitHubShape } from "../../../src/skills/services/GitHub.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { SkillsError } from "../../../src/skills/errors.js";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "skills-add-test-"));

const makeTestLayer = (dir: string, github: GitHubShape) =>
  SkillLockLive.pipe(
    Layer.provideMerge(SkillStoreLive),
    Layer.provideMerge(GitHub.layerTest(github)),
    Layer.provideMerge(BunServices.layer),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
  );

const notImplemented = (..._args: Array<unknown>) =>
  Effect.fail(new SkillsError({ message: "not-implemented", code: "FETCH_FAILED" }));

const skillMd = (name: string, description = "test") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nContent\n`;

describe("runAdd", () => {
  it.live("installs a single repo+skill source", () => {
    const dir = makeTempDir();

    const github: GitHubShape = {
      listContents: notImplemented as GitHubShape["listContents"],
      listTree: notImplemented as GitHubShape["listTree"],
      discoverSkills: notImplemented as GitHubShape["discoverSkills"],
      fetchRaw: (_owner, _repo, path) => {
        if (path === "skills/foo/SKILL.md") return Effect.succeed(skillMd("foo"));
        return Effect.die(`unexpected fetchRaw: ${path}`);
      },
      fetchSkillDir: (_owner, _repo, dirPath) => {
        if (dirPath === "skills/foo") {
          return Effect.succeed([{ path: "SKILL.md", content: skillMd("foo") }]);
        }
        return Effect.die(`unexpected fetchSkillDir: ${dirPath}`);
      },
    };

    return Effect.gen(function* () {
      yield* runAdd(["acme/repo@foo"]);

      const lock = yield* SkillLock;
      const entry = yield* lock.get("foo");
      expect(Option.isSome(entry)).toBe(true);
      if (Option.isSome(entry)) {
        expect(entry.value.source).toBe("acme/repo@foo");
      }
      expect(existsSync(join(dir, "foo", "SKILL.md"))).toBe(true);
    }).pipe(Effect.provide(makeTestLayer(dir, github)));
  });

  it.live("variadic: installs multiple sources in one invocation", () => {
    const dir = makeTempDir();

    const github: GitHubShape = {
      listContents: notImplemented as GitHubShape["listContents"],
      listTree: notImplemented as GitHubShape["listTree"],
      discoverSkills: notImplemented as GitHubShape["discoverSkills"],
      fetchRaw: (_owner, _repo, path) => {
        if (path === "skills/alpha/SKILL.md") return Effect.succeed(skillMd("alpha"));
        if (path === "skills/beta/SKILL.md") return Effect.succeed(skillMd("beta"));
        return Effect.die(`unexpected fetchRaw: ${path}`);
      },
      fetchSkillDir: (_owner, _repo, dirPath) => {
        if (dirPath === "skills/alpha")
          return Effect.succeed([{ path: "SKILL.md", content: skillMd("alpha") }]);
        if (dirPath === "skills/beta")
          return Effect.succeed([{ path: "SKILL.md", content: skillMd("beta") }]);
        return Effect.die(`unexpected fetchSkillDir: ${dirPath}`);
      },
    };

    return Effect.gen(function* () {
      yield* runAdd(["acme/one@alpha", "acme/two@beta"]);

      const lock = yield* SkillLock;
      expect(Option.isSome(yield* lock.get("alpha"))).toBe(true);
      expect(Option.isSome(yield* lock.get("beta"))).toBe(true);
      expect(existsSync(join(dir, "alpha", "SKILL.md"))).toBe(true);
      expect(existsSync(join(dir, "beta", "SKILL.md"))).toBe(true);
    }).pipe(Effect.provide(makeTestLayer(dir, github)));
  });

  it.live("auto-installs when repo discovers exactly one skill (no prompt)", () => {
    const dir = makeTempDir();

    const github: GitHubShape = {
      listContents: notImplemented as GitHubShape["listContents"],
      listTree: notImplemented as GitHubShape["listTree"],
      fetchRaw: notImplemented as GitHubShape["fetchRaw"],
      discoverSkills: () =>
        Effect.succeed([
          {
            dirName: "solo",
            skillMdPath: "skills/solo/SKILL.md",
            skillDir: "skills/solo",
          },
        ]),
      fetchSkillDir: (_owner, _repo, dirPath) => {
        if (dirPath === "skills/solo")
          return Effect.succeed([{ path: "SKILL.md", content: skillMd("solo") }]);
        return Effect.die(`unexpected fetchSkillDir: ${dirPath}`);
      },
    };

    return Effect.gen(function* () {
      yield* runAdd(["acme/solo-repo"]);

      const lock = yield* SkillLock;
      expect(Option.isSome(yield* lock.get("solo"))).toBe(true);
      expect(existsSync(join(dir, "solo", "SKILL.md"))).toBe(true);
    }).pipe(Effect.provide(makeTestLayer(dir, github)));
  });

  it.live("installs single local skill (root SKILL.md)", () => {
    const dir = makeTempDir();
    const sourceDir = makeTempDir();
    writeFileSync(join(sourceDir, "SKILL.md"), skillMd("local-thing"));

    const github: GitHubShape = {
      listContents: notImplemented as GitHubShape["listContents"],
      listTree: notImplemented as GitHubShape["listTree"],
      discoverSkills: notImplemented as GitHubShape["discoverSkills"],
      fetchRaw: notImplemented as GitHubShape["fetchRaw"],
      fetchSkillDir: notImplemented as GitHubShape["fetchSkillDir"],
    };

    return Effect.gen(function* () {
      yield* runAdd([sourceDir]);

      const lock = yield* SkillLock;
      expect(Option.isSome(yield* lock.get("local-thing"))).toBe(true);
      expect(existsSync(join(dir, "local-thing", "SKILL.md"))).toBe(true);
    }).pipe(Effect.provide(makeTestLayer(dir, github)));
  });

  it.live("auto-installs when local folder contains exactly one skill subdir", () => {
    const dir = makeTempDir();
    const sourceDir = makeTempDir();
    mkdirSync(join(sourceDir, "skills", "lonely"), { recursive: true });
    writeFileSync(join(sourceDir, "skills", "lonely", "SKILL.md"), skillMd("lonely"));

    const github: GitHubShape = {
      listContents: notImplemented as GitHubShape["listContents"],
      listTree: notImplemented as GitHubShape["listTree"],
      discoverSkills: notImplemented as GitHubShape["discoverSkills"],
      fetchRaw: notImplemented as GitHubShape["fetchRaw"],
      fetchSkillDir: notImplemented as GitHubShape["fetchSkillDir"],
    };

    return Effect.gen(function* () {
      yield* runAdd([sourceDir]);

      const lock = yield* SkillLock;
      expect(Option.isSome(yield* lock.get("lonely"))).toBe(true);
      expect(existsSync(join(dir, "lonely", "SKILL.md"))).toBe(true);
    }).pipe(Effect.provide(makeTestLayer(dir, github)));
  });
});
