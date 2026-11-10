import { spawn, spawnSync } from "node:child_process";
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/linear-port";
export async function run(
  command: string,
  args: string[],
  cwd: string,
  extra: Record<string, string> = {},
) {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: scratch,
      GOMAXPROCS: "1",
      GOMEMLIMIT: "6GiB",
      GOFLAGS: "-p=1",
      GOPATH: `${scratch}/go`,
      GOMODCACHE: `${scratch}/go/pkg/mod`,
      GOCACHE: `${scratch}/gocache`,
      ...extra,
    },
  });
  let out = "",
    err = "",
    active = true;
  const stop = () => {
    if (active && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* exited */
      }
    }
  };
  const timer = setTimeout(stop, 120_000); // only a hung child is stopped
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  child.stdout.on("data", (data) => {
    out += data;
  });
  child.stderr.on("data", (data) => {
    err += data;
  });
  let code: number;
  try {
    code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) =>
        signal ? reject(new Error(`hung ${command} stopped: ${signal}`)) : resolve(status ?? 1),
      );
    });
  } finally {
    stop();
    active = false;
    clearTimeout(timer);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, stop);
  }
  const ps = spawnSync("ps", ["-eo", "pid,pgid,stat,comm"], { encoding: "utf8" });
  if (
    ps.status !== 0 ||
    ps.stdout.split("\n").some((line) => {
      const fields = line.trim().split(/\s+/);
      return fields[1] === String(child.pid) && !fields[2]?.startsWith("Z");
    })
  )
    throw new Error("owned process group remains");
  return { code, out, err };
}
