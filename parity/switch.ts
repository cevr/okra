import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./process";

const source = await readFile(join(import.meta.dir, "../bin/okra"), "utf8");
async function verify(script: string) {
  const dir = await mkdtemp("/tmp/opencode/linear-port/okra-switch-");
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
  for (const command of ["keys", "how", "repo"]) {
    await expect([command], "ergo");
    await expect([command, "--help"], "ergo");
    await expect([command, "--log-level=debug"], "ts");
  }
  for (const command of ["skills", "image", "counsel", "schedule", "unknown", "--version"])
    await expect([command], "ts");
  await expect([], "ts");
  const args = ["keys", "get", "two words", "", "--", "$opaque", "λ", "line\nbreak"];
  await expect(args, "ts", "ts");
  await expect(args, "ergo", "ergo");
  const invalid = await run(shim, ["keys"], dir, { HOME: dir, OKRA_IMPL: "bad" });
  if (invalid.code !== 1 || invalid.out !== "" || invalid.err !== "OKRA_IMPL must be ts or ergo\n")
    throw new Error("invalid override accepted");
  await chmod(join(dir, "okra-ergo"), 0o644);
  await expect(["keys"], "ts");
  const missing = await run(shim, ["keys"], dir, { HOME: dir, OKRA_IMPL: "ergo" });
  if (missing.code === 23 || missing.out !== "") throw new Error("explicit ergo fell back");
}
await verify(source);
if (process.argv.includes("--mutants")) {
  const from = "keys|how|repo) impl=ergo";
  if (source.split(from).length !== 2) throw new Error("switch edit is not unique");
  for (const [name, to] of [
    ["shim-keys-to-ts", "how|repo) impl=ergo"],
    ["shim-repo-to-ts", "keys|how) impl=ergo"],
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
}
console.log("SWITCH EXIT: 0");
