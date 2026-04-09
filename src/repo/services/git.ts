import { Effect, Layer, ServiceMap } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { RepoError } from "../errors.js";

const gitError = (operation: string, repo: string, cause: unknown) =>
  new RepoError({ message: `Git ${operation} failed on ${repo}: ${String(cause)}`, code: "GIT" });

export class GitService extends ServiceMap.Service<
  GitService,
  {
    readonly clone: (
      url: string,
      dest: string,
      options?: { depth?: number; ref?: string },
    ) => Effect.Effect<void, RepoError>;
    readonly update: (path: string) => Effect.Effect<void, RepoError>;
    readonly fetchRefs: (path: string) => Effect.Effect<void, RepoError>;
    readonly isGitRepo: (path: string) => Effect.Effect<boolean>;
    readonly getDefaultBranch: (url: string) => Effect.Effect<string, RepoError>;
    readonly getCurrentRef: (path: string) => Effect.Effect<string, RepoError>;
  }
>()("@cvr/okra/repo/services/git/GitService") {
  static readonly layer = Layer.effect(
    GitService,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      return {
        clone: (url, dest, options) =>
          Effect.gen(function* () {
            const args = ["clone"];

            if (options?.depth !== undefined) {
              args.push("--depth", String(options.depth));
            }

            if (options?.ref !== undefined) {
              args.push("--branch", options.ref);
            }

            args.push(url, dest);

            const exitCode = yield* spawner
              .exitCode(ChildProcess.make("git", args))
              .pipe(Effect.mapError((cause) => gitError("clone", url, cause)));

            if (exitCode !== 0) {
              return yield* gitError("clone", url, `exit code ${exitCode}`);
            }
          }),

        fetchRefs: (path) =>
          Effect.gen(function* () {
            const exitCode = yield* spawner
              .exitCode(ChildProcess.make("git", ["-C", path, "fetch", "--all", "--prune"]))
              .pipe(Effect.mapError((cause) => gitError("fetch", path, cause)));

            if (exitCode !== 0) {
              return yield* gitError("fetch", path, `exit code ${exitCode}`);
            }
          }),

        update: (path) =>
          Effect.gen(function* () {
            const fetchExit = yield* spawner
              .exitCode(ChildProcess.make("git", ["-C", path, "fetch", "--all", "--prune"]))
              .pipe(Effect.mapError((cause) => gitError("fetch", path, cause)));

            if (fetchExit !== 0) {
              return yield* gitError("fetch", path, `exit code ${fetchExit}`);
            }

            const resetExit = yield* spawner
              .exitCode(ChildProcess.make("git", ["-C", path, "reset", "--hard", "origin/HEAD"]))
              .pipe(Effect.mapError((cause) => gitError("reset", path, cause)));

            if (resetExit !== 0) {
              const upstreamExit = yield* spawner
                .exitCode(ChildProcess.make("git", ["-C", path, "reset", "--hard", "@{upstream}"]))
                .pipe(Effect.mapError((cause) => gitError("reset-upstream", path, cause)));

              if (upstreamExit !== 0) {
                return yield* gitError("reset", path, `exit code ${upstreamExit}`);
              }
            }
          }),

        isGitRepo: (path) =>
          spawner.exitCode(ChildProcess.make("git", ["-C", path, "rev-parse", "--git-dir"])).pipe(
            Effect.map((exitCode) => exitCode === 0),
            Effect.orElseSucceed(() => false),
          ),

        getDefaultBranch: (url) =>
          Effect.gen(function* () {
            const output = yield* spawner
              .string(ChildProcess.make("git", ["ls-remote", "--symref", url, "HEAD"]))
              .pipe(Effect.mapError((cause) => gitError("getDefaultBranch", url, cause)));

            const match = output.match(/ref: refs\/heads\/(\S+)/);
            if (match !== null && match[1] !== undefined) {
              return match[1];
            }
            return "main";
          }),

        getCurrentRef: (path) =>
          Effect.gen(function* () {
            const output = yield* spawner
              .string(ChildProcess.make("git", ["-C", path, "describe", "--tags", "--always"]))
              .pipe(Effect.mapError((cause) => gitError("getCurrentRef", path, cause)));

            const trimmed = output.trim();
            return trimmed.length > 0 ? trimmed : "unknown";
          }),
      };
    }),
  );
}
