import { describe, expect, it } from "effect-bun-test";
import { Effect, Layer, Result, Sink, Stream } from "effect";
import * as Spawner from "effect/process/ChildProcessSpawner";
import { discoverFromTree, GitHubCli, GitHubHttp } from "../../../src/skills/services/GitHub.js";

import { repoLayer, repoResponse, skillMd, binary } from "../test-utils/github.js";

describe("GitHub skill symlinks", () => {
  it.effect("prefers the real SKILL.md over a provider symlink copy", () =>
    Effect.gen(function* () {
      const github = yield* GitHubHttp;
      expect(yield* github.discoverSkills("acme", "repo")).toEqual([
        {
          dirName: "domain",
          skillMdPath: "packages/domain/skills/domain/SKILL.md",
          skillDir: "packages/domain/skills/domain",
        },
      ]);
    }).pipe(Effect.provide(repoLayer())),
  );

  it.effect("prefers a real copy over a SKILL.md beneath a symlink ancestor", () =>
    Effect.sync(() => {
      expect(
        discoverFromTree([
          { path: "skills", type: "blob", mode: "120000" },
          { path: "skills/domain/SKILL.md", type: "blob", mode: "100644" },
          { path: "packages/domain/skills/domain/SKILL.md", type: "blob", mode: "100644" },
        ]),
      ).toEqual([
        {
          dirName: "domain",
          skillMdPath: "packages/domain/skills/domain/SKILL.md",
          skillDir: "packages/domain/skills/domain",
        },
      ]);
    }),
  );

  it.effect("keeps a real unprefixed copy discoverable alongside other prefixed skills", () =>
    Effect.sync(() => {
      expect(
        discoverFromTree([
          { path: "skills/domain/SKILL.md", type: "blob", mode: "120000" },
          { path: "package/domain/SKILL.md", type: "blob", mode: "100644" },
          { path: "skills/other/SKILL.md", type: "blob", mode: "100644" },
        ]),
      ).toEqual([
        { dirName: "domain", skillMdPath: "package/domain/SKILL.md", skillDir: "package/domain" },
        { dirName: "other", skillMdPath: "skills/other/SKILL.md", skillDir: "skills/other" },
      ]);
    }),
  );

  it.effect(
    "materializes file and directory links at their installed paths with binary bytes intact",
    () =>
      Effect.gen(function* () {
        const github = yield* GitHubHttp;
        expect(yield* github.fetchSkillDir("acme", "repo", ".agents/skills/domain")).toEqual([
          { path: "SKILL.md", content: new TextEncoder().encode(skillMd) },
          { path: "references/guide.md", content: new TextEncoder().encode("guide") },
          { path: "references/nested/data.bin", content: binary },
        ]);
      }).pipe(Effect.provide(repoLayer())),
  );

  it.effect("completes a truncated tree using subtree requests before resolving links", () =>
    Effect.gen(function* () {
      const github = yield* GitHubHttp;
      const files = yield* github.fetchSkillDir("acme", "repo", ".agents/skills/domain");
      expect(files.map((file) => file.path)).toEqual([
        "SKILL.md",
        "references/guide.md",
        "references/nested/data.bin",
      ]);
      expect(files[2]?.content).toEqual(binary);
    }).pipe(Effect.provide(repoLayer({}, true))),
  );

  it.effect(
    "resolves a directory link in the requested skill path and normalizes relative targets",
    () =>
      Effect.gen(function* () {
        const github = yield* GitHubHttp;
        expect(
          yield* github.fetchSkillDir("acme", "repo", ".agents/skills/alias/./references/"),
        ).toEqual([
          { path: "guide.md", content: new TextEncoder().encode("guide") },
          { path: "nested/data.bin", content: binary },
        ]);
      }).pipe(
        Effect.provide(
          repoLayer({
            ".agents/skills/alias": "../../packages/domain/skills/./domain",
          }),
        ),
      ),
  );

  it.effect("follows chained directory links and preserves the suffix below a link", () =>
    Effect.gen(function* () {
      const github = yield* GitHubHttp;
      expect(yield* github.fetchSkillDir("acme", "repo", ".agents/skills/domain")).toEqual([
        { path: "SKILL.md", content: new TextEncoder().encode(skillMd) },
        { path: "references/data.bin", content: binary },
      ]);
    }).pipe(
      Effect.provide(
        repoLayer({
          ".agents/skills/domain/references": "../shared/nested",
          ".agents/skills/shared": "../../packages/domain/skills/domain/references",
        }),
      ),
    ),
  );

  it.scoped("gh reads link text from git blobs rather than dereferenced Contents responses", () => {
    const respond = repoResponse();
    return Effect.gen(function* () {
      const github = yield* GitHubCli;
      const files = yield* github.fetchSkillDir("acme", "repo", ".agents/skills/domain");
      expect(files.map((file) => file.path)).toEqual([
        "SKILL.md",
        "references/guide.md",
        "references/nested/data.bin",
      ]);
      expect(files[2]?.content).toEqual(binary);
    }).pipe(
      Effect.provide(
        GitHubCli.layer.pipe(
          Layer.provide(
            Layer.succeed(
              Spawner.ChildProcessSpawner,
              Spawner.make((command) =>
                Effect.gen(function* () {
                  if (command._tag !== "StandardCommand")
                    return yield* Effect.die("Unexpected pipeline");
                  const endpoint = command.args.at(-1);
                  if (typeof endpoint !== "string") return yield* Effect.die("Missing endpoint");
                  const response = respond(`https://api.github.com/${endpoint}`);
                  const output = new Uint8Array(
                    yield* Effect.promise(() => response.arrayBuffer()),
                  );
                  return Spawner.makeHandle({
                    pid: Spawner.ProcessId(1),
                    exitCode: Effect.succeed(Spawner.ExitCode(0)),
                    isRunning: Effect.succeed(false),
                    kill: () => Effect.void,
                    stdin: Sink.drain,
                    stdout: Stream.make(output),
                    stderr: Stream.empty,
                    all: Stream.empty,
                    getInputFd: () => Sink.drain,
                    getOutputFd: () => Stream.empty,
                    unref: Effect.succeed(Effect.void),
                  });
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  for (const [reason, target] of [
    ["escapes the repo root", "../../../../outside"],
    ["is dangling", "../../../missing"],
    ["is absolute", "/outside"],
    ["is cyclic", "references"],
    ["links to an ancestor directory", "."],
    ["points at a submodule", "../../../submodules/vendor"],
  ] as const) {
    it.effect(`fails with a typed path error when a link ${reason}`, () =>
      Effect.gen(function* () {
        const github = yield* GitHubHttp;
        const result = yield* github
          .fetchSkillDir("acme", "repo", ".agents/skills/domain")
          .pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe("@cvr/okra/skills/SkillsError");
          expect(result.failure.code).toBe("INVALID_SYMLINK");
          expect(result.failure.message).toContain(".agents/skills/domain/references");
        }
      }).pipe(Effect.provide(repoLayer({ ".agents/skills/domain/references": target }))),
    );
  }
});
