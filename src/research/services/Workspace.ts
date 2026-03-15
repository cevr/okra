// @effect-diagnostics effect/nodeBuiltinImport:off
import { existsSync, readFileSync, mkdirSync, copyFileSync, symlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { Effect, Layer, ServiceMap } from "effect";
import { ResearchError, ErrorCode } from "../errors.js";
import { xpPaths } from "../paths.js";
import { decodeSetupManifest } from "../types.js";
import type { Session } from "../types.js";
import { GitService } from "./Git.js";

export class WorkspaceService extends ServiceMap.Service<
  WorkspaceService,
  {
    readonly setup: (session: Session) => Effect.Effect<string, ResearchError>;
    readonly teardown: (projectRoot: string) => Effect.Effect<void, ResearchError>;
    readonly exists: (projectRoot: string) => Effect.Effect<boolean>;
    readonly path: (projectRoot: string) => string;
  }
>()("@cvr/okra/research/services/Workspace/WorkspaceService") {
  static layer: Layer.Layer<WorkspaceService, never, GitService> = Layer.effect(
    WorkspaceService,
    Effect.gen(function* () {
      const git = yield* GitService;

      return {
        setup: (session) =>
          Effect.gen(function* () {
            const paths = xpPaths(session.projectRoot);
            const branchName = `xp/${session.name}`;

            // Prune stale worktree records (e.g. from killed daemons)
            yield* git.pruneWorktrees(session.projectRoot);

            // Create branch if needed
            const exists = yield* git.branchExists(branchName);
            if (!exists) {
              yield* git.createBranch(branchName);
            }

            // Create worktree if it doesn't exist
            if (!existsSync(paths.worktree)) {
              yield* git.addWorktree(paths.worktree, branchName);
            }

            // Create steer dir
            mkdirSync(paths.steerDir, { recursive: true });

            // Replay setup manifest if it exists
            if (existsSync(paths.setupJson)) {
              yield* replaySetup(paths.setupJson, paths.worktree);
            }

            return paths.worktree;
          }),

        teardown: (projectRoot) =>
          Effect.gen(function* () {
            const paths = xpPaths(projectRoot);
            if (existsSync(paths.worktree)) {
              yield* git.removeWorktree(paths.worktree);
            }
          }),

        exists: (projectRoot) => Effect.sync(() => existsSync(xpPaths(projectRoot).worktree)),

        path: (projectRoot) => xpPaths(projectRoot).worktree,
      };
    }),
  );
}

const replaySetup = (
  setupJsonPath: string,
  worktreePath: string,
): Effect.Effect<void, ResearchError> =>
  Effect.try({
    try: () => {
      const raw = readFileSync(setupJsonPath, "utf-8");
      const manifest = decodeSetupManifest(raw);

      if (manifest.files !== undefined) {
        for (const file of manifest.files) {
          mkdirSync(dirname(file.destination), { recursive: true });
          copyFileSync(file.source, file.destination);
        }
      }

      if (manifest.symlinks !== undefined) {
        for (const link of manifest.symlinks) {
          if (!existsSync(link.destination)) {
            mkdirSync(dirname(link.destination), { recursive: true });
            symlinkSync(link.source, link.destination);
          }
        }
      }

      if (manifest.commands !== undefined) {
        for (const cmd of manifest.commands) {
          execSync(cmd, { cwd: worktreePath, stdio: "inherit" });
        }
      }
    },
    catch: (e) =>
      new ResearchError({
        message: `Setup replay failed: ${e instanceof Error ? e.message : String(e)}`,
        code: ErrorCode.WORKTREE_FAILED,
      }),
  });
