// @effect-diagnostics effect/strictBooleanExpressions:off
import { describe, expect, it } from "effect-bun-test";
import { it as syncIt } from "bun:test";
import { Effect } from "effect";
import {
  discoverFromTree,
  makeDiscoverSkills,
  type GitHubShape,
  type SkillEntry,
} from "../../../src/skills/services/GitHub.js";
import { SkillsError } from "../../../src/skills/errors.js";

// Helper: build a tree from path strings (all blobs unless ending with /)
const makeTree = (paths: Array<string>) =>
  paths.map((p) => ({
    path: p.endsWith("/") ? p.slice(0, -1) : p,
    type: (p.endsWith("/") ? "tree" : "blob") as "blob" | "tree",
    sha: "abc",
  }));

// Helper: run discoverSkills via listing API (truncated tree forces fallback)
const discoverViaListing = (
  fileTree: Record<string, Array<{ name: string; type: "file" | "dir" }>>,
) => {
  const listContents: GitHubShape["listContents"] = (_owner, _repo, path) => {
    const entries = fileTree[path];
    if (!entries)
      return Effect.fail(new SkillsError({ message: `not-found:${path}`, code: "FETCH_FAILED" }));
    return Effect.succeed(
      entries.map((e) => ({
        name: e.name,
        path: path ? `${path}/${e.name}` : e.name,
        type: e.type as "file" | "dir" | "symlink" | "submodule",
      })),
    );
  };
  const listTree: GitHubShape["listTree"] = () => Effect.succeed({ tree: [], truncated: true });

  const discoverSkills = makeDiscoverSkills(listContents, listTree);
  return discoverSkills("owner", "repo");
};

const sortByDir = (entries: ReadonlyArray<SkillEntry>) =>
  [...entries].sort((a, b) => a.skillDir.localeCompare(b.skillDir));

// ─── Tree-based discovery ───────────────────────────────────────────

describe("discoverFromTree", () => {
  syncIt("skills/ at root (standard layout)", () => {
    const result = discoverFromTree(
      makeTree([
        "README.md",
        "skills/",
        "skills/foo/",
        "skills/foo/SKILL.md",
        "skills/bar/",
        "skills/bar/SKILL.md",
      ]),
    );
    expect(sortByDir(result)).toEqual([
      { dirName: "bar", skillMdPath: "skills/bar/SKILL.md", skillDir: "skills/bar" },
      { dirName: "foo", skillMdPath: "skills/foo/SKILL.md", skillDir: "skills/foo" },
    ]);
  });

  syncIt("skill/ at root (singular variant)", () => {
    const result = discoverFromTree(
      makeTree(["skill/", "skill/my-tool/", "skill/my-tool/SKILL.md"]),
    );
    expect(result).toEqual([
      { dirName: "my-tool", skillMdPath: "skill/my-tool/SKILL.md", skillDir: "skill/my-tool" },
    ]);
  });

  syncIt("prefers skills/ over skill/ when both exist", () => {
    const result = discoverFromTree(
      makeTree(["skills/from-skills/SKILL.md", "skill/from-skill/SKILL.md"]),
    );
    expect(result).toEqual([
      {
        dirName: "from-skills",
        skillMdPath: "skills/from-skills/SKILL.md",
        skillDir: "skills/from-skills",
      },
    ]);
  });

  syncIt("deeply nested: plugins/X/skills/Y/SKILL.md (railway-skills layout)", () => {
    const result = discoverFromTree(
      makeTree([
        "plugins/",
        "plugins/railway/",
        "plugins/railway/skills/",
        "plugins/railway/skills/use-railway/",
        "plugins/railway/skills/use-railway/SKILL.md",
        "plugins/railway/skills/use-railway/references/",
        "plugins/railway/skills/use-railway/references/deploy.md",
        "README.md",
      ]),
    );
    expect(result).toEqual([
      {
        dirName: "use-railway",
        skillMdPath: "plugins/railway/skills/use-railway/SKILL.md",
        skillDir: "plugins/railway/skills/use-railway",
      },
    ]);
  });

  syncIt("deeply nested: multiple skills under nested skills/", () => {
    const result = discoverFromTree(
      makeTree(["packages/core/skills/alpha/SKILL.md", "packages/core/skills/beta/SKILL.md"]),
    );
    expect(sortByDir(result)).toEqual([
      {
        dirName: "alpha",
        skillMdPath: "packages/core/skills/alpha/SKILL.md",
        skillDir: "packages/core/skills/alpha",
      },
      {
        dirName: "beta",
        skillMdPath: "packages/core/skills/beta/SKILL.md",
        skillDir: "packages/core/skills/beta",
      },
    ]);
  });

  syncIt("root-level children: foo/SKILL.md (no prefix dir)", () => {
    const result = discoverFromTree(
      makeTree(["foo/", "foo/SKILL.md", "bar/", "bar/SKILL.md", "README.md"]),
    );
    expect(sortByDir(result)).toEqual([
      { dirName: "bar", skillMdPath: "bar/SKILL.md", skillDir: "bar" },
      { dirName: "foo", skillMdPath: "foo/SKILL.md", skillDir: "foo" },
    ]);
  });

  syncIt("root SKILL.md (single-skill repo)", () => {
    const result = discoverFromTree(makeTree(["SKILL.md", "references/", "references/guide.md"]));
    expect(result).toEqual([{ dirName: "", skillMdPath: "SKILL.md", skillDir: "" }]);
  });

  syncIt("empty repo — no skills", () => {
    const result = discoverFromTree(makeTree(["README.md", "src/", "src/index.ts"]));
    expect(result).toEqual([]);
  });

  syncIt("skills/ prefix wins over unprefixed siblings", () => {
    const result = discoverFromTree(makeTree(["skills/foo/SKILL.md", "bar/SKILL.md"]));
    expect(result).toEqual([
      { dirName: "foo", skillMdPath: "skills/foo/SKILL.md", skillDir: "skills/foo" },
    ]);
  });

  syncIt("deeply nested skill/ (singular) variant", () => {
    const result = discoverFromTree(makeTree(["vendor/acme/skill/tool/SKILL.md"]));
    expect(result).toEqual([
      {
        dirName: "tool",
        skillMdPath: "vendor/acme/skill/tool/SKILL.md",
        skillDir: "vendor/acme/skill/tool",
      },
    ]);
  });

  syncIt("arbitrary nesting with no known prefix", () => {
    const result = discoverFromTree(makeTree(["a/b/c/SKILL.md"]));
    expect(result).toEqual([{ dirName: "c", skillMdPath: "a/b/c/SKILL.md", skillDir: "a/b/c" }]);
  });

  syncIt("root SKILL.md only used when no subdirectory SKILL.md exists", () => {
    const result = discoverFromTree(makeTree(["SKILL.md", "tools/deploy/SKILL.md"]));
    // "tools/deploy/SKILL.md" ends with /SKILL.md so it's found by the blob filter
    // Root SKILL.md doesn't end with /SKILL.md, so it's only the fallback
    expect(result).toEqual([
      {
        dirName: "deploy",
        skillMdPath: "tools/deploy/SKILL.md",
        skillDir: "tools/deploy",
      },
    ]);
  });

  syncIt("multiple nested prefixes at different depths — returns all", () => {
    const result = discoverFromTree(makeTree(["a/skills/x/SKILL.md", "b/c/skills/y/SKILL.md"]));
    expect(sortByDir(result)).toEqual([
      { dirName: "x", skillMdPath: "a/skills/x/SKILL.md", skillDir: "a/skills/x" },
      { dirName: "y", skillMdPath: "b/c/skills/y/SKILL.md", skillDir: "b/c/skills/y" },
    ]);
  });

  syncIt("skills within skills/ — only immediate children matched", () => {
    // skills/foo/nested/SKILL.md should match with dirName "nested"
    const result = discoverFromTree(makeTree(["skills/foo/nested/SKILL.md"]));
    // "skills/" is in the path, so it's a prefixed match
    expect(result).toEqual([
      {
        dirName: "nested",
        skillMdPath: "skills/foo/nested/SKILL.md",
        skillDir: "skills/foo/nested",
      },
    ]);
  });

  syncIt("substring false positive: myskills/ does NOT match prefix skills/", () => {
    const result = discoverFromTree(makeTree(["plugins/myskills/tool/SKILL.md"]));
    // "myskills" contains "skills" as substring, but it's not a segment match
    // Should fall through to unprefixed discovery
    expect(result).toEqual([
      {
        dirName: "tool",
        skillMdPath: "plugins/myskills/tool/SKILL.md",
        skillDir: "plugins/myskills/tool",
      },
    ]);
  });

  syncIt("tricky-skill/ does NOT match prefix skill/", () => {
    const result = discoverFromTree(makeTree(["vendor/tricky-skill/deploy/SKILL.md"]));
    expect(result).toEqual([
      {
        dirName: "deploy",
        skillMdPath: "vendor/tricky-skill/deploy/SKILL.md",
        skillDir: "vendor/tricky-skill/deploy",
      },
    ]);
  });
});

// ─── Listing-based discovery (fallback) ──────────────────────────────

describe("discoverFromListing", () => {
  it.live("skills/ at root (standard layout)", () =>
    Effect.gen(function* () {
      const result = yield* discoverViaListing({
        "": [{ name: "skills", type: "dir" }],
        skills: [
          { name: "foo", type: "dir" },
          { name: "bar", type: "dir" },
        ],
        "skills/foo": [{ name: "SKILL.md", type: "file" }],
        "skills/bar": [{ name: "SKILL.md", type: "file" }],
      });
      expect(sortByDir(result)).toEqual([
        { dirName: "bar", skillMdPath: "skills/bar/SKILL.md", skillDir: "skills/bar" },
        { dirName: "foo", skillMdPath: "skills/foo/SKILL.md", skillDir: "skills/foo" },
      ]);
    }),
  );

  it.live("skill/ at root (singular variant)", () =>
    Effect.gen(function* () {
      const result = yield* discoverViaListing({
        "": [{ name: "skill", type: "dir" }],
        skill: [{ name: "my-tool", type: "dir" }],
        "skill/my-tool": [{ name: "SKILL.md", type: "file" }],
      });
      expect(result).toEqual([
        {
          dirName: "my-tool",
          skillMdPath: "skill/my-tool/SKILL.md",
          skillDir: "skill/my-tool",
        },
      ]);
    }),
  );

  it.live("root-level children with SKILL.md", () =>
    Effect.gen(function* () {
      const result = yield* discoverViaListing({
        "": [
          { name: "foo", type: "dir" },
          { name: "bar", type: "dir" },
          { name: "README.md", type: "file" },
        ],
        foo: [{ name: "SKILL.md", type: "file" }],
        bar: [{ name: "SKILL.md", type: "file" }],
      });
      expect(sortByDir(result)).toEqual([
        { dirName: "bar", skillMdPath: "bar/SKILL.md", skillDir: "bar" },
        { dirName: "foo", skillMdPath: "foo/SKILL.md", skillDir: "foo" },
      ]);
    }),
  );

  it.live("root SKILL.md (single-skill repo)", () =>
    Effect.gen(function* () {
      const result = yield* discoverViaListing({
        "": [
          { name: "SKILL.md", type: "file" },
          { name: "references", type: "dir" },
        ],
        references: [{ name: "guide.md", type: "file" }],
      });
      expect(result).toEqual([{ dirName: "repo", skillMdPath: "SKILL.md", skillDir: "" }]);
    }),
  );

  it.live("empty repo — no skills", () =>
    Effect.gen(function* () {
      const result = yield* discoverViaListing({
        "": [
          { name: "README.md", type: "file" },
          { name: "src", type: "dir" },
        ],
        src: [{ name: "index.ts", type: "file" }],
      });
      expect(result).toEqual([]);
    }),
  );

  it.live("nested one level: plugins/railway/skills/use-railway/", () =>
    Effect.gen(function* () {
      const result = yield* discoverViaListing({
        "": [{ name: "plugins", type: "dir" }],
        plugins: [{ name: "railway", type: "dir" }],
        "plugins/railway": [
          { name: "skills", type: "dir" },
          { name: "hooks", type: "dir" },
        ],
        "plugins/railway/skills": [{ name: "use-railway", type: "dir" }],
        "plugins/railway/skills/use-railway": [
          { name: "SKILL.md", type: "file" },
          { name: "references", type: "dir" },
        ],
      });
      expect(result).toEqual([
        {
          dirName: "use-railway",
          skillMdPath: "plugins/railway/skills/use-railway/SKILL.md",
          skillDir: "plugins/railway/skills/use-railway",
        },
      ]);
    }),
  );

  it.live("prefers skills/ at root over nested skills/", () =>
    Effect.gen(function* () {
      const result = yield* discoverViaListing({
        "": [
          { name: "skills", type: "dir" },
          { name: "plugins", type: "dir" },
        ],
        skills: [{ name: "root-skill", type: "dir" }],
        "skills/root-skill": [{ name: "SKILL.md", type: "file" }],
        plugins: [{ name: "railway", type: "dir" }],
        "plugins/railway": [{ name: "skills", type: "dir" }],
        "plugins/railway/skills": [{ name: "nested-skill", type: "dir" }],
        "plugins/railway/skills/nested-skill": [{ name: "SKILL.md", type: "file" }],
      });
      expect(result).toEqual([
        {
          dirName: "root-skill",
          skillMdPath: "skills/root-skill/SKILL.md",
          skillDir: "skills/root-skill",
        },
      ]);
    }),
  );

  it.live("nested skill/ (singular) inside a root dir", () =>
    Effect.gen(function* () {
      const result = yield* discoverViaListing({
        "": [{ name: "vendor", type: "dir" }],
        vendor: [{ name: "skill", type: "dir" }],
        "vendor/skill": [{ name: "tool", type: "dir" }],
        "vendor/skill/tool": [{ name: "SKILL.md", type: "file" }],
      });
      expect(result).toEqual([
        {
          dirName: "tool",
          skillMdPath: "vendor/skill/tool/SKILL.md",
          skillDir: "vendor/skill/tool",
        },
      ]);
    }),
  );
});
