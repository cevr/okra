import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { FetchHttpClient } from "effect/unstable/http";
import { BunServices } from "@effect/platform-bun";
import { runAdd } from "../../../src/skills/commands/add.js";
import { GitHub, type GitHubShape } from "../../../src/skills/services/GitHub.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { SkillsError } from "../../../src/skills/errors.js";

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
  it.scoped("installs a single repo+skill source", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

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

      const entry = yield* Effect.gen(function* () {
        yield* runAdd(["acme/repo@foo"]);
        const lock = yield* SkillLock;
        return yield* lock.get("foo");
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      expect(Option.isSome(entry)).toBe(true);
      if (Option.isSome(entry)) {
        expect(entry.value.source).toBe("acme/repo@foo");
      }
      const exists = yield* fs.exists(`${dir}/foo/SKILL.md`);
      expect(exists).toBe(true);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("variadic: installs multiple sources in one invocation", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

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

      const [alphaEntry, betaEntry] = yield* Effect.gen(function* () {
        yield* runAdd(["acme/one@alpha", "acme/two@beta"]);
        const lock = yield* SkillLock;
        const a = yield* lock.get("alpha");
        const b = yield* lock.get("beta");
        return [a, b] as const;
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      expect(Option.isSome(alphaEntry)).toBe(true);
      expect(Option.isSome(betaEntry)).toBe(true);
      expect(yield* fs.exists(`${dir}/alpha/SKILL.md`)).toBe(true);
      expect(yield* fs.exists(`${dir}/beta/SKILL.md`)).toBe(true);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("auto-installs when repo discovers exactly one skill (no prompt)", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

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

      const entry = yield* Effect.gen(function* () {
        yield* runAdd(["acme/solo-repo"]);
        const lock = yield* SkillLock;
        return yield* lock.get("solo");
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      expect(Option.isSome(entry)).toBe(true);
      expect(yield* fs.exists(`${dir}/solo/SKILL.md`)).toBe(true);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("installs single local skill (root SKILL.md)", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const sourceDir = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(`${sourceDir}/SKILL.md`, skillMd("local-thing"));

      const github: GitHubShape = {
        listContents: notImplemented as GitHubShape["listContents"],
        listTree: notImplemented as GitHubShape["listTree"],
        discoverSkills: notImplemented as GitHubShape["discoverSkills"],
        fetchRaw: notImplemented as GitHubShape["fetchRaw"],
        fetchSkillDir: notImplemented as GitHubShape["fetchSkillDir"],
      };

      const entry = yield* Effect.gen(function* () {
        yield* runAdd([sourceDir]);
        const lock = yield* SkillLock;
        return yield* lock.get("local-thing");
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      expect(Option.isSome(entry)).toBe(true);
      expect(yield* fs.exists(`${dir}/local-thing/SKILL.md`)).toBe(true);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("auto-installs when local folder contains exactly one skill subdir", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const sourceDir = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${sourceDir}/skills/lonely`, { recursive: true });
      yield* fs.writeFileString(`${sourceDir}/skills/lonely/SKILL.md`, skillMd("lonely"));

      const github: GitHubShape = {
        listContents: notImplemented as GitHubShape["listContents"],
        listTree: notImplemented as GitHubShape["listTree"],
        discoverSkills: notImplemented as GitHubShape["discoverSkills"],
        fetchRaw: notImplemented as GitHubShape["fetchRaw"],
        fetchSkillDir: notImplemented as GitHubShape["fetchSkillDir"],
      };

      const entry = yield* Effect.gen(function* () {
        yield* runAdd([sourceDir]);
        const lock = yield* SkillLock;
        return yield* lock.get("lonely");
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      expect(Option.isSome(entry)).toBe(true);
      expect(yield* fs.exists(`${dir}/lonely/SKILL.md`)).toBe(true);
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
