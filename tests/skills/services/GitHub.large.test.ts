import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Fiber, Layer, Result, Sink, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Spawner from "effect/process/ChildProcessSpawner";
import { TestClock } from "effect/testing";
import { GitHubCli, GitHubHttp } from "../../../src/skills/services/GitHub.js";

const UNRELATED_DIRS = 300;

const dirPrefix = (dir: string): string => {
  if (dir) return `${dir}/`;
  return "";
};

const contentType = { tree: "dir", blob: "file" } as const;

const largeRepo = () => {
  const files = new Map<string, string>([
    ["skills/gog/SKILL.md", "---\nname: gog\ndescription: test\n---\n"],
    ["skills/gog/references/usage.md", "usage"],
    ["skills/other/SKILL.md", "---\nname: other\ndescription: test\n---\n"],
  ]);
  for (let i = 0; i < UNRELATED_DIRS; i++) files.set(`extensions/ext${i}/src/index.ts`, "x");
  const entries = new Map<
    string,
    { path: string; type: "blob" | "tree"; mode: string; sha: string }
  >();
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      entries.set(dir, { path: dir, type: "tree", mode: "040000", sha: dir });
    }
    entries.set(path, { path, type: "blob", mode: "100644", sha: path });
  }
  const requests: Array<string> = [];
  const respond = (requestUrl: string): Response => {
    requests.push(requestUrl);
    const url = new URL(requestUrl);
    if (url.hostname === "raw.githubusercontent.com") {
      const content = files.get(url.pathname.split("/").slice(4).join("/"));
      if (content === undefined) return new Response("missing", { status: 404 });
      return new Response(content);
    }
    if (url.pathname.includes("/git/trees/")) {
      let sha = decodeURIComponent(url.pathname.split("/git/trees/")[1] ?? "");
      if (sha === "main") sha = "";
      const recursive = url.searchParams.has("recursive");
      if (sha === "" && recursive) return Response.json({ tree: [], truncated: true });
      const prefix = dirPrefix(sha);
      const tree = [...entries.values()]
        .filter((entry) => entry.path.startsWith(prefix))
        .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length) }))
        .filter((entry) => recursive || !entry.path.includes("/"));
      return Response.json({ tree, truncated: false });
    }
    if (url.pathname.includes("/contents/")) {
      const dir = decodeURIComponent(url.pathname.split("/contents/")[1] ?? "");
      const prefix = dirPrefix(dir);
      const listing = [...entries.values()]
        .filter((entry) => entry.path.startsWith(prefix))
        .filter((entry) => !entry.path.slice(prefix.length).includes("/"))
        .map((entry) => ({
          name: entry.path.slice(prefix.length),
          path: entry.path,
          type: contentType[entry.type],
        }));
      if (listing.length === 0) return new Response("missing", { status: 404 });
      return Response.json(listing);
    }
    return new Response("unexpected request", { status: 404 });
  };
  return { respond, requests };
};

const httpLayer = (client: HttpClient.HttpClient) =>
  GitHubHttp.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  );

const largeRepoLayer = (respond: (url: string) => Response) =>
  httpLayer(
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, respond(request.url))),
    ),
  );

describe("GitHub on a repository too large for one recursive tree", () => {
  it.effect("fetches a skill without walking unrelated directories", () => {
    const { respond, requests } = largeRepo();
    return Effect.gen(function* () {
      const github = yield* GitHubHttp;
      const files = yield* github.fetchSkillDir("acme", "big", "skills/gog");
      expect(files.map((file) => file.path).sort()).toEqual(["SKILL.md", "references/usage.md"]);
      expect(requests.filter((url) => url.includes("extensions"))).toEqual([]);
      expect(requests.filter((url) => url.includes("/git/trees/")).length).toBeLessThanOrEqual(6);
    }).pipe(Effect.provide(largeRepoLayer(respond)));
  });

  it.effect("discovers skills without walking unrelated directories", () => {
    const { respond, requests } = largeRepo();
    return Effect.gen(function* () {
      const github = yield* GitHubHttp;
      const skills = yield* github.discoverSkills("acme", "big");
      expect(skills.map((skill) => skill.skillDir).sort()).toEqual(["skills/gog", "skills/other"]);
      expect(requests.filter((url) => url.includes("extensions"))).toEqual([]);
    }).pipe(Effect.provide(largeRepoLayer(respond)));
  });
});

const expectTimedOut = (result: Result.Result<unknown, { code: string; message: string }>) => {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure.code).toBe("FETCH_FAILED");
    expect(result.failure.message).toContain("timed out");
  }
};

describe("GitHub request timeouts", () => {
  it.effect("fails an HTTP request that never answers instead of hanging", () =>
    Effect.gen(function* () {
      const github = yield* GitHubHttp;
      const fiber = yield* github
        .fetchRaw("acme", "repo", "skills/x/SKILL.md")
        .pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("2 minutes");
      const exit = fiber.pollUnsafe();
      expect(exit).toBeDefined();
      expectTimedOut(yield* Fiber.join(fiber));
    }).pipe(Effect.provide(httpLayer(HttpClient.make(() => Effect.never)))),
  );

  it.effect("kills a gh call that never exits and runs gh without prompts", () => {
    const commands: Array<unknown> = [];
    let released = 0;
    const spawner = Spawner.make((command) =>
      Effect.gen(function* () {
        commands.push(command);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            released++;
          }),
        );
        return Spawner.makeHandle({
          pid: Spawner.ProcessId(1),
          exitCode: Effect.never,
          isRunning: Effect.succeed(true),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.never,
          stderr: Stream.never,
          all: Stream.never,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
    );
    return Effect.gen(function* () {
      const github = yield* GitHubCli;
      const fiber = yield* github
        .run(["api", "repos/acme/repo"])
        .pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("2 minutes");
      const exit = fiber.pollUnsafe();
      expect(exit).toBeDefined();
      expectTimedOut(yield* Fiber.join(fiber));
      expect(released).toBeGreaterThan(0);
      const command = commands[0] as { options: { env?: Record<string, string> } };
      expect(command.options.env?.["GH_PROMPT_DISABLED"]).toBe("1");
    }).pipe(
      Effect.provide(
        GitHubCli.layer.pipe(Layer.provide(Layer.succeed(Spawner.ChildProcessSpawner, spawner))),
      ),
    );
  });
});
