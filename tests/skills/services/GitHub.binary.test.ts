import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Effect, Layer, Sink, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Spawner from "effect/process/ChildProcessSpawner";
import { GitHubCli, GitHubHttp } from "../../../src/skills/services/GitHub.js";

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0xfe]);

describe("GitHub binary downloads", () => {
  it.effect("HTTP preserves raw response bytes", () =>
    Effect.gen(function* () {
      const github = yield* GitHubHttp;
      expect(yield* github.fetchRaw("acme", "repo", "assets/example.png")).toEqual(bytes);
    }).pipe(
      Effect.provide(
        GitHubHttp.layer.pipe(
          Layer.provide(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.succeed(HttpClientResponse.fromWeb(request, new Response(bytes))),
              ),
            ),
          ),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
        ),
      ),
    ),
  );

  it.scoped("gh preserves raw stdout bytes across chunks and decodes JSON listings", () =>
    Effect.gen(function* () {
      const github = yield* GitHubCli;
      expect(yield* github.fetchRaw("acme", "repo", "assets/example.png")).toEqual(bytes);
      expect(yield* github.listContents("acme", "repo", "assets")).toEqual([
        { name: "example.png", path: "assets/example.png", type: "file" },
      ]);
      expect(yield* github.listTree("acme", "repo", "main")).toEqual({
        tree: [{ path: "assets/example.png", type: "blob", sha: "sha" }],
        truncated: false,
      });
    }).pipe(
      Effect.provide(
        GitHubCli.layer.pipe(
          Layer.provide(
            Layer.succeed(
              Spawner.ChildProcessSpawner,
              Spawner.make((command) => {
                if (command._tag !== "StandardCommand") return Effect.die("Unexpected pipeline");
                let output = bytes;
                if (command.args.includes("Accept: application/vnd.github.v3+json")) {
                  let json = '[{"name":"example.png","path":"assets/example.png","type":"file"}]';
                  if (command.args.at(-1)?.includes("/git/trees/")) {
                    json =
                      '{"tree":[{"path":"assets/example.png","type":"blob","sha":"sha"}],"truncated":false}';
                  }
                  output = new TextEncoder().encode(json);
                }
                return Effect.succeed(
                  Spawner.makeHandle({
                    pid: Spawner.ProcessId(1),
                    exitCode: Effect.succeed(Spawner.ExitCode(0)),
                    isRunning: Effect.succeed(false),
                    kill: () => Effect.void,
                    stdin: Sink.drain,
                    stdout: Stream.make(output.slice(0, 3), output.slice(3)),
                    stderr: Stream.empty,
                    all: Stream.empty,
                    getInputFd: () => Sink.drain,
                    getOutputFd: () => Stream.empty,
                    unref: Effect.succeed(Effect.void),
                  }),
                );
              }),
            ),
          ),
        ),
      ),
    ),
  );
});
