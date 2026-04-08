// @effect-diagnostics effect/strictEffectProvide:off effect/nodeBuiltinImport:off
import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { NodeServices } from "@effect/platform-node";
import { SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "skills-lock-test-"));

const makeTestLayer = (dir: string) =>
  SkillLockLive.pipe(
    Layer.provideMerge(SkillStoreLive),
    Layer.provide(NodeServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
  );

describe("SkillLock", () => {
  it.live("read returns empty lock for fresh dir", () => {
    const dir = makeTempDir();
    return Effect.gen(function* () {
      const lock = yield* SkillLock;
      const file = yield* lock.read;
      expect(file.version).toBe(1);
      expect(Object.keys(file.skills).length).toBe(0);
    }).pipe(Effect.provide(makeTestLayer(dir)));
  });

  it.live("add and get round-trip", () => {
    const dir = makeTempDir();
    return Effect.gen(function* () {
      const lock = yield* SkillLock;
      yield* lock.add("my-skill", "owner/repo", "skills/my-skill/SKILL.md");

      const entry = yield* lock.get("my-skill");
      expect(Option.isSome(entry)).toBe(true);
      const value = Option.getOrThrow(entry);
      expect(value.source).toBe("owner/repo");
      expect(value.skillPath).toBe("skills/my-skill/SKILL.md");
    }).pipe(Effect.provide(makeTestLayer(dir)));
  });

  it.live("remove deletes entry", () => {
    const dir = makeTempDir();
    return Effect.gen(function* () {
      const lock = yield* SkillLock;
      yield* lock.add("to-remove", "owner/repo", "skills/to-remove/SKILL.md");
      yield* lock.remove("to-remove");

      const entry = yield* lock.get("to-remove");
      expect(Option.isNone(entry)).toBe(true);
    }).pipe(Effect.provide(makeTestLayer(dir)));
  });

  it.live("update writes updatedAt", () => {
    const dir = makeTempDir();
    return Effect.gen(function* () {
      const lock = yield* SkillLock;
      yield* lock.add("test", "owner/repo", "skills/test/SKILL.md");
      yield* lock.update("test");
      const after = yield* lock.get("test");

      expect(Option.isSome(after)).toBe(true);
      const value = Option.getOrThrow(after);
      expect(value.source).toBe("owner/repo");
      expect(value.updatedAt).toBeTruthy();
      expect(new Date(value.updatedAt).toISOString()).toBe(value.updatedAt);
    }).pipe(Effect.provide(makeTestLayer(dir)));
  });

  it.live("get returns null for nonexistent", () => {
    const dir = makeTempDir();
    return Effect.gen(function* () {
      const lock = yield* SkillLock;
      const entry = yield* lock.get("nope");
      expect(Option.isNone(entry)).toBe(true);
    }).pipe(Effect.provide(makeTestLayer(dir)));
  });
});
