// Each mutation has one user-visible guard case of parity/counsel.ts, named
// in COUNSEL-MUTANTS.md. Mutant copies and binaries stay in this lane's
// scratch, never the original source.
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run } from "./process";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o5";
const compiler = process.env.ERGO ?? join(scratch, "ergo");
await mkdir(scratch, { recursive: true });
type Mutant = { name: string; file: string; from: string; to: string; guard: string };
const mutants: Mutant[] = [
  {
    name: "jsonl-opener-ends-member",
    file: "jsonl/jsonl.ergo",
    from: "i = space(text, i+1)\n\t\tif i < len(text) && closer(text[i])",
    to: "i = space(text, i+1)\n\t\tif i < len(text) && punct(text[i])",
    guard: "claude-ok",
  },
  {
    name: "jsonl-opener-ends-element",
    file: "jsonl/jsonl.ergo",
    from: "for {\n\t\tif i < len(text) && closer(text[i])",
    to: "for {\n\t\tif i < len(text) && punct(text[i])",
    guard: "claude-nested",
  },
  {
    name: "jsonl-later-garbage-fails",
    file: "jsonl/jsonl.ergo",
    from: "if len(values) == 0 { return Unparsable }",
    to: "return Unparsable",
    guard: "claude-later-garbage",
  },
  {
    name: "jsonl-cut-first-fails",
    file: "jsonl/jsonl.ergo",
    from: "case Cut:\n\t\t\treturn values",
    to: "case Cut:\n\t\t\treturn Unparsable",
    guard: "claude-cut",
  },
  {
    name: "claude-mistyped-is-error-read",
    file: "counsel/counsel.ergo",
    from: "b.Value\n\t\t\tcase _:\n\t\t\t\tcontinue",
    to: "b.Value\n\t\t\tcase _:\n\t\t\t\tfalse",
    guard: "claude-mistyped",
  },
  {
    name: "claude-model-not-read",
    file: "cli/counsel.ergo",
    from: "defaultText(counsel.ClaudeModel(events), attempted.Model)",
    to: "attempted.Model",
    guard: "claude-ok",
  },
  {
    name: "codex-takes-last-failure",
    file: "counsel/counsel.ergo",
    from: "return Refused{Message: m.Value}",
    to: "outcome = Refused{Message: m.Value}",
    guard: "codex-turn-failed",
  },
  {
    name: "codex-fallback-on-any-refusal",
    file: "counsel/counsel.ergo",
    from: 'target == Codex && strings.Contains(r.Message, "model is not supported when using Codex")',
    to: 'target == Codex && strings.Contains(r.Message, "")',
    guard: "codex-fallback-stops",
  },
  {
    name: "empty-marker-counts",
    file: "counsel/counsel.ergo",
    from: 'func set(v Option[string]) bool { v != None && v != Some[string]{Value: ""} }',
    to: "func set(v Option[string]) bool { v != None }",
    guard: "marker-empty",
  },
  {
    name: "exit-status-ignored-with-answer",
    file: "counsel/counsel.ergo",
    from: "if exitCode != 0 { return Some[string]",
    to: "if false { return Some[string]",
    guard: "claude-exit-with-answer",
  },
  {
    name: "bucket-drops-dotted-i",
    file: "counsel/counsel.ergo",
    from: "} else if c == 0x130 {",
    to: "} else if c == 0x131 {",
    guard: "bucket-names",
  },
  {
    name: "stdin-bom-not-blank",
    file: "cli/counsel.ergo",
    from: "c == 0x3000 || c == 0xFEFF",
    to: "c == 0x3000",
    guard: "prompt-stdin-blank",
  },
  {
    name: "display-unquoted",
    file: "counsel/counsel.ergo",
    from: "if plain { return w }",
    to: 'if plain || w != "" { return w }',
    guard: "spawn-failed",
  },
];
let count = 0;
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
for (const m of mutants.filter((x) => !only || x.name === only)) {
  const dir = await mkdtemp(join(scratch, "counsel-mutant-"));
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
    ["parity/counsel.ts", `--binary=${binary}`, `--case=${m.guard}`],
    root,
    { OKRA_PARITY_SCRATCH: scratch },
  );
  if (guard.code === 0 || !guard.err.includes(`counsel parity mismatch: ${m.guard}`))
    throw new Error(`mutant survived or guard broke ${m.name}: ${guard.out}\n${guard.err}`);
  console.log(`killed ${m.name}: ${m.guard}`);
  count++;
}
console.log(`COUNSEL MUTANTS EXIT: 0 (${count} killed)`);
