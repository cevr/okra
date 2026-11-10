import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./process";

const source = await readFile(join(import.meta.dir, "../bin/okra"), "utf8");
async function verify(script: string) {
  const dir = await mkdtemp(
    join(process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/linear-port", "okra-switch-"),
  );
  const shim = join(dir, "okra");
  await writeFile(shim, script, { mode: 0o755 });
  for (const impl of ["ts", "ergo"])
    await writeFile(
      join(dir, `okra-${impl}`),
      `#!/bin/sh\nprintf '%s\\n' '${impl}' "$@"\nexit 23\n`,
      { mode: 0o755 },
    );
  async function expect(args: string[], impl: string, override = "") {
    const got = await run(shim, args, dir, { HOME: dir, OKRA_IMPL: override });
    if (got.code !== 23 || got.err !== "" || got.out !== `${[impl, ...args].join("\n")}\n`)
      throw new Error(`route/argv mismatch: ${JSON.stringify({ args, impl, override, got })}`);
  }
  for (const command of ["keys", "how", "repo", "skills", "image", "counsel"]) {
    await expect([command], "ergo");
    await expect([command, "--help"], "ergo");
    for (const flag of ["--log-level=debug", "--wizard", "--completions", "--version"])
      await expect([command, flag], "ergo");
  }
  for (const command of ["schedule", "unknown", "--version"]) await expect([command], "ts");
  await expect([], "ts");
  const args = ["keys", "get", "two words", "", "--", "$opaque", "λ", "line\nbreak"];
  await expect(args, "ts", "ts");
  await expect(args, "ergo", "ergo");
  const invalid = await run(shim, ["keys"], dir, { HOME: dir, OKRA_IMPL: "bad" });
  if (invalid.code !== 1 || invalid.out !== "" || invalid.err !== "OKRA_IMPL must be ts or ergo\n")
    throw new Error("invalid override accepted");
  await chmod(join(dir, "okra-ergo"), 0o644);
  const absent = await run(shim, ["counsel"], dir, { HOME: dir, OKRA_IMPL: "" });
  if (absent.code === 23 || absent.out !== "") throw new Error("missing native binary fell back");
  const missing = await run(shim, ["keys"], dir, { HOME: dir, OKRA_IMPL: "ergo" });
  if (missing.code === 23 || missing.out !== "") throw new Error("explicit ergo fell back");
}
await verify(source);
if (process.argv.includes("--mutants")) {
  const from = "keys|how|repo|skills|image|counsel) impl=ergo";
  if (source.split(from).length !== 2) throw new Error("switch edit is not unique");
  for (const [name, to] of [
    ["shim-keys-to-ts", "how|repo|skills|image|counsel) impl=ergo"],
    ["shim-repo-to-ts", "keys|how|skills|image|counsel) impl=ergo"],
    ["shim-skills-to-ts", "keys|how|repo|image|counsel) impl=ergo"],
    ["shim-image-to-ts", "keys|how|repo|skills|counsel) impl=ergo"],
    ["shim-counsel-to-ts", "keys|how|repo|skills|image) impl=ergo"],
  ] as const) {
    let killed = false;
    try {
      await verify(source.replace(from, to));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("route/argv mismatch:"))
        throw error;
      killed = true;
    }
    if (!killed) throw new Error(`${name} survived`);
    console.log(`killed ${name}`);
  }
  for (const [name, mutated, message] of [
    [
      "shim-counsel-flag-to-ts",
      source.replace(
        "impl=ts",
        'case ${1-} in counsel) for arg do case $arg in --log-level=*) exec "$bindir/okra-ts" "$@" ;; esac; done ;; esac\nimpl=ts',
      ),
      "route/argv mismatch:",
    ],
    [
      "shim-missing-native-to-ts",
      source.replace(
        'exec "$bindir/okra-$impl" "$@"',
        'if [ "$impl" = ergo ] && [ ! -x "$bindir/okra-ergo" ]; then impl=ts; fi\nexec "$bindir/okra-$impl" "$@"',
      ),
      "missing native binary fell back",
    ],
  ] as const) {
    let killed = false;
    try {
      await verify(mutated);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith(message)) throw error;
      killed = true;
    }
    if (!killed) throw new Error(`${name} survived`);
    console.log(`killed ${name}`);
  }
}
console.log("SWITCH EXIT: 0");
