// Skills mutants. Copies stay in the owned scratch; no working source is edited.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./process";

const root = join(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/linear-port";
const compiler = join(scratch, "ergo");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
type Mutant = {
  name: string;
  file: string;
  from: string;
  to: string;
  seam?: string;
  law?: string;
  test?: string;
};
const mutants: Mutant[] = [
  {
    name: "installed-choice-installs",
    file: "cli/skills_add.ergo",
    from: "if !choices[i].Installed { out = out.Append",
    to: "if true { out = out.Append",
    test: "cli",
  },
  {
    name: "installed-not-labelled",
    file: "cli/skills_add.ergo",
    from: 'if c.Installed { c.Name + " (installed)" } else { c.Name }',
    to: "c.Name",
    test: "cli",
  },
  {
    name: "empty-answer-accepted",
    file: "cli/skills_add.ergo",
    from: "if len(out) > 0 || !open { return out }",
    to: "if len(out) >= 0 || !open { return out }",
    test: "cli",
  },
  {
    name: "prompt-skipped",
    file: "cli/skills_add.ergo",
    from: "\tif len(choices) == 1 {",
    to: "\tif len(choices) >= 1 {",
    seam: "local",
  },
  {
    name: "dry-run-writes",
    file: "cli/skills.ergo",
    from: "if !dryRun && !same {",
    to: "if !same {",
    seam: "http",
  },
  {
    name: "local-edit-overwritten",
    file: "cli/skills.ergo",
    from: "if !force && h.Value != current { return skills.Modified }",
    to: "if false && h.Value != current { return skills.Modified }",
    seam: "http",
  },
  {
    name: "kebab-drops-capitals",
    file: "skills/text.ergo",
    from: "for c in Lower(s) {",
    to: "for c in s {",
    seam: "local",
  },
  {
    name: "lock-drops-ref",
    file: "skills/lock.ergo",
    from: 'optionalMember("ref", e.Ref)',
    to: 'optionalMember("ref", None)',
    law: "skillfile",
  },
];
// Every selected mutant runs; a surviving, unbuildable or uneditable mutant
// is reported and the run goes on, so one run names every failure.
async function judge(mutant: Mutant): Promise<string | undefined> {
  const dir = await mkdtemp(join(scratch, "skills-mutant-"));
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
  if (mutant.test) {
    const result = await run(compiler, ["test", join(module, mutant.test), "--seed", "42"], root);
    if (result.code === 0 || !(result.out + result.err).includes("assert failed"))
      return `survived or invalid: ${result.out}${result.err}`;
    return undefined;
  }
  const binary = join(dir, "okra-parity");
  const built = await run(compiler, ["build", join(module, "cmd/okra-parity"), "-o", binary], root);
  if (built.code !== 0) return `unbuildable: ${built.out}${built.err}`;
  const result = await run(
    process.execPath,
    [join(root, "parity/skills.ts"), `--binary=${binary}`, `--case=${mutant.seam}`],
    root,
  );
  const said = result.out + result.err;
  if (result.code === 0 || !(said.includes("parity mismatch") || said.includes("prompt case lost")))
    return `survived or wrong failure: ${said}`;
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
    `SKILLS MUTANTS EXIT: 1 (${selected.length - failed.length} killed; not killed: ${failed.join(", ")})`,
  );
  process.exit(1);
}
console.log(`SKILLS MUTANTS EXIT: 0 (${selected.length} killed)`);
