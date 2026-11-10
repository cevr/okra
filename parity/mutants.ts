// Mutation copies stay in the owned scratch; no working source is edited.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./process";
const root = join(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/linear-port";
const compiler = join(scratch, "ergo");
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
console.log("MUTANTS EXIT: 0");
