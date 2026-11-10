// Repo mutants. Copies stay in the owned scratch; no working source is edited.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./process";

const root = join(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/linear-port";
const compiler = join(scratch, "ergo");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const mutants = [
  {
    name: "sort-nan-moves-earlier",
    file: "repo/text.ergo",
    from: "\t\t\tcase None:\n\t\t\t\tfalse\n\t\t\tcase Some[int64] as c:\n\t\t\t\tc.Value < 0",
    to: "\t\t\tcase None:\n\t\t\t\ttrue\n\t\t\tcase Some[int64] as c:\n\t\t\t\tc.Value < 0",
    seam: "aged",
  },
  {
    name: "collate-by-code-point",
    file: "repo/text.ergo",
    from: "\tif folded < 128 {",
    to: "\tif folded < 0 {",
    seam: "aged",
  },
  {
    name: "format-bytes-ties-round-down",
    file: "repo/text.ergo",
    from: "(bytes*20 + unit) / (unit * 2)",
    to: "(bytes*20 + unit - 1) / (unit * 2)",
    seam: "aged",
  },
  {
    name: "pypi-double-equals-kept",
    file: "repo/spec.ergo",
    from: 'if strings.HasPrefix(rest, "=") && lineFree(rest[1:]) {',
    to: 'if strings.HasPrefix(rest, "=") && lineFree(rest[1:]) && false {',
    seam: "pypi-crates",
  },
  {
    name: "prune-window-ignored",
    file: "cli/repo.ergo",
    from: "let autoPruneDays = 30",
    to: "let autoPruneDays = 3000",
    seam: "auto-prune",
  },
  {
    name: "json-first-member-wins",
    file: "jsview/view.ergo",
    from: "if m.Key == key { found = Some[json.Value]{Value: m.Value} }",
    to: "if m.Key == key && found == None { found = Some[json.Value]{Value: m.Value} }",
    seam: "file-shapes",
  },
  {
    name: "locate-ignores-case-folder",
    file: "cachefile/tree.ergo",
    from: "if len(parts) < 2 || !Exists(dir) { return normalized }",
    to: "if len(parts) < 2 || Exists(dir) { return normalized }",
    seam: "case-folder",
  },
  {
    name: "crates-without-user-agent",
    file: "registryhttp/registry.ergo",
    from: 'http.Field{Name: "User-Agent", Value: "repo-cli/1.0.0"}',
    to: 'http.Field{Name: "X-Fixture", Value: "repo-cli/1.0.0"}',
    seam: "pypi-crates",
  },
  {
    name: "failed-extract-keeps-folder",
    file: "registryhttp/registry.ergo",
    from: "\t\tcachefile.Remove(dest) catch {",
    to: '\t\tcachefile.Remove(dest + "-absent") catch {',
    seam: "npm",
  },
  {
    name: "pinned-fetch-updates",
    file: "cli/repo.ergo",
    from: '\t\t\tif spec.Version == None {\n\t\t\t\tio.Stderr.Eprintln("Updating "',
    to: '\t\t\tif spec.Version == None || true {\n\t\t\t\tio.Stderr.Eprintln("Updating "',
    seam: "github-pinned",
  },
  {
    name: "quote-drops-control-escape",
    file: "repo/catalog.ergo",
    from: 'out = out + if c < 32 { "\\\\u"',
    to: 'out = out + if c < 0 { "\\\\u"',
    law: "cachefile",
  },
];
// Every selected mutant runs; a surviving, unbuildable or uneditable mutant
// is reported and the run goes on, so one run names every failure.
async function judge(mutant: (typeof mutants)[number]): Promise<string | undefined> {
  const dir = await mkdtemp(join(scratch, "repo-mutant-"));
  const module = join(dir, "ergo");
  await cp(join(root, "ergo"), module, { recursive: true });
  const path = join(module, mutant.file);
  const source = await readFile(path, "utf8");
  if (source.split(mutant.from).length !== 2) return "edit not unique";
  await writeFile(path, source.replace(mutant.from, mutant.to));
  if (mutant.law) {
    const result = await run(compiler, ["test", join(module, mutant.law), "--seed", "42"], root);
    if (result.code === 0 || !(result.out + result.err).includes("law refuted"))
      return `survived or invalid: ${result.out}${result.err}`;
    return undefined;
  }
  const binary = join(dir, "okra-parity");
  const built = await run(compiler, ["build", join(module, "cmd/okra-parity"), "-o", binary], root);
  if (built.code !== 0) return `unbuildable: ${built.out}${built.err}`;
  const result = await run(
    process.execPath,
    [join(root, "parity/repo.ts"), `--binary=${binary}`, `--case=${mutant.seam}`],
    root,
  );
  if (result.code === 0 || !(result.out + result.err).includes("parity mismatch"))
    return `survived or wrong failure: ${result.out}${result.err}`;
  return undefined;
}
const selected = mutants.filter((m) => !only || m.name === only);
if (!selected.length) throw new Error("No mutant selected");
const failed: string[] = [];
for (const mutant of selected) {
  let problem: string | undefined;
  try {
    problem = await judge(mutant);
  } catch (error) {
    problem = `harness error: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (problem === undefined) console.log(`killed ${mutant.name}`);
  else {
    failed.push(mutant.name);
    console.log(`NOT KILLED ${mutant.name}: ${problem}`);
  }
}
if (failed.length) {
  console.log(
    `REPO MUTANTS EXIT: 1 (${selected.length - failed.length} killed; not killed: ${failed.join(", ")})`,
  );
  process.exit(1);
}
console.log(`REPO MUTANTS EXIT: 0 (${selected.length} killed)`);
