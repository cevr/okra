import { describe, expect, it } from "effect-bun-test";
import { BunCrypto, BunServices } from "@effect/platform-bun";
import { ConfigProvider, Effect, FileSystem, Layer, Option, Result } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { runAdd } from "../../../src/skills/commands/add.js";
import { GitHub, GitHubHttp } from "../../../src/skills/services/GitHub.js";
import { SkillStoreLive } from "../../../src/skills/services/SkillStore.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { repoResponse, binary } from "../test-utils/github.js";

const providerPath = ".agents/skills/domain";
const realPath = "packages/domain/skills/domain";
const httpLayer = (respond: (url: string) => Response) =>
  GitHubHttp.layer.pipe(
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, respond(request.url))),
        ),
      ),
    ),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  );

describe("GitHub HTTP skill downloads", () => {
  it.effect(
    "downloads resolved regular files from raw URLs at the requested ref and only link texts from blobs",
    () => {
      const calls: Array<string> = [];
      const respond = repoResponse();
      return Effect.gen(function* () {
        const github = yield* GitHubHttp;
        const files = yield* github.fetchSkillDir("acme", "repo", providerPath, "release");
        expect(files.map((file) => file.path)).toEqual([
          "SKILL.md",
          "references/guide.md",
          "references/nested/data.bin",
        ]);
        expect(files[2]?.content).toEqual(binary);
        expect(
          calls
            .filter((url) => url.includes("/git/blobs/"))
            .map((url) => decodeURIComponent(new URL(url).pathname.split("/git/blobs/")[1] ?? "")),
        ).toEqual([`${providerPath}/SKILL.md`, `${providerPath}/references`]);
        expect(
          calls.filter((url) => new URL(url).hostname === "raw.githubusercontent.com").sort(),
        ).toEqual([
          `https://raw.githubusercontent.com/acme/repo/release/${realPath}/SKILL.md`,
          `https://raw.githubusercontent.com/acme/repo/release/${realPath}/references/guide.md`,
          `https://raw.githubusercontent.com/acme/repo/release/${realPath}/references/nested/data.bin`,
        ]);
      }).pipe(
        Effect.provide(
          httpLayer((url) => {
            calls.push(url);
            return respond(url);
          }),
        ),
      );
    },
  );

  for (const endpoint of ["raw", "blob"] as const) {
    for (const status of [403, 404]) {
      it.scoped(
        `${endpoint} HTTP ${status} fails typed with the repository path and installs nothing`,
        () =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const dir = yield* fs.makeTempDirectoryScoped();
            const respond = repoResponse();
            let failedPath = `${realPath}/references/guide.md`;
            if (endpoint === "blob") failedPath = `${providerPath}/SKILL.md`;
            const transport = httpLayer((urlString) => {
              const url = new URL(urlString);
              if (
                (endpoint === "raw" &&
                  url.hostname === "raw.githubusercontent.com" &&
                  url.pathname.endsWith(failedPath)) ||
                (endpoint === "blob" && url.pathname.endsWith("/git/blobs/link-sha"))
              ) {
                return new Response("remote error body must not be installed", { status });
              }
              if (endpoint === "blob" && url.pathname.includes("/git/trees/")) {
                const tree = [
                  { path: providerPath, type: "tree", mode: "040000", sha: "dir-sha" },
                  { path: failedPath, type: "blob", mode: "120000", sha: "link-sha" },
                ];
                return Response.json({ tree, truncated: false });
              }
              return respond(urlString);
            });
            const layer = SkillLockLive.pipe(
              Layer.provideMerge(SkillStoreLive),
              Layer.provideMerge(
                Layer.effect(GitHub, GitHubHttp).pipe(Layer.provideMerge(transport)),
              ),
              Layer.provideMerge(BunServices.layer),
              Layer.provideMerge(BunCrypto.layerDigest),
              Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
            );
            yield* Effect.gen(function* () {
              const github = yield* GitHubHttp;
              const result = yield* github
                .fetchSkillDir("acme", "repo", providerPath)
                .pipe(Effect.result);
              expect(Result.isFailure(result)).toBe(true);
              if (Result.isFailure(result)) {
                expect(result.failure._tag).toBe("@cvr/okra/skills/SkillsError");
                expect(result.failure.code).toBe("FETCH_FAILED");
                expect(result.failure.message).toContain(failedPath);
                expect(result.failure.message).toContain(String(status));
              }
              yield* runAdd([`https://github.com/acme/repo/tree/main/${providerPath}`]);
              expect(yield* fs.exists(`${dir}/domain`)).toBe(false);
              const lock = yield* SkillLock;
              expect(Option.isNone(yield* lock.get("domain"))).toBe(true);
            }).pipe(Effect.provide(layer));
          }).pipe(Effect.provide(BunServices.layer)),
      );
    }
  }
});
