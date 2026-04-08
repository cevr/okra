// @effect-diagnostics strictEffectProvide:off
import { Effect, Option } from "effect";
import { describe, expect, it } from "effect-bun-test";
import { createTestLayer } from "../../src/repo/test-utils/index.js";
import { RegistryService } from "../../src/repo/services/registry.js";
import { GitService } from "../../src/repo/services/git.js";
import { CacheService } from "../../src/repo/services/cache.js";
import { MetadataService } from "../../src/repo/services/metadata.js";
import { specToString } from "../../src/repo/types.js";

describe("fetch flow", () => {
  it.effect("fetches a GitHub repo and adds it to metadata", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;

        const spec = yield* registry.parseSpec("vercel/next.js");
        expect(spec.registry).toBe("github");
        expect(spec.name).toBe("vercel/next.js");

        const destPath = yield* cache.getPath(spec);
        expect(destPath).toContain("vercel/next.js");

        yield* registry.fetch(spec, destPath);

        const now = new Date().toISOString();
        yield* metadata.add({
          spec,
          fetchedAt: now,
          lastAccessedAt: now,
          sizeBytes: 1000,
          path: destPath,
        });

        const found = Option.getOrNull(yield* metadata.find(spec));
        expect(found).not.toBeNull();
        expect(found?.path).toBe(destPath);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("fetches an npm package with version", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;

        const spec = yield* registry.parseSpec("npm:lodash@4.17.21");
        expect(spec.registry).toBe("npm");
        expect(spec.name).toBe("lodash");
        expect(Option.getOrNull(spec.version)).toBe("4.17.21");

        const destPath = yield* cache.getPath(spec);
        expect(destPath).toContain("lodash");
        expect(destPath).toContain("4.17.21");

        yield* registry.fetch(spec, destPath);
        yield* metadata.add({
          spec,
          fetchedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          sizeBytes: 500,
          path: destPath,
        });

        const found = Option.getOrNull(yield* metadata.find(spec));
        expect(found?.spec.name).toBe("lodash");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("fetches a scoped npm package", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;

        const spec = yield* registry.parseSpec("npm:@effect/cli@0.73.0");
        expect(spec.registry).toBe("npm");
        expect(spec.name).toBe("@effect/cli");
        expect(Option.getOrNull(spec.version)).toBe("0.73.0");

        const destPath = yield* cache.getPath(spec);
        expect(destPath).toContain("@effect/cli");
        expect(destPath).toContain("0.73.0");
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("list flow", () => {
  it.effect("lists all cached repos", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;

        const specs = [
          yield* registry.parseSpec("vercel/next.js"),
          yield* registry.parseSpec("npm:effect@3.0.0"),
          yield* registry.parseSpec("pypi:requests"),
        ];

        for (const spec of specs) {
          const destPath = yield* cache.getPath(spec);
          yield* registry.fetch(spec, destPath);
          yield* metadata.add({
            spec,
            fetchedAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            sizeBytes: 1000,
            path: destPath,
          });
        }

        const all = yield* metadata.all();
        expect(all.length).toBe(3);

        const registries = all.map((r) => r.spec.registry);
        expect(registries).toContain("github");
        expect(registries).toContain("npm");
        expect(registries).toContain("pypi");
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("remove flow", () => {
  it.effect("removes a cached repo", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;

        const spec = yield* registry.parseSpec("owner/repo");
        const destPath = yield* cache.getPath(spec);
        yield* registry.fetch(spec, destPath);
        yield* metadata.add({
          spec,
          fetchedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          sizeBytes: 1000,
          path: destPath,
        });

        const before = yield* metadata.find(spec);
        expect(Option.isSome(before)).toBe(true);

        yield* cache.remove(destPath);
        const removed = yield* metadata.remove(spec);
        expect(removed).toBe(true);

        const after = yield* metadata.find(spec);
        expect(Option.isNone(after)).toBe(true);
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("clean flow", () => {
  it.effect("removes all cached repos", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;

        const specs = [
          yield* registry.parseSpec("a/b"),
          yield* registry.parseSpec("c/d"),
          yield* registry.parseSpec("npm:pkg"),
        ];

        for (const spec of specs) {
          const destPath = yield* cache.getPath(spec);
          yield* registry.fetch(spec, destPath);
          yield* metadata.add({
            spec,
            fetchedAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            sizeBytes: 100,
            path: destPath,
          });
        }

        const before = yield* metadata.all();
        expect(before.length).toBe(3);

        yield* cache.removeAll();
        for (const spec of specs) {
          yield* metadata.remove(spec);
        }

        const after = yield* metadata.all();
        expect(after.length).toBe(0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("filters repos by age for prune", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;

        const oldSpec = yield* registry.parseSpec("old/repo");
        const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        yield* metadata.add({
          spec: oldSpec,
          fetchedAt: oldDate.toISOString(),
          lastAccessedAt: oldDate.toISOString(),
          sizeBytes: 1000,
          path: yield* cache.getPath(oldSpec),
        });

        const newSpec = yield* registry.parseSpec("new/repo");
        yield* metadata.add({
          spec: newSpec,
          fetchedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          sizeBytes: 1000,
          path: yield* cache.getPath(newSpec),
        });

        const all = yield* metadata.all();
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const oldRepos = all.filter((r) => new Date(r.lastAccessedAt).getTime() < cutoff);
        expect(oldRepos.length).toBe(1);
        expect(oldRepos[0]?.spec.name).toBe("old/repo");

        for (const repo of oldRepos) {
          yield* cache.remove(repo.path);
          yield* metadata.remove(repo.spec);
        }

        const remaining = yield* metadata.all();
        expect(remaining.length).toBe(1);
        expect(remaining[0]?.spec.name).toBe("new/repo");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("filters repos by size for prune", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;

        const largeSpec = yield* registry.parseSpec("large/repo");
        yield* metadata.add({
          spec: largeSpec,
          fetchedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          sizeBytes: 100_000_000,
          path: yield* cache.getPath(largeSpec),
        });

        const smallSpec = yield* registry.parseSpec("small/repo");
        yield* metadata.add({
          spec: smallSpec,
          fetchedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          sizeBytes: 1_000_000,
          path: yield* cache.getPath(smallSpec),
        });

        const all = yield* metadata.all();
        const largeRepos = all.filter((r) => r.sizeBytes > 50_000_000);
        expect(largeRepos.length).toBe(1);
        expect(largeRepos[0]?.spec.name).toBe("large/repo");
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("update flow", () => {
  it.effect("updates access time when repo is re-fetched", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;

        const spec = yield* registry.parseSpec("owner/repo");
        const destPath = yield* cache.getPath(spec);
        const initialTime = new Date(Date.now() - 1000).toISOString();
        yield* metadata.add({
          spec,
          fetchedAt: initialTime,
          lastAccessedAt: initialTime,
          sizeBytes: 1000,
          path: destPath,
        });

        yield* metadata.updateAccessTime(spec);

        const found = Option.getOrNull(yield* metadata.find(spec));
        expect(found).not.toBeNull();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(new Date(found!.lastAccessedAt).getTime()).toBeGreaterThan(
          new Date(initialTime).getTime(),
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(found!.fetchedAt).toBe(initialTime);
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("spec parsing", () => {
  it.effect("parses various spec formats correctly", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;

        const github1 = yield* registry.parseSpec("vercel/next.js");
        expect(specToString(github1)).toBe("vercel/next.js");

        const github2 = yield* registry.parseSpec("vercel/next.js@v14.0.0");
        expect(specToString(github2)).toBe("vercel/next.js@v14.0.0");

        const npm1 = yield* registry.parseSpec("npm:lodash");
        expect(specToString(npm1)).toBe("npm:lodash");

        const npm2 = yield* registry.parseSpec("npm:lodash@4.17.21");
        expect(specToString(npm2)).toBe("npm:lodash@4.17.21");

        const npm3 = yield* registry.parseSpec("npm:@effect/cli@0.73.0");
        expect(specToString(npm3)).toBe("npm:@effect/cli@0.73.0");

        const pypi = yield* registry.parseSpec("pypi:requests@2.31.0");
        expect(specToString(pypi)).toBe("pypi:requests@2.31.0");

        const crates = yield* registry.parseSpec("crates:serde@1.0.0");
        expect(specToString(crates)).toBe("crates:serde@1.0.0");

        const bare = yield* registry.parseSpec("lodash");
        expect(bare.registry).toBe("npm");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("normalizes GitHub repo names to lowercase", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const metadata = yield* MetadataService;
        const cache = yield* CacheService;

        const spec1 = yield* registry.parseSpec("Vercel/Next.js");
        expect(spec1.name).toBe("vercel/next.js");

        const destPath = yield* cache.getPath(spec1);
        yield* metadata.add({
          spec: spec1,
          fetchedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          sizeBytes: 1000,
          path: destPath,
        });

        const spec2 = yield* registry.parseSpec("vercel/next.js");
        const spec3 = yield* registry.parseSpec("VERCEL/NEXT.JS");

        const found1 = yield* metadata.find(spec1);
        const found2 = yield* metadata.find(spec2);
        const found3 = yield* metadata.find(spec3);

        expect(Option.isSome(found1)).toBe(true);
        expect(Option.isSome(found2)).toBe(true);
        expect(Option.isSome(found3)).toBe(true);
        const f1 = Option.getOrNull(found1);
        const f2 = Option.getOrNull(found2);
        const f3 = Option.getOrNull(found3);
        expect(f1?.path).toBe(f2?.path);
        expect(f2?.path).toBe(f3?.path);
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("git operations", () => {
  it.effect("tracks cloned repos and checks if path is a git repo", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const git = yield* GitService;

        yield* git.clone("https://github.com/owner/repo.git", "/tmp/repo", {
          depth: 100,
        });

        const isGit = yield* git.isGitRepo("/tmp/repo");
        expect(isGit).toBe(true);

        const notGit = yield* git.isGitRepo("/tmp/other");
        expect(notGit).toBe(false);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("gets current ref from cloned repo", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const git = yield* GitService;

        yield* git.clone("https://github.com/owner/repo.git", "/tmp/repo");
        const ref = yield* git.getCurrentRef("/tmp/repo");
        expect(ref).toBe("v1.0.0");
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("path flow", () => {
  it.effect("returns path for cached repo", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;

        const spec = yield* registry.parseSpec("owner/repo");
        const destPath = yield* cache.getPath(spec);
        yield* registry.fetch(spec, destPath);
        yield* metadata.add({
          spec,
          fetchedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          sizeBytes: 1000,
          path: destPath,
        });

        const found = Option.getOrNull(yield* metadata.find(spec));
        expect(found).not.toBeNull();
        expect(found?.path).toBe(destPath);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("returns none for uncached repo", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const metadata = yield* MetadataService;

        const spec = yield* registry.parseSpec("nonexistent/repo");
        const found = yield* metadata.find(spec);
        expect(Option.isNone(found)).toBe(true);
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("integration flow", () => {
  it.effect("complete workflow: fetch, path, explore", () =>
    Effect.gen(function* () {
      const { layer } = createTestLayer();

      yield* Effect.gen(function* () {
        const registry = yield* RegistryService;
        const cache = yield* CacheService;
        const metadata = yield* MetadataService;
        const git = yield* GitService;

        const spec = yield* registry.parseSpec("vercel/next.js");
        expect(spec.registry).toBe("github");

        const beforeFetch = yield* metadata.find(spec);
        expect(Option.isNone(beforeFetch)).toBe(true);

        const destPath = yield* cache.getPath(spec);
        yield* registry.fetch(spec, destPath);
        yield* git.clone("https://github.com/vercel/next.js.git", destPath, {
          depth: 100,
        });

        const now = new Date().toISOString();
        yield* metadata.add({
          spec,
          fetchedAt: now,
          lastAccessedAt: now,
          sizeBytes: 50000,
          path: destPath,
        });

        const afterFetch = Option.getOrNull(yield* metadata.find(spec));
        expect(afterFetch).not.toBeNull();
        expect(afterFetch?.path).toBe(destPath);
        expect(destPath).toContain("vercel/next.js");

        expect(afterFetch?.sizeBytes).toBe(50000);
        const isGit = yield* git.isGitRepo(destPath);
        expect(isGit).toBe(true);

        const beforeUpdate = afterFetch?.lastAccessedAt;
        yield* metadata.updateAccessTime(spec);
        const updated = Option.getOrNull(yield* metadata.find(spec));
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(new Date(updated!.lastAccessedAt).getTime()).toBeGreaterThanOrEqual(
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          new Date(beforeUpdate!).getTime(),
        );

        const all = yield* metadata.all();
        expect(all.length).toBe(1);
        expect(all[0]?.spec.name).toBe("vercel/next.js");
      }).pipe(Effect.provide(layer));
    }),
  );
});
