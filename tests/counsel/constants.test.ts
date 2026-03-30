import { describe, expect, test } from "bun:test";
import { cwdBucket } from "../../src/counsel/constants.js";

describe("cwdBucket", () => {
  test("is deterministic for the same input", () => {
    const a = cwdBucket("/Users/cvr/Developer/personal/counsel");
    const b = cwdBucket("/Users/cvr/Developer/personal/counsel");
    expect(a).toBe(b);
  });

  test("uses last 2 path segments plus a hash suffix", () => {
    const bucket = cwdBucket("/Users/cvr/Developer/personal/counsel");
    expect(bucket).toMatch(/^personal-counsel-[a-f0-9]{8}$/);
  });

  test("differentiates paths with identical tails via hash", () => {
    const a = cwdBucket("/a/personal/counsel");
    const b = cwdBucket("/b/personal/counsel");
    expect(a).not.toBe(b);
    expect(a.replace(/-[a-f0-9]{8}$/, "")).toBe(b.replace(/-[a-f0-9]{8}$/, ""));
  });

  test("handles root path with no segments", () => {
    const bucket = cwdBucket("/");
    expect(bucket).toMatch(/^[a-f0-9]{8}$/);
  });

  test("normalizes trailing slashes", () => {
    expect(cwdBucket("/a/b/")).toBe(cwdBucket("/a/b"));
  });

  test("slugifies special characters", () => {
    const bucket = cwdBucket("/Users/cvr/my project!");
    expect(bucket).toMatch(/^cvr-my-project-[a-f0-9]{8}$/);
  });

  test("handles single segment paths", () => {
    const bucket = cwdBucket("/projects");
    expect(bucket).toMatch(/^projects-[a-f0-9]{8}$/);
  });

  test("normalizes Windows backslashes to forward slashes", () => {
    expect(cwdBucket("C:\\Users\\cvr\\project")).toBe(cwdBucket("C:/Users/cvr/project"));
  });
});
