// @effect-diagnostics strictEffectProvide:off
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "effect-bun-test";
import { runCli } from "../../src/repo/test-utils/index.js";

describe("fetch command", () => {
  describe("fresh fetch", () => {
    it.effect("fetches a GitHub repo", () =>
      runCli("fetch vercel/next.js", {}).expectSequence([
        { service: "registry", method: "parseSpec", match: { input: "vercel/next.js" } },
        { service: "metadata", method: "find" },
        { service: "cache", method: "getPath" },
        { service: "cache", method: "ensureDir" },
        { service: "registry", method: "fetch" },
        { service: "cache", method: "getSize" },
        { service: "git", method: "isGitRepo" },
        { service: "metadata", method: "add" },
      ]),
    );

    it.effect("fetches an npm package", () =>
      runCli("fetch npm:lodash@4.17.21", {}).expectSequence([
        { service: "registry", method: "parseSpec", match: { input: "npm:lodash@4.17.21" } },
        { service: "metadata", method: "find" },
        { service: "cache", method: "getPath" },
        { service: "cache", method: "ensureDir" },
        { service: "registry", method: "fetch" },
        { service: "cache", method: "getSize" },
        { service: "metadata", method: "add" },
      ]),
    );
  });

  describe("existing repo", () => {
    it.effect("updates existing git repo when already cached", () =>
      Effect.gen(function* () {
        const spec = {
          registry: "github" as const,
          name: "vercel/next.js",
          version: Option.none<string>(),
        };

        const gitState = new Map([
          ["/tmp/test-repo-cache/vercel/next.js", { url: "https://github.com/vercel/next.js.git" }],
        ]);

        const sequence = yield* runCli("fetch vercel/next.js", {
          git: { clonedRepos: gitState },
          metadata: {
            index: {
              version: 1,
              repos: [
                {
                  spec,
                  fetchedAt: new Date().toISOString(),
                  lastAccessedAt: new Date().toISOString(),
                  sizeBytes: 1000,
                  path: "/tmp/test-repo-cache/vercel/next.js",
                },
              ],
            },
          },
        }).getSequence();

        expect(sequence.some((c) => c.service === "metadata" && c.method === "find")).toBe(true);
        expect(sequence.some((c) => c.service === "git" && c.method === "isGitRepo")).toBe(true);
        expect(sequence.some((c) => c.service === "git" && c.method === "update")).toBe(true);
        expect(sequence.some((c) => c.service === "metadata" && c.method === "add")).toBe(true);
        expect(sequence.some((c) => c.service === "registry" && c.method === "fetch")).toBe(false);
      }),
    );

    it.effect("force re-fetches when --force is used", () =>
      Effect.gen(function* () {
        const spec = {
          registry: "github" as const,
          name: "vercel/next.js",
          version: Option.none<string>(),
        };

        const sequence = yield* runCli("fetch -f vercel/next.js", {
          metadata: {
            index: {
              version: 1,
              repos: [
                {
                  spec,
                  fetchedAt: new Date().toISOString(),
                  lastAccessedAt: new Date().toISOString(),
                  sizeBytes: 1000,
                  path: "/tmp/test-repo-cache/vercel/next.js",
                },
              ],
            },
          },
        }).getSequence();

        expect(sequence.some((c) => c.service === "cache" && c.method === "remove")).toBe(true);
        expect(sequence.some((c) => c.service === "metadata" && c.method === "remove")).toBe(true);
        expect(sequence.some((c) => c.service === "registry" && c.method === "fetch")).toBe(true);
      }),
    );
  });
});

describe("list command", () => {
  it.effect("lists all cached repos", () =>
    runCli("list", {}).expectSequence([{ service: "metadata", method: "all" }]),
  );

  it.effect("filters by registry", () =>
    runCli("list -r npm", {}).expectSequence([{ service: "metadata", method: "all" }]),
  );
});

describe("remove command", () => {
  it.effect("removes a cached repo", () =>
    Effect.gen(function* () {
      const spec = {
        registry: "github" as const,
        name: "owner/repo",
        version: Option.none<string>(),
      };

      const sequence = yield* runCli("remove owner/repo", {
        metadata: {
          index: {
            version: 1,
            repos: [
              {
                spec,
                fetchedAt: new Date().toISOString(),
                lastAccessedAt: new Date().toISOString(),
                sizeBytes: 1000,
                path: "/tmp/test-repo-cache/owner/repo",
              },
            ],
          },
        },
      }).getSequence();

      expect(sequence.some((c) => c.service === "registry" && c.method === "parseSpec")).toBe(true);
      expect(sequence.some((c) => c.service === "metadata" && c.method === "find")).toBe(true);
      expect(sequence.some((c) => c.service === "cache" && c.method === "remove")).toBe(true);
      expect(sequence.some((c) => c.service === "metadata" && c.method === "remove")).toBe(true);
    }),
  );
});

describe("clean command", () => {
  it.effect("removes all cached repos with --all --yes", () =>
    Effect.gen(function* () {
      const spec = {
        registry: "github" as const,
        name: "owner/repo",
        version: Option.none<string>(),
      };

      const sequence = yield* runCli("clean --all -y", {
        metadata: {
          index: {
            version: 1,
            repos: [
              {
                spec,
                fetchedAt: new Date().toISOString(),
                lastAccessedAt: new Date().toISOString(),
                sizeBytes: 1000,
                path: "/tmp/test-repo-cache/owner/repo",
              },
            ],
          },
        },
      }).getSequence();

      expect(sequence.some((c) => c.service === "metadata" && c.method === "all")).toBe(true);
      expect(sequence.some((c) => c.service === "cache" && c.method === "removeAll")).toBe(true);
      expect(sequence.some((c) => c.service === "metadata" && c.method === "save")).toBe(true);
    }),
  );

  it.effect("does nothing when cache is empty with --all --yes", () =>
    runCli("clean --all -y", {}).expectSequence([{ service: "metadata", method: "all" }]),
  );

  it.effect("prunes by days", () =>
    Effect.gen(function* () {
      // TestClock starts at epoch 0 — advance to real wall time
      yield* TestClock.setTime(Date.now());

      const oldSpec = {
        registry: "github" as const,
        name: "old/repo",
        version: Option.none<string>(),
      };
      const newSpec = {
        registry: "github" as const,
        name: "new/repo",
        version: Option.none<string>(),
      };
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const nowDate = new Date().toISOString();

      const sequence = yield* runCli("clean --days=30", {
        metadata: {
          index: {
            version: 1,
            repos: [
              {
                spec: oldSpec,
                fetchedAt: oldDate,
                lastAccessedAt: oldDate,
                sizeBytes: 1000,
                path: "/tmp/test-repo-cache/old/repo",
              },
              {
                spec: newSpec,
                fetchedAt: nowDate,
                lastAccessedAt: nowDate,
                sizeBytes: 1000,
                path: "/tmp/test-repo-cache/new/repo",
              },
            ],
          },
        },
      }).getSequence();

      expect(sequence.some((c) => c.service === "metadata" && c.method === "all")).toBe(true);
      // Should remove old repo but not new
      const removeCalls = sequence.filter((c) => c.service === "cache" && c.method === "remove");
      expect(removeCalls.length).toBe(1);
    }),
  );
});

describe("path command", () => {
  it.effect("returns path for cached repo (pure lookup, no network)", () =>
    Effect.gen(function* () {
      const spec = {
        registry: "github" as const,
        name: "owner/repo",
        version: Option.none<string>(),
      };

      const sequence = yield* runCli("path owner/repo", {
        metadata: {
          index: {
            version: 1,
            repos: [
              {
                spec,
                fetchedAt: new Date().toISOString(),
                lastAccessedAt: new Date().toISOString(),
                sizeBytes: 1000,
                path: "/tmp/test-repo-cache/owner/repo",
              },
            ],
          },
        },
      }).getSequence();

      expect(sequence.some((c) => c.service === "registry" && c.method === "parseSpec")).toBe(true);
      expect(sequence.some((c) => c.service === "metadata" && c.method === "find")).toBe(true);
      // Should NOT do any git operations
      expect(sequence.some((c) => c.service === "git")).toBe(false);
    }),
  );
});

describe("sequence verification", () => {
  it.effect("verifies exact call order", () =>
    runCli("fetch npm:effect", {}).expectSequence([
      { service: "registry", method: "parseSpec" },
      { service: "metadata", method: "find" },
      { service: "cache", method: "getPath" },
      { service: "cache", method: "ensureDir" },
      { service: "registry", method: "fetch" },
      { service: "cache", method: "getSize" },
      { service: "metadata", method: "add" },
    ]),
  );

  it.effect("can inspect full sequence for custom assertions", () =>
    Effect.gen(function* () {
      const sequence = yield* runCli("list", {}).getSequence();

      expect(sequence.length).toBeGreaterThan(0);
      expect(sequence[0]?.service).toBe("metadata");
      expect(sequence[0]?.method).toBe("all");
    }),
  );
});
