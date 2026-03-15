import { Effect, Layer, ServiceMap } from "effect";
import { ResearchError, ErrorCode } from "../errors.js";

export class GitService extends ServiceMap.Service<
  GitService,
  {
    readonly currentBranch: () => Effect.Effect<string, ResearchError>;
    readonly headSha: (cwd?: string) => Effect.Effect<string, ResearchError>;
    readonly isClean: (cwd?: string) => Effect.Effect<boolean, ResearchError>;
    readonly createBranch: (name: string, from?: string) => Effect.Effect<void, ResearchError>;
    readonly branchExists: (name: string) => Effect.Effect<boolean, ResearchError>;
    readonly addWorktree: (path: string, branch: string) => Effect.Effect<void, ResearchError>;
    readonly removeWorktree: (path: string) => Effect.Effect<void, ResearchError>;
    readonly commitInWorktree: (
      cwd: string,
      message: string,
    ) => Effect.Effect<string, ResearchError>;
    readonly revertWorktree: (cwd: string) => Effect.Effect<void, ResearchError>;
    readonly diff: (cwd: string) => Effect.Effect<string, ResearchError>;
    readonly pruneWorktrees: (cwd?: string) => Effect.Effect<void, ResearchError>;
  }
>()("@cvr/okra/research/services/Git/GitService") {
  static layer: Layer.Layer<GitService> = Layer.sync(GitService, () => {
    const run = Effect.fn("git.run")(function* (args: readonly string[], cwd?: string) {
      const proc = yield* Effect.sync(() =>
        Bun.spawn(["git", ...args], {
          stdout: "pipe",
          stderr: "pipe",
          ...(cwd !== undefined ? { cwd } : {}),
        }),
      );

      const exitCode = yield* Effect.tryPromise({
        try: () => proc.exited,
        catch: (e) =>
          new ResearchError({
            message: `git process failed: ${e}`,
            code: ErrorCode.GIT_FAILED,
          }),
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            proc.kill();
          }),
        ),
      );

      const stdout = yield* Effect.tryPromise({
        try: () => new Response(proc.stdout).text(),
        catch: (e) =>
          new ResearchError({
            message: `Failed to read git stdout: ${e}`,
            code: ErrorCode.GIT_FAILED,
          }),
      });

      const stderr = yield* Effect.tryPromise({
        try: () => new Response(proc.stderr).text(),
        catch: (e) =>
          new ResearchError({
            message: `Failed to read git stderr: ${e}`,
            code: ErrorCode.GIT_FAILED,
          }),
      });

      if (exitCode !== 0) {
        return yield* new ResearchError({
          message: stderr.trim() || `git ${args[0]} failed with exit code ${exitCode}`,
          code: ErrorCode.GIT_FAILED,
        });
      }

      return stdout.trim();
    });

    return {
      currentBranch: () =>
        run(["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
          Effect.filterOrFail(
            (branch) => branch !== "HEAD",
            () =>
              new ResearchError({
                message: "HEAD is detached",
                code: ErrorCode.GIT_FAILED,
              }),
          ),
        ),

      headSha: (cwd) => run(["rev-parse", "HEAD"], cwd),

      isClean: (cwd) => run(["status", "--porcelain"], cwd).pipe(Effect.map((r) => r === "")),

      createBranch: (name, from) => {
        const args = from !== undefined ? ["branch", name, from] : ["branch", name];
        return run(args).pipe(Effect.asVoid);
      },

      branchExists: (name) =>
        run(["rev-parse", "--verify", `refs/heads/${name}`]).pipe(
          Effect.as(true),
          Effect.catchTag("@cvr/okra/research/ResearchError", () => Effect.succeed(false)),
        ),

      addWorktree: (path, branch) => run(["worktree", "add", path, branch]).pipe(Effect.asVoid),

      removeWorktree: (path) => run(["worktree", "remove", path, "--force"]).pipe(Effect.asVoid),

      commitInWorktree: (cwd, message) =>
        run(["add", "-A"], cwd).pipe(
          Effect.flatMap(() => run(["commit", "-m", message], cwd)),
          Effect.flatMap(() => run(["rev-parse", "HEAD"], cwd)),
        ),

      revertWorktree: (cwd) =>
        run(["reset", "--hard", "HEAD"], cwd).pipe(
          Effect.flatMap(() => run(["clean", "-fd"], cwd)),
          Effect.asVoid,
        ),

      diff: (cwd) => run(["diff", "HEAD"], cwd),

      pruneWorktrees: (cwd) => run(["worktree", "prune"], cwd).pipe(Effect.asVoid),
    };
  });

  static layerTest = (impl: Partial<ServiceMap.Service.Shape<typeof GitService>> = {}) =>
    Layer.succeed(GitService, {
      currentBranch: () => Effect.succeed("main"),
      headSha: () => Effect.succeed("abc123"),
      isClean: () => Effect.succeed(true),
      createBranch: () => Effect.void,
      branchExists: () => Effect.succeed(false),
      addWorktree: () => Effect.void,
      removeWorktree: () => Effect.void,
      commitInWorktree: () => Effect.succeed("abc123"),
      revertWorktree: () => Effect.void,
      diff: () => Effect.succeed(""),
      pruneWorktrees: () => Effect.void,
      ...impl,
    });
}
