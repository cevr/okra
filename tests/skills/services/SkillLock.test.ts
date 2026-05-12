import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";

const makeSkillsLayer = (dir: string) =>
  SkillLockLive.pipe(
    Layer.provideMerge(SkillStoreLive),
    Layer.provide(BunServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
  );

describe("SkillLock", () => {
  it.scoped("read returns empty lock for fresh dir", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const file = yield* Effect.gen(function* () {
        const lock = yield* SkillLock;
        return yield* lock.read;
      }).pipe(Effect.provide(makeSkillsLayer(dir)));
      expect(file.version).toBe(1);
      expect(Object.keys(file.skills).length).toBe(0);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("add and get round-trip", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const entry = yield* Effect.gen(function* () {
        const lock = yield* SkillLock;
        yield* lock.add("my-skill", "owner/repo", "skills/my-skill/SKILL.md");
        return yield* lock.get("my-skill");
      }).pipe(Effect.provide(makeSkillsLayer(dir)));
      expect(Option.isSome(entry)).toBe(true);
      const value = Option.getOrThrow(entry);
      expect(value.source).toBe("owner/repo");
      expect(value.skillPath).toBe("skills/my-skill/SKILL.md");
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("remove deletes entry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const entry = yield* Effect.gen(function* () {
        const lock = yield* SkillLock;
        yield* lock.add("to-remove", "owner/repo", "skills/to-remove/SKILL.md");
        yield* lock.remove("to-remove");
        return yield* lock.get("to-remove");
      }).pipe(Effect.provide(makeSkillsLayer(dir)));
      expect(Option.isNone(entry)).toBe(true);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("update writes updatedAt", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const after = yield* Effect.gen(function* () {
        const lock = yield* SkillLock;
        yield* lock.add("test", "owner/repo", "skills/test/SKILL.md");
        yield* lock.update("test");
        return yield* lock.get("test");
      }).pipe(Effect.provide(makeSkillsLayer(dir)));
      expect(Option.isSome(after)).toBe(true);
      const value = Option.getOrThrow(after);
      expect(value.source).toBe("owner/repo");
      expect(value.updatedAt).toBeTruthy();
      // updatedAt is produced by production code via DateTime.formatIso; verify ISO 8601 shape.
      expect(value.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("get returns null for nonexistent", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const entry = yield* Effect.gen(function* () {
        const lock = yield* SkillLock;
        return yield* lock.get("nope");
      }).pipe(Effect.provide(makeSkillsLayer(dir)));
      expect(Option.isNone(entry)).toBe(true);
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
