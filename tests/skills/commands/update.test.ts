import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { BunServices } from "@effect/platform-bun";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runUpdate } from "../../../src/skills/commands/update.js";
import { GitHub, type GitHubShape } from "../../../src/skills/services/GitHub.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { SkillStore, SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { SkillsError } from "../../../src/skills/errors.js";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "skills-update-test-"));

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
  it.live("removes local skill when source path no longer exists", () => {
    const dir = makeTempDir();

    const github: GitHubShape = {
      listContents: notImplemented as GitHubShape["listContents"],
      fetchRaw: notImplemented as GitHubShape["fetchRaw"],
      listTree: notImplemented as GitHubShape["listTree"],
      discoverSkills: notImplemented as GitHubShape["discoverSkills"],
      fetchSkillDir: notImplemented as GitHubShape["fetchSkillDir"],
    };

    return Effect.gen(function* () {
      const store = yield* SkillStore;
      const lock = yield* SkillLock;

      // Install a skill and add a lock entry pointing to a non-existent local path
      yield* store.installDir("my-local-skill", [
        { path: "SKILL.md", content: "---\nname: my-local-skill\ndescription: test\n---\n" },
      ]);
      yield* lock.add("my-local-skill", "local:/tmp/does-not-exist-ever", "SKILL.md");

      yield* runUpdate();

      // Skill dir and lock entry should both be gone
      const lockEntry = yield* lock.get("my-local-skill");
      expect(Option.isNone(lockEntry)).toBe(true);
      expect(existsSync(join(dir, "my-local-skill"))).toBe(false);
    }).pipe(Effect.provide(makeTestLayer(dir, github)));
  });

  it.live("re-creates installed skill when dir is missing but lock entry exists", () => {
    const dir = makeTempDir();
    // Create a local source dir with a skill
    const sourceDir = makeTempDir();
    mkdirSync(join(sourceDir, "my-skill"), { recursive: true });
    writeFileSync(
      join(sourceDir, "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: restored\n---\nContent\n",
    );

    const github: GitHubShape = {
      listContents: notImplemented as GitHubShape["listContents"],
      fetchRaw: notImplemented as GitHubShape["fetchRaw"],
      listTree: notImplemented as GitHubShape["listTree"],
      discoverSkills: notImplemented as GitHubShape["discoverSkills"],
      fetchSkillDir: notImplemented as GitHubShape["fetchSkillDir"],
    };

    return Effect.gen(function* () {
      const lock = yield* SkillLock;

      // Add lock entry but do NOT install the skill dir — simulates deleted dir
      yield* lock.add("my-skill", `local:${join(sourceDir, "my-skill")}`, "SKILL.md");

      yield* runUpdate();

      // Skill dir should be re-created from source
      expect(existsSync(join(dir, "my-skill", "SKILL.md"))).toBe(true);
      expect(readFileSync(join(dir, "my-skill", "SKILL.md"), "utf8")).toContain("restored");
    }).pipe(Effect.provide(makeTestLayer(dir, github)));
  });

  it.live("falls back to discoverSkills + updates skillPath when source moved within repo", () => {
    const dir = makeTempDir();

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

    return Effect.gen(function* () {
      const store = yield* SkillStore;
      const lock = yield* SkillLock;

      yield* store.installDir("handoff", [
        { path: "SKILL.md", content: "---\nname: handoff\ndescription: old\n---\nOld\n" },
      ]);
      yield* lock.add("handoff", "mattpocock/skills", `${oldDir}/SKILL.md`);

      yield* runUpdate();

      const entry = yield* lock.get("handoff");
      expect(Option.isSome(entry)).toBe(true);
      if (Option.isSome(entry)) {
        expect(entry.value.skillPath).toBe(newSkillPath);
      }
      expect(readFileSync(join(dir, "handoff", "SKILL.md"), "utf8")).toContain("New");
    }).pipe(Effect.provide(makeTestLayer(dir, github)));
  });

  it.live("keeps the failure when 404'd skill name has no match in repo", () => {
    const dir = makeTempDir();

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

    return Effect.gen(function* () {
      const store = yield* SkillStore;
      const lock = yield* SkillLock;

      yield* store.installDir("handoff", [
        { path: "SKILL.md", content: "---\nname: handoff\ndescription: old\n---\n" },
      ]);
      yield* lock.add("handoff", "mattpocock/skills", "skills/in-progress/handoff/SKILL.md");

      yield* runUpdate();

      // Lock entry unchanged (still pointing at old path), files unchanged
      const entry = yield* lock.get("handoff");
      expect(Option.isSome(entry)).toBe(true);
      if (Option.isSome(entry)) {
        expect(entry.value.skillPath).toBe("skills/in-progress/handoff/SKILL.md");
      }
    }).pipe(Effect.provide(makeTestLayer(dir, github)));
  });

  it.live("updates multi-file skills installed from owner/repo@skill sources", () => {
    const dir = makeTempDir();

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
      fetchSkillDir: (owner, repo, dirPath, _ref) => {
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

    return Effect.gen(function* () {
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
    }).pipe(
      Effect.provide(makeTestLayer(dir, github)),
      Effect.tap(() =>
        Effect.sync(() => {
          expect(readFileSync(join(dir, "opentui", "SKILL.md"), "utf8")).toContain("Fresh content");
          expect(readFileSync(join(dir, "opentui", "references", "guide.md"), "utf8")).toBe(
            "new reference",
          );
          expect(existsSync(join(dir, "opentui", "references", "stale.md"))).toBe(false);
        }),
      ),
    );
  });
});
