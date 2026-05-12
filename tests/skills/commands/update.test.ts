import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { runUpdate } from "../../../src/skills/commands/update.js";
import { GitHub, type GitHubShape } from "../../../src/skills/services/GitHub.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { SkillStore, SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { SkillsError } from "../../../src/skills/errors.js";

const makeTestLayer = (dir: string, github: GitHubShape) =>
  SkillLockLive.pipe(
    Layer.provideMerge(SkillStoreLive),
    Layer.provideMerge(GitHub.layerTest(github)),
    Layer.provideMerge(BunServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
  );

const notImplemented = (..._args: Array<unknown>) =>
  Effect.fail(new SkillsError({ message: "not-implemented", code: "FETCH_FAILED" }));

describe("runUpdate", () => {
  it.scoped("removes local skill when source path no longer exists", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      const github: GitHubShape = {
        listContents: notImplemented as GitHubShape["listContents"],
        fetchRaw: notImplemented as GitHubShape["fetchRaw"],
        listTree: notImplemented as GitHubShape["listTree"],
        discoverSkills: notImplemented as GitHubShape["discoverSkills"],
        fetchSkillDir: notImplemented as GitHubShape["fetchSkillDir"],
      };

      const lockEntry = yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;

        // Install a skill and add a lock entry pointing to a non-existent local path
        yield* store.installDir("my-local-skill", [
          { path: "SKILL.md", content: "---\nname: my-local-skill\ndescription: test\n---\n" },
        ]);
        yield* lock.add("my-local-skill", "local:/tmp/does-not-exist-ever", "SKILL.md");

        yield* runUpdate();

        return yield* lock.get("my-local-skill");
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      // Skill dir and lock entry should both be gone
      expect(Option.isNone(lockEntry)).toBe(true);
      expect(yield* fs.exists(`${dir}/my-local-skill`)).toBe(false);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("re-creates installed skill when dir is missing but lock entry exists", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      // Create a local source dir with a skill
      const sourceDir = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${sourceDir}/my-skill`, { recursive: true });
      yield* fs.writeFileString(
        `${sourceDir}/my-skill/SKILL.md`,
        "---\nname: my-skill\ndescription: restored\n---\nContent\n",
      );

      const github: GitHubShape = {
        listContents: notImplemented as GitHubShape["listContents"],
        fetchRaw: notImplemented as GitHubShape["fetchRaw"],
        listTree: notImplemented as GitHubShape["listTree"],
        discoverSkills: notImplemented as GitHubShape["discoverSkills"],
        fetchSkillDir: notImplemented as GitHubShape["fetchSkillDir"],
      };

      yield* Effect.gen(function* () {
        const lock = yield* SkillLock;

        // Add lock entry but do NOT install the skill dir — simulates deleted dir
        yield* lock.add("my-skill", `local:${sourceDir}/my-skill`, "SKILL.md");

        yield* runUpdate();
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      // Skill dir should be re-created from source
      expect(yield* fs.exists(`${dir}/my-skill/SKILL.md`)).toBe(true);
      expect(yield* fs.readFileString(`${dir}/my-skill/SKILL.md`)).toContain("restored");
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("falls back to discoverSkills + updates skillPath when source moved within repo", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      const newDir = "skills/productivity/handoff";
      const newSkillPath = `${newDir}/SKILL.md`;
      const oldDir = "skills/in-progress/handoff";

      const fetchSkillDir: GitHubShape["fetchSkillDir"] = (_owner, _repo, dirPath) => {
        if (dirPath === oldDir) {
          return Effect.fail(
            new SkillsError({
              message: `Failed to fetch: github:mattpocock/skills/${oldDir} (404)`,
              code: "FETCH_FAILED",
            }),
          );
        }
        if (dirPath === newDir) {
          return Effect.succeed([
            { path: "SKILL.md", content: "---\nname: handoff\ndescription: moved\n---\nNew\n" },
          ]);
        }
        return Effect.die(`unexpected dir: ${dirPath}`);
      };

      const discoverSkills: GitHubShape["discoverSkills"] = () =>
        Effect.succeed([
          { dirName: "handoff", skillMdPath: newSkillPath, skillDir: newDir },
          {
            dirName: "prototype",
            skillMdPath: "skills/engineering/prototype/SKILL.md",
            skillDir: "skills/engineering/prototype",
          },
        ]);

      const github: GitHubShape = {
        listContents: notImplemented as GitHubShape["listContents"],
        fetchRaw: notImplemented as GitHubShape["fetchRaw"],
        listTree: notImplemented as GitHubShape["listTree"],
        discoverSkills,
        fetchSkillDir,
      };

      const entry = yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;

        yield* store.installDir("handoff", [
          { path: "SKILL.md", content: "---\nname: handoff\ndescription: old\n---\nOld\n" },
        ]);
        yield* lock.add("handoff", "mattpocock/skills", `${oldDir}/SKILL.md`);

        yield* runUpdate();

        return yield* lock.get("handoff");
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      expect(Option.isSome(entry)).toBe(true);
      if (Option.isSome(entry)) {
        expect(entry.value.skillPath).toBe(newSkillPath);
      }
      expect(yield* fs.readFileString(`${dir}/handoff/SKILL.md`)).toContain("New");
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("keeps the failure when 404'd skill name has no match in repo", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      const fetchSkillDir: GitHubShape["fetchSkillDir"] = (_owner, _repo, _dirPath) =>
        Effect.fail(
          new SkillsError({
            message: `Failed to fetch: github:mattpocock/skills/skills/in-progress/handoff (404)`,
            code: "FETCH_FAILED",
          }),
        );

      const discoverSkills: GitHubShape["discoverSkills"] = () =>
        Effect.succeed([
          {
            dirName: "something-else",
            skillMdPath: "skills/x/something-else/SKILL.md",
            skillDir: "skills/x/something-else",
          },
        ]);

      const github: GitHubShape = {
        listContents: notImplemented as GitHubShape["listContents"],
        fetchRaw: notImplemented as GitHubShape["fetchRaw"],
        listTree: notImplemented as GitHubShape["listTree"],
        discoverSkills,
        fetchSkillDir,
      };

      const entry = yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;

        yield* store.installDir("handoff", [
          { path: "SKILL.md", content: "---\nname: handoff\ndescription: old\n---\n" },
        ]);
        yield* lock.add("handoff", "mattpocock/skills", "skills/in-progress/handoff/SKILL.md");

        yield* runUpdate();

        return yield* lock.get("handoff");
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      // Lock entry unchanged (still pointing at old path), files unchanged
      expect(Option.isSome(entry)).toBe(true);
      if (Option.isSome(entry)) {
        expect(entry.value.skillPath).toBe("skills/in-progress/handoff/SKILL.md");
      }
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("updates multi-file skills installed from owner/repo@skill sources", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      const github: GitHubShape = {
        listContents: (_owner, _repo, path) => {
          switch (path) {
            case "skill/opentui":
              return Effect.succeed([
                { name: "SKILL.md", path: "skill/opentui/SKILL.md", type: "file" as const },
                { name: "references", path: "skill/opentui/references", type: "dir" as const },
              ]);
            case "skill/opentui/references":
              return Effect.succeed([
                {
                  name: "guide.md",
                  path: "skill/opentui/references/guide.md",
                  type: "file" as const,
                },
              ]);
            default:
              return Effect.succeed([]);
          }
        },
        fetchRaw: (_owner, _repo, path) => {
          switch (path) {
            case "skill/opentui/SKILL.md":
              return Effect.succeed(`---
name: OpenTUI
description: Updated skill
---

Fresh content
`);
            case "skill/opentui/references/guide.md":
              return Effect.succeed("new reference");
            default:
              return Effect.die(`unexpected path: ${path}`);
          }
        },
        listTree: notImplemented as GitHubShape["listTree"],
        discoverSkills: notImplemented as GitHubShape["discoverSkills"],
        fetchSkillDir: (_owner, _repo, dirPath, _ref) => {
          if (dirPath === "skill/opentui") {
            return Effect.succeed([
              {
                path: "SKILL.md",
                content: `---
name: OpenTUI
description: Updated skill
---

Fresh content
`,
              },
              {
                path: "references/guide.md",
                content: "new reference",
              },
            ]);
          }
          return Effect.die(`unexpected dir: ${dirPath}`);
        },
      };

      yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        const lock = yield* SkillLock;

        yield* store.installDir("opentui", [
          {
            path: "SKILL.md",
            content: `---
name: OpenTUI
description: Old skill
---

Old content
`,
          },
          {
            path: "references/guide.md",
            content: "old reference",
          },
          {
            path: "references/stale.md",
            content: "stale reference",
          },
        ]);
        yield* lock.add("opentui", "msmps/opentui-skill@opentui", "skill/opentui/SKILL.md");

        yield* runUpdate();
      }).pipe(Effect.provide(makeTestLayer(dir, github)));

      expect(yield* fs.readFileString(`${dir}/opentui/SKILL.md`)).toContain("Fresh content");
      expect(yield* fs.readFileString(`${dir}/opentui/references/guide.md`)).toBe("new reference");
      expect(yield* fs.exists(`${dir}/opentui/references/stale.md`)).toBe(false);
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
