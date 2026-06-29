import { Effect, Layer, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { ResearchError, ErrorCode } from "../errors.js";
import { buildXpPaths } from "../paths.js";
import { decodeSetupManifest } from "../types.js";
import type { Session } from "../types.js";
import { GitService } from "./Git.js";

const wrapIO = (e: PlatformError, code: ErrorCode = ErrorCode.WORKTREE_FAILED) =>
  new ResearchError({ message: e.message, code });

export class WorkspaceService extends Context.Service<
  WorkspaceService,
  {
    readonly setup: (session: Session) => Effect.Effect<string, ResearchError>;
    readonly teardown: (projectRoot: string) => Effect.Effect<void, ResearchError>;
    readonly exists: (projectRoot: string) => Effect.Effect<boolean>;
    readonly path: (projectRoot: string) => Effect.Effect<string>;
  }
>()("@cvr/okra/research/services/Workspace/WorkspaceService") {
  static layer: Layer.Layer<WorkspaceService, never, GitService | FileSystem | Path> = Layer.effect(
    WorkspaceService,
    Effect.gen(function* () {
      const git = yield* GitService;
      const fs = yield* FileSystem;
      const path = yield* Path;

      const replaySetup = Effect.fn("Workspace.replaySetup")(function* (
        setupJsonPath: string,
        worktreePath: string,
      ) {
        const raw = yield* fs
          .readFileString(setupJsonPath)
          .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.READ_FAILED)));
        const manifest = decodeSetupManifest(raw);

        if (manifest.files !== undefined) {
          for (const file of manifest.files) {
            yield* fs
              .makeDirectory(path.dirname(file.destination), { recursive: true })
              .pipe(Effect.mapError((e) => wrapIO(e)));
            yield* fs
              .copyFile(file.source, file.destination)
              .pipe(Effect.mapError((e) => wrapIO(e)));
          }
        }

        if (manifest.symlinks !== undefined) {
          for (const link of manifest.symlinks) {
            const linkExists = yield* fs
              .exists(link.destination)
              .pipe(Effect.orElseSucceed(() => false));
            if (!linkExists) {
              yield* fs
                .makeDirectory(path.dirname(link.destination), { recursive: true })
                .pipe(Effect.mapError((e) => wrapIO(e)));
              yield* fs
                .symlink(link.source, link.destination)
                .pipe(Effect.mapError((e) => wrapIO(e)));
            }
          }
        }

        if (manifest.commands !== undefined) {
          for (const cmd of manifest.commands) {
            const proc = Bun.spawn(["sh", "-c", cmd], {
              cwd: worktreePath,
              stdout: "inherit",
              stderr: "inherit",
            });
            const code = yield* Effect.tryPromise({
              try: () => proc.exited,
              catch: (e) =>
                new ResearchError({
                  message: `Setup command failed: ${e instanceof Error ? e.message : String(e)}`,
                  code: ErrorCode.WORKTREE_FAILED,
                }),
            });
            if (code !== 0) {
              return yield* new ResearchError({
                message: `Setup command failed (exit ${String(code)}): ${cmd}`,
                code: ErrorCode.WORKTREE_FAILED,
              });
            }
          }
        }
      });

      return {
        setup: (session) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, session.projectRoot);
            const branchName = `xp/${session.name}`;

            // Prune stale worktree records (e.g. from killed daemons)
            yield* git.pruneWorktrees(session.projectRoot);

            // Create branch if needed
            const exists = yield* git.branchExists(branchName);
            if (!exists) {
              yield* git.createBranch(branchName);
            }

            // Create worktree if it doesn't exist
            const worktreeExists = yield* fs
              .exists(paths.worktree)
              .pipe(Effect.orElseSucceed(() => false));
            if (!worktreeExists) {
              yield* git.addWorktree(paths.worktree, branchName);
            }

            // Create steer dir
            yield* fs
              .makeDirectory(paths.steerDir, { recursive: true })
              .pipe(Effect.mapError((e) => wrapIO(e)));

            // Replay setup manifest if it exists
            const setupExists = yield* fs
              .exists(paths.setupJson)
              .pipe(Effect.orElseSucceed(() => false));
            if (setupExists) {
              yield* replaySetup(paths.setupJson, paths.worktree);
            }

            return paths.worktree;
          }),

        teardown: (projectRoot) =>
          Effect.gen(function* () {
            const paths = buildXpPaths(path, projectRoot);
            const worktreeExists = yield* fs
              .exists(paths.worktree)
              .pipe(Effect.orElseSucceed(() => false));
            if (worktreeExists) {
              yield* git.removeWorktree(paths.worktree);
            }
          }),

        exists: (projectRoot) =>
          fs
            .exists(buildXpPaths(path, projectRoot).worktree)
            .pipe(Effect.orElseSucceed(() => false)),

        path: (projectRoot) => Effect.succeed(buildXpPaths(path, projectRoot).worktree),
      };
    }),
  );
}
