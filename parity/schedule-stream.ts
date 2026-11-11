// Builds Go because the live tee is a process effect: an agent's stdout
// bytes must reach okra's stdout while the agent still runs. The fake agent
// prints a chunk with no line feed, then blocks on a FIFO; this driver opens
// the FIFO only after it has read that chunk from okra's stdout, never
// after a sleep. A tee that waits for a line or for the agent's exit never
// shows the chunk; the deadline then releases the agent and names the fault.
// Mutant: tee-after-exit (parity/schedule-mutants.ts).
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o6";
const binary =
  process.argv.find((s) => s.startsWith("--binary="))?.slice(9) ?? join(root, "bin/okra-ergo-parity");
await mkdir(scratch, { recursive: true });
const dir = await mkdtemp(join(scratch, "schedule-stream-"));
const bin = join(dir, "bin");
const work = join(dir, "work");
await mkdir(bin);
await mkdir(work);
await mkdir(join(dir, ".okra/schedule/tasks"), { recursive: true });
const fifo = join(dir, "release");
if (spawnSync("/usr/bin/mkfifo", [fifo]).status !== 0) throw new Error("mkfifo failed");
const chunk = "partial chunk, no line feed";
// The real agents in /usr/local/bin are never reached: both fakes are first on PATH.
const agent = `#!/bin/sh\nprintf '%s' '${chunk}'\nread ignored < '${fifo}'\nprintf ' tail'\n`;
for (const name of ["claude", "codex"]) await writeFile(join(bin, name), agent, { mode: 0o755 });
await writeFile(join(bin, "launchctl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
await writeFile(join(bin, "okra"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
await writeFile(
  join(dir, ".okra/schedule/tasks/live.json"),
  JSON.stringify({
    id: "live",
    prompt: "stream",
    provider: "claude",
    schedule: { _tag: "Cron", minute: 0, hour: 9, dayOfMonth: "*", month: "*", dayOfWeek: "*", raw: "every day at 9am" },
    cwd: work,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "active",
    runCount: 0,
  }),
);

const child = spawn(binary, ["schedule", "run", "live"], {
  cwd: work,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    HOME: dir,
    PATH: `${bin}:/usr/bin:/bin`,
    NO_COLOR: "1",
    TZ: "UTC",
    OKRA_PARITY_ORIGIN: "http://127.0.0.1:9",
    OKRA_PARITY_NOW: "1767268800000",
  },
});
let out = "";
let err = "";
let released = false;
let failure: string | undefined;
// The agent runs in its own process group (std exec), so a hung run is ended
// by releasing the agent through its FIFO, never by a signal: okra then
// finishes on its own.
const release = () => {
  if (released) return;
  released = true;
  void writeFile(fifo, "go\n");
};
// Only stops a hung run: the chunk never reached stdout while the agent ran.
const timer = setTimeout(() => {
  failure = "schedule stream mismatch: no live chunk while the agent ran";
  release();
}, 30_000);
child.stdout!.on("data", (s: Buffer) => {
  out += s.toString("latin1");
  if (out.includes(chunk)) release();
});
child.stderr!.on("data", (s: Buffer) => (err += s.toString("latin1")));
const code = await new Promise<number>((yes) => child.once("close", (status) => yes(status ?? 1)));
clearTimeout(timer);
const ps = spawnSync("ps", ["-eo", "pgid,stat"], { encoding: "utf8" });
if (ps.stdout.split("\n").some((l) => l.trim().split(/\s+/)[0] === String(child.pid) && !l.includes("Z")))
  throw new Error("owned schedule stream process remains");
if (failure) throw new Error(failure);
const want = `${chunk} tail`;
if (code !== 0 || out !== want || !err.includes("[okra schedule] Task live completed (run #1)"))
  throw new Error(`schedule stream mismatch: ${JSON.stringify({ code, out, err })}`);
console.log("SCHEDULE STREAM EXIT: 0 (a chunk with no line feed reached stdout while the agent ran)");
