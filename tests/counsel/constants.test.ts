import { BunCrypto } from "@effect/platform-bun";
import { Effect } from "effect";
import { describe, expect, it } from "effect-bun-test";
import { makeCwdBucket } from "../../src/counsel/constants.js";

describe("makeCwdBucket", () => {
  it.effect("is deterministic for the same input", () =>
    Effect.gen(function* () {
      const cwdBucket = yield* makeCwdBucket;
      const a = yield* cwdBucket("/Users/cvr/Developer/personal/counsel");
      const b = yield* cwdBucket("/Users/cvr/Developer/personal/counsel");
      expect(a).toBe(b);
    }).pipe(Effect.provide(BunCrypto.layerDigest)),
  );

  it.effect("uses last 2 path segments plus a hash suffix", () =>
    Effect.gen(function* () {
      const cwdBucket = yield* makeCwdBucket;
      const bucket = yield* cwdBucket("/Users/cvr/Developer/personal/counsel");
      expect(bucket).toMatch(/^personal-counsel-[a-f0-9]{8}$/);
    }).pipe(Effect.provide(BunCrypto.layerDigest)),
  );

  it.effect("differentiates paths with identical tails via hash", () =>
    Effect.gen(function* () {
      const cwdBucket = yield* makeCwdBucket;
      const a = yield* cwdBucket("/a/personal/counsel");
      const b = yield* cwdBucket("/b/personal/counsel");
      expect(a).not.toBe(b);
      expect(a.replace(/-[a-f0-9]{8}$/, "")).toBe(b.replace(/-[a-f0-9]{8}$/, ""));
    }).pipe(Effect.provide(BunCrypto.layerDigest)),
  );

  it.effect("handles root path with no segments", () =>
    Effect.gen(function* () {
      const cwdBucket = yield* makeCwdBucket;
      const bucket = yield* cwdBucket("/");
      expect(bucket).toMatch(/^[a-f0-9]{8}$/);
    }).pipe(Effect.provide(BunCrypto.layerDigest)),
  );

  it.effect("normalizes trailing slashes", () =>
    Effect.gen(function* () {
      const cwdBucket = yield* makeCwdBucket;
      expect(yield* cwdBucket("/a/b/")).toBe(yield* cwdBucket("/a/b"));
    }).pipe(Effect.provide(BunCrypto.layerDigest)),
  );

  it.effect("slugifies special characters", () =>
    Effect.gen(function* () {
      const cwdBucket = yield* makeCwdBucket;
      const bucket = yield* cwdBucket("/Users/cvr/my project!");
      expect(bucket).toMatch(/^cvr-my-project-[a-f0-9]{8}$/);
    }).pipe(Effect.provide(BunCrypto.layerDigest)),
  );

  it.effect("handles single segment paths", () =>
    Effect.gen(function* () {
      const cwdBucket = yield* makeCwdBucket;
      const bucket = yield* cwdBucket("/projects");
      expect(bucket).toMatch(/^projects-[a-f0-9]{8}$/);
    }).pipe(Effect.provide(BunCrypto.layerDigest)),
  );

  it.effect("normalizes Windows backslashes to forward slashes", () =>
    Effect.gen(function* () {
      const cwdBucket = yield* makeCwdBucket;
      expect(yield* cwdBucket("C:\\Users\\cvr\\project")).toBe(
        yield* cwdBucket("C:/Users/cvr/project"),
      );
    }).pipe(Effect.provide(BunCrypto.layerDigest)),
  );

  it.effect("preserves the recorded bucket format", () =>
    Effect.gen(function* () {
      const cwdBucket = yield* makeCwdBucket;
      for (const [cwd, expected] of [
        ["/Users/cvr/Developer/personal/counsel", "personal-counsel-897d3854"],
        ["/", "e3b0c442"],
        ["/Users/cvr/café 🌿/", "cvr-caf-004fe551"],
      ] as const) {
        expect(yield* cwdBucket(cwd)).toBe(expected);
      }
    }).pipe(Effect.provide(BunCrypto.layerDigest)),
  );
});
