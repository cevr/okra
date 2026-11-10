// Builds Go because a live file sink and the child's actual TERM-trap
// status are process effects. The ready FIFO gates the injected Scheduler:
// it checks both partial files before triggering expiry, never after a sleep.
// Mutants: discarded stdout/stderr, lost grace and invented timeout status.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run } from "./process";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o5";
const compiler = process.env.ERGO ?? join(scratch, "ergo");
const supplied = process.argv.find((s) => s.startsWith("--binary="))?.slice(9);
await mkdir(scratch, { recursive: true });
const dir = await mkdtemp(join(scratch, "counsel-stream-"));
const binary = supplied ?? join(dir, "probe");
if (!supplied) {
  const built = await run(compiler, ["build", "ergo/cmd/counsel-probe", "-o", binary], root);
  if (built.code !== 0) throw new Error(`probe build failed: ${built.err}`);
}
const fifo = await run("/usr/bin/mkfifo", [join(dir, "ready"), join(dir, "block")], dir);
if (fifo.code !== 0) throw new Error(`fifo failed: ${fifo.err}`);
await writeFile(
  join(dir, "agent"),
  `#!/bin/sh
exec 3<> '${dir}/block'
trap 'exit 37' TERM
printf 'partial event'
printf 'partial error' >&2
printf ready > '${dir}/ready'
read ignored <&3
`,
  { mode: 0o755 },
);
const result = await run(binary, [dir], dir, { HOME: dir });
if (result.code !== 0 || result.out !== "status 37 timeout true\n" || result.err !== "")
  throw new Error(`counsel stream mismatch: ${JSON.stringify(result)}`);
for (const [name, text] of [
  ["events", "partial event"],
  ["errors", "partial error"],
] as const) {
  if ((await readFile(join(dir, name), "utf8")) !== text)
    throw new Error(`counsel stream mismatch: final ${name} bytes differ`);
}
console.log("COUNSEL STREAM EXIT: 0 (live files, timeout, TERM trap status 37)");
