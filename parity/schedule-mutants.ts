// Each mutation has one user-visible guard case of parity/schedule.ts (or
// the live-tee driver parity/schedule-stream.ts), named in
// SCHEDULE-MUTANTS.md. Mutant copies and binaries stay in this lane's
// scratch, never the original source.
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run } from "./process";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o6";
const compiler = process.env.ERGO ?? join(scratch, "ergo");
await mkdir(scratch, { recursive: true });
type Mutant = { name: string; file: string; from: string; to: string; guard: string };
const stream = "stream";
const mutants: Mutant[] = [
  {
    name: "tee-after-exit",
    file: "agentexec/agent.ergo",
    from: "\t\tio.Stdout.Print(chunk.Text)\n\t\tkept = kept.Append(chunk.Text)\n\t}\n\tlet _ = running.Wait()\n",
    to: "\t\tkept = kept.Append(chunk.Text)\n\t}\n\tlet _ = running.Wait()\n\tio.Stdout.Print(strings.Join(kept, \"\"))\n",
    guard: stream,
  },
  {
    name: "schedule-hint-lost",
    file: "cli/run.ergo",
    from: "} else if e.Code == \"INVALID_SCHEDULE\" {",
    to: "} else if e.Code == \"INVALID_SCHEDULES\" {",
    guard: "invalid",
  },
  {
    name: "pr-url-makes-context",
    file: "schedule/context.ergo",
    from: "pr.Number == None && s.Commit == None",
    to: "pr.Number == None && pr.URL == None && s.Commit == None",
    guard: "context-pr-only",
  },
  {
    name: "origin-prefix-kept",
    file: "schedule/context.ergo",
    from: 'strings.TrimPrefix(h.Value, "origin/")',
    to: 'strings.TrimPrefix(h.Value, "")',
    guard: "weekday-create-list",
  },
  {
    name: "until-day-start",
    file: "cli/schedule.ergo",
    from: "schedule.Iso(ms + 86400000 - 1)",
    to: "schedule.Iso(ms)",
    guard: "until-date-only",
  },
  {
    name: "stop-when-without-fallback",
    file: "cli/schedule.ergo",
    from: "if len(stops) == 0 { return schedule.Fail(\"MISSING_FALLBACK\"",
    to: "if false { return schedule.Fail(\"MISSING_FALLBACK\"",
    guard: "stop-when-needs-fallback",
  },
  {
    name: "schema-check-skipped",
    file: "cli/schedule.ergo",
    from: "if !schedule.Valid(when) { return schemaFailed }",
    to: "",
    guard: "invalid-schema-value",
  },
  {
    name: "remove-checks-id-first",
    file: "cli/schedule.ergo",
    from: "\ttry launchd.Uninstall(launchd.Agents{Dir: p.Agents}, id)\n\ttry schedule.CheckID(id)\n",
    to: "\ttry schedule.CheckID(id)\n\ttry launchd.Uninstall(launchd.Agents{Dir: p.Agents}, id)\n",
    guard: "remove-invalid-id",
  },
  {
    name: "any-nonce-signals",
    file: "cli/schedule.ergo",
    from: "strings.Contains(output, n.Value)",
    to: "strings.Contains(output, n.Value[:10])",
    guard: "run-no-signal",
  },
  {
    name: "verifier-answer-ignored",
    file: "cli/schedule.ergo",
    from: "if schedule.Confirms(answer) {",
    to: 'if answer != "" {',
    guard: "run-signal-rejected",
  },
  {
    name: "failed-run-not-counted",
    file: "cli/schedule.ergo",
    from: "let _ = try update(task.ID, Patch{Status: None, LastRun: Some[string]{Value: schedule.Iso(nowMillis())}, RunCount: Some[float64]{Value: runs}})",
    to: "",
    guard: "run-spawn-failed",
  },
  {
    name: "post-run-stop-skipped",
    file: "cli/schedule.ergo",
    from: "\tlet updated = try schedule.Tasks.Load(task.ID)\n",
    to: "\tlet updated = task\n",
    guard: "run-max-runs-post",
  },
  {
    name: "okra-fallback-guessed",
    file: "cli/schedule.ergo",
    from: "\t\treturn candidate\n\t}\n\tname\n}",
    to: '\t\treturn candidate\n\t}\n\t"/usr/local/bin/" + name\n}',
    guard: "no-okra-on-path",
  },
  {
    name: "corrupt-warning-dropped",
    file: "cli/schedule.ergo",
    from: 'io.Stderr.Eprintln("Warning: skipping corrupt task file " + c.File + ": " + c.Why)',
    to: "let _ = c.File + c.Why",
    guard: "list-corrupt",
  },
  {
    name: "version-first-word-only",
    file: "cli/run.ergo",
    from: "\t\tif a == \"--version\" || a == \"-v\" {",
    to: "\t\tif a == \"--version\" && len(args) == 1 {",
    guard: "root-version",
  },
  {
    name: "empty-argv-is-usage",
    file: "cli/run.ergo",
    from: "\tif len(args) == 0 { return }\n",
    to: "",
    guard: "root-empty",
  },
  {
    name: "max-runs-off-by-one",
    file: "schedule/stop.ergo",
    from: "if t.RunCount >= m.Count {",
    to: "if t.RunCount > m.Count {",
    guard: "run-max-runs-pre",
  },
];
let count = 0;
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
for (const m of mutants.filter((x) => !only || x.name === only)) {
  const dir = await mkdtemp(join(scratch, "schedule-mutant-"));
  await cp(join(root, "ergo"), join(dir, "ergo"), { recursive: true });
  const file = join(dir, "ergo", m.file);
  const text = await readFile(file, "utf8");
  if (text.split(m.from).length !== 2) throw new Error(`mutant edit not unique: ${m.name}`);
  await writeFile(file, text.replace(m.from, m.to));
  const binary = join(dir, "mutant");
  const build = await run(compiler, ["build", "ergo/cmd/okra-parity", "-o", binary], dir);
  if (build.code !== 0) throw new Error(`mutant did not compile ${m.name}: ${build.err}`);
  const guard = await run(
    process.execPath,
    m.guard === stream
      ? ["parity/schedule-stream.ts", `--binary=${binary}`]
      : ["parity/schedule.ts", `--binary=${binary}`, `--case=${m.guard}`],
    root,
    { OKRA_PARITY_SCRATCH: scratch },
  );
  const mismatch = m.guard === stream ? "schedule stream mismatch:" : `schedule parity mismatch: ${m.guard}`;
  if (guard.code === 0 || !guard.err.includes(mismatch))
    throw new Error(`mutant survived or guard broke ${m.name}: ${guard.out}\n${guard.err.slice(-2000)}`);
  console.log(`killed ${m.name}: ${m.guard}`);
  count++;
}
if (count === 0) throw new Error("no schedule mutant selected");
console.log(`SCHEDULE MUTANTS EXIT: 0 (${count} killed)`);
