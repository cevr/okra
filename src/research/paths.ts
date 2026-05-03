import { Effect } from "effect";
import { Path } from "effect/Path";

export const XP_DIR = ".xp";

export const buildXpPaths = (path: Path, projectRoot: string) => {
  const xpDir = path.join(projectRoot, XP_DIR);
  return {
    xpDir,
    sessionJson: path.join(xpDir, "session.json"),
    setupJson: path.join(xpDir, "setup.json"),
    experimentsJsonl: path.join(xpDir, "experiments.jsonl"),
    experimentMd: path.join(xpDir, "experiment.md"),
    benchmarkDigest: path.join(xpDir, "benchmark.digest"),
    daemonPid: path.join(xpDir, "daemon.pid"),
    daemonLock: path.join(xpDir, "daemon.lock"),
    daemonLog: path.join(xpDir, "daemon.log"),
    steerDir: path.join(xpDir, "steer"),
    worktree: path.join(xpDir, "worktree"),
  } as const;
};

export const xpPaths = Effect.fn("xpPaths")(function* (projectRoot: string) {
  const path = yield* Path;
  return buildXpPaths(path, projectRoot);
});

export type XpPaths = ReturnType<typeof buildXpPaths>;
