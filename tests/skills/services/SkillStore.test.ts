import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { SkillStore, SkillStoreLive } from "../../../src/skills/services/SkillStore.js";

const makeStoreLayer = (dir: string) =>
  SkillStoreLive.pipe(
    Layer.provide(BunServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
  );

describe("SkillStore", () => {
  it.scoped("list returns empty for fresh dir", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const skills = yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        return yield* store.list;
      }).pipe(Effect.provide(makeStoreLayer(dir)));
      expect(skills).toEqual([]);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("installDir and list round-trip", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const skills = yield* Effect.gen(function* () {
        const store = yield* SkillStore;

        yield* store.installDir("test-skill", [
          {
            path: "SKILL.md",
            content: `---
name: test-skill
description: A test skill
---

# Test Skill`,
          },
        ]);

        return yield* store.list;
      }).pipe(Effect.provide(makeStoreLayer(dir)));
      expect(skills.length).toBe(1);
      expect(skills[0]!.name).toBe("test-skill");
      expect(skills[0]!.description).toBe("A test skill");
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("remove deletes skill directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const skills = yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        yield* store.installDir("to-remove", [
          { path: "SKILL.md", content: "---\nname: to-remove\ndescription: bye\n---\n" },
        ]);
        yield* store.remove("to-remove");
        return yield* store.list;
      }).pipe(Effect.provide(makeStoreLayer(dir)));
      expect(skills.length).toBe(0);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("remove fails for nonexistent skill", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const result = yield* Effect.gen(function* () {
        const store = yield* SkillStore;
        return yield* store
          .remove("nope")
          .pipe(Effect.catchTag("@cvr/okra/skills/SkillsError", () => Effect.succeed("not-found")));
      }).pipe(Effect.provide(makeStoreLayer(dir)));
      expect(result).toBe("not-found");
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("syncDir removes stale files before writing new ones", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* Effect.gen(function* () {
        const store = yield* SkillStore;

        yield* store.installDir("test-skill", [
          {
            path: "SKILL.md",
            content: "---\nname: test-skill\ndescription: First\n---\n",
          },
          {
            path: "references/old.md",
            content: "old",
          },
        ]);

        yield* store.syncDir("test-skill", [
          {
            path: "SKILL.md",
            content: "---\nname: test-skill\ndescription: Second\n---\n",
          },
          {
            path: "references/new.md",
            content: "new",
          },
        ]);
      }).pipe(Effect.provide(makeStoreLayer(dir)));

      const oldExists = yield* fs.exists(`${dir}/test-skill/references/old.md`);
      expect(oldExists).toBe(false);
      const newContent = yield* fs.readFileString(`${dir}/test-skill/references/new.md`);
      expect(newContent).toBe("new");
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
