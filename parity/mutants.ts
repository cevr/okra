// Mutation copies stay in the owned scratch; no working source is edited.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./process";
const root = join(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/linear-port";
const compiler = join(scratch, "ergo");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const mutants = [
  {
    name: "inherited-remove-treated-as-missing",
    file: "keys/run.ergo",
    from: "Lookup(current, c.Provider) == None && !prototypeName(c.Provider)",
    to: "Lookup(current, c.Provider) == None",
    pkg: "",
    session: "inherited-remove",
  },
  {
    name: "decode-validates-shadowed-value",
    file: "keys/store.ergo",
    from: "last[member.Key] = member.Value",
    to: "if last.Get(member.Key) == None { last[member.Key] = member.Value }",
    pkg: "",
    session: "object-semantics",
  },
  {
    name: "key-domain-keeps-invalid-utf8",
    file: "keys/store.ergo",
    from: "let secret = unicodeText(rawSecret)",
    to: "let secret = rawSecret",
    pkg: "keyfile",
    session: "",
  },
  {
    name: "prototype-env-name-treated-as-ordinary",
    file: "keys/run.ergo",
    from: "if prototypeName(c.Provider) {",
    to: "if prototypeName(c.Provider) && false {",
    pkg: "",
    session: "seed-42-0",
  },
  {
    name: "memory-save-drops-value",
    file: "memory/store.ergo",
    from: "v.keys.Set(k)",
    to: "v.keys.Set(keys.Empty())",
    pkg: "memory",
    session: "",
  },
  {
    name: "codec-drops-other-provider",
    file: "keys/store.ergo",
    from: "\t\t\tresult = result.Append(e)\n",
    to: '\t\t\tif e.name == "" { result = result.Append(e) }\n',
    pkg: "",
    session: "object-semantics",
  },
  {
    name: "env-loses-precedence",
    file: "keys/run.ergo",
    from: "match os.Process.Getenv(env) {",
    to: 'match os.Process.Getenv("O1_UNSET_FIXTURE") {',
    pkg: "",
    session: "env",
  },
  {
    name: "utf16-mask-uses-bytes",
    file: "keys/store.ergo",
    from: "let n = len(units(secret))",
    to: "let n = len(secret)",
    pkg: "",
    session: "unicode-boundaries",
  },
  {
    name: "trim-removes-U0085",
    file: "keys/store.ergo",
    from: "c == 0x9 ||",
    to: "c == 0x85 || c == 0x9 ||",
    pkg: "",
    session: "unicode-boundaries",
  },
  {
    name: "index-order-is-insertion",
    file: "keys/store.ergo",
    from: "if !placed && before(name, e.name) {",
    to: "if !placed && before(name, e.name) && false {",
    pkg: "",
    session: "object-semantics",
  },
];
for (const mutant of mutants) {
  if (only && only !== mutant.name) continue;
  const dir = await mkdtemp(join(scratch, "okra-mutant-"));
  const module = join(dir, "ergo");
  await cp(join(root, "ergo"), module, { recursive: true });
  const path = join(module, mutant.file);
  const source = await readFile(path, "utf8");
  if (source.split(mutant.from).length !== 2) throw new Error(`${mutant.name}: edit not unique`);
  // Keep k read so the memory mutant remains a well-typed implementation.
  const replacement =
    mutant.name === "memory-save-drops-value"
      ? 'if keys.Encode(k) == "" { v.keys.Set(k) } else { v.keys.Set(keys.Empty()) }'
      : mutant.to;
  await writeFile(path, source.replace(mutant.from, replacement));
  if (mutant.pkg) {
    const result = await run(compiler, ["test", join(module, mutant.pkg), "--seed", "42"], root);
    if (result.code === 0 || !(result.out + result.err).includes("law refuted"))
      throw new Error(`${mutant.name}: survived or invalid: ${result.out}${result.err}`);
  } else {
    const binary = join(dir, "okra");
    const built = await run(compiler, ["build", join(module, "cmd/okra"), "-o", binary], root);
    if (built.code !== 0)
      throw new Error(`${mutant.name}: invalid build: ${built.out}${built.err}`);
    const result = await run(
      process.execPath,
      [join(root, "parity/run.ts"), `--binary=${binary}`, `--case=${mutant.session}`],
      root,
    );
    if (result.code === 0 || !(result.out + result.err).includes("parity mismatch"))
      throw new Error(`${mutant.name}: survived or wrong failure: ${result.out}${result.err}`);
  }
  console.log(`killed ${mutant.name}`);
}

// The recorded references (parity/frozen.ts): a record no case reaches and a
// case with no record must each fail a run. The guards edit a copy's keys
// records: one extra entry fails the full run, one removed entry fails the
// session that needs it. Unmutated, both guards must see their failure; each
// mutant turns one check off, and a guard must then miss its failure.
const frozenMutants = [
  {
    name: "frozen-unused-record-ignored",
    from: "      if (unused.length)\n",
    to: "      if (false && unused.length)\n",
  },
  {
    name: "frozen-missing-record-ignored",
    from: "      if (!(key in table)) throw",
    to: "      if (false) throw",
  },
];
type Edit = { from: string; to: string };
async function frozenRun(
  edit: Edit | undefined,
  change: (table: Record<string, unknown>) => void,
  args: string[],
) {
  const dir = await mkdtemp(join(scratch, "frozen-mutant-"));
  await cp(join(root, "parity"), join(dir, "parity"), { recursive: true });
  if (edit) {
    const path = join(dir, "parity/frozen.ts");
    const source = await readFile(path, "utf8");
    if (source.split(edit.from).length !== 2)
      throw new Error(`frozen edit is not unique: ${edit.from}`);
    await writeFile(path, source.replace(edit.from, edit.to));
  }
  const records = join(dir, "parity/frozen/keys-42.json");
  const table = JSON.parse(await readFile(records, "utf8"));
  change(table);
  await writeFile(records, JSON.stringify(table));
  const binary = `--binary=${join(root, "bin/okra-ergo")}`;
  const result = await run(process.execPath, [join(dir, "parity/run.ts"), binary, ...args], dir, {
    OKRA_PARITY_SCRATCH: scratch,
  });
  return { code: result.code, output: result.out + result.err };
}
// The guards a frozen.ts at `edit` lets through (none for the real one).
async function frozenMisses(edit?: Edit) {
  const misses: string[] = [];
  const full = await frozenRun(
    edit,
    (t) => {
      t["no-such-session#0"] = t["inherited-remove#0"];
    },
    [],
  );
  if (full.code === 0 || !full.output.includes("records no case reached: no-such-session#0"))
    misses.push(`unused record: ${full.output.slice(-400)}`);
  const one = await frozenRun(
    edit,
    (t) => {
      delete t["inherited-remove#0"];
    },
    ["--case=inherited-remove"],
  );
  if (one.code === 0 || !one.output.includes("no frozen reference for inherited-remove#0"))
    misses.push(`missing record: ${one.output.slice(-400)}`);
  return misses;
}
if (!only || frozenMutants.some((m) => m.name === only)) {
  const base = await frozenMisses();
  if (base.length) throw new Error(`frozen guards fail on the real frozen.ts: ${base.join("; ")}`);
  for (const mutant of frozenMutants) {
    if (only && only !== mutant.name) continue;
    const misses = await frozenMisses(mutant);
    if (!misses.length) throw new Error(`${mutant.name} survived`);
    console.log(`killed ${mutant.name}: ${misses.map((m) => m.split(":")[0]).join(", ")} guard`);
  }
}
console.log(only ? `MUTANTS EXIT: 0 (mutant ${only} only)` : "MUTANTS EXIT: 0");
