// @effect-diagnostics effect/nodeBuiltinImport:off
import { join } from "node:path";

export const XP_DIR = ".xp";

export const xpPaths = (projectRoot: string) => {
  const xpDir = join(projectRoot, XP_DIR);
  return {
    xpDir,
    sessionJson: join(xpDir, "session.json"),
    setupJson: join(xpDir, "setup.json"),
    experimentsJsonl: join(xpDir, "experiments.jsonl"),
    experimentMd: join(xpDir, "experiment.md"),
    benchmarkDigest: join(xpDir, "benchmark.digest"),
    daemonPid: join(xpDir, "daemon.pid"),
    daemonLock: join(xpDir, "daemon.lock"),
    daemonLog: join(xpDir, "daemon.log"),
    steerDir: join(xpDir, "steer"),
    worktree: join(xpDir, "worktree"),
  } as const;
};

export type XpPaths = ReturnType<typeof xpPaths>;
