import { chmod, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./process";

// Every argv runs okra-ergo by default; OKRA_IMPL=ts is the explicit way
// back for all argv (owner q96). Nothing routes to TypeScript by default.
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
  for (const command of ["keys", "how", "repo", "skills", "image", "counsel", "schedule"]) {
    await expect([command], "ergo");
    await expect([command, "--help"], "ergo");
    for (const flag of ["--log-level=debug", "--wizard", "--completions", "--version"])
      await expect([command, flag], "ergo");
  }
  for (const sub of ["list", "logs", "remove", "run"]) await expect(["schedule", sub, "x"], "ergo");
  for (const root of ["unknown", "--version", "-v", "--help", "--completions"]) await expect([root], "ergo");
  await expect([], "ergo");
  const args = ["keys", "get", "two words", "", "--", "$opaque", "λ", "line\nbreak"];
  await expect(args, "ts", "ts");
  await expect(args, "ergo", "ergo");
  await expect(["schedule", "list"], "ts", "ts");
  // Installed as a link (bun and npm bin entries, ~/.bun/bin/okra): an
  // absolute link in another folder, and a relative link to that link.
  const links = await mkdtemp(join(dir, "links-"));
  const elsewhere = await mkdtemp(join(dir, "cwd-"));
  await symlink(shim, join(links, "okra"));
  await symlink("okra", join(links, "okra-again"));
  for (const link of [join(links, "okra"), join(links, "okra-again")])
    for (const [args, impl, override] of [[["schedule", "list"], "ergo", ""], [[], "ergo", ""], [["keys"], "ts", "ts"]] as const) {
      const got = await run(link, [...args], elsewhere, { HOME: dir, OKRA_IMPL: override });
      if (got.code !== 23 || got.err !== "" || got.out !== `${[impl, ...args].join("\n")}\n`)
        throw new Error(`linked shim mismatch: ${JSON.stringify({ link, args, impl, got })}`);
    }
  const invalid = await run(shim, ["keys"], dir, { HOME: dir, OKRA_IMPL: "bad" });
  if (invalid.code !== 1 || invalid.out !== "" || invalid.err !== "OKRA_IMPL must be ts or ergo\n")
    throw new Error("invalid override accepted");
  await chmod(join(dir, "okra-ergo"), 0o644);
  for (const argv of [["counsel"], ["schedule"], []]) {
    const absent = await run(shim, argv, dir, { HOME: dir, OKRA_IMPL: "" });
    if (absent.code === 23 || absent.out !== "") throw new Error("missing native binary fell back");
  }
  const missing = await run(shim, ["keys"], dir, { HOME: dir, OKRA_IMPL: "ergo" });
  if (missing.code === 23 || missing.out !== "") throw new Error("explicit ergo fell back");
}
await verify(source);
if (process.argv.includes("--mutants")) {
  const route = "ergo|'') exec \"$bindir/okra-ergo\" \"$@\" ;;";
  const pick = 'case ${OKRA_IMPL-} in';
  const resolve = 'while [ -L "$self" ]; do';
  const relative = '*) self=$(dirname -- "$self")/$link ;;';
  for (const text of [route, pick, resolve, relative])
    if (source.split(text).length !== 2) throw new Error("switch edit is not unique");
  const toTs = (cond: string) =>
    source.replace(pick, `[ -z "\${OKRA_IMPL-}" ] && ${cond} && exec "$bindir/okra-ts" "$@"\n${pick}`);
  for (const [name, mutated, message] of [
    ["shim-default-to-ts", source.replace(route, 'ergo) exec "$bindir/okra-ergo" "$@" ;;\n  \'\') exec "$bindir/okra-ts" "$@" ;;'), "route/argv mismatch:"],
    ["shim-schedule-to-ts", toTs('[ "${1-}" = schedule ]'), "route/argv mismatch:"],
    ["shim-empty-to-ts", toTs("[ $# -eq 0 ]"), "route/argv mismatch:"],
    ["shim-unknown-to-ts", toTs('[ "${1-}" = unknown ]'), "route/argv mismatch:"],
    ["shim-root-flag-to-ts", toTs('case ${1-} in -*) true ;; *) false ;; esac'), "route/argv mismatch:"],
    ["shim-counsel-flag-to-ts", toTs('[ "${1-}" = counsel ] && [ "${2-}" = --log-level=debug ]'), "route/argv mismatch:"],
    [
      "shim-missing-native-to-ts",
      source.replace(
        route,
        'ergo|\'\') [ -x "$bindir/okra-ergo" ] || exec "$bindir/okra-ts" "$@"; exec "$bindir/okra-ergo" "$@" ;;',
      ),
      "missing native binary fell back",
    ],
    ["shim-link-unresolved", source.replace(resolve, 'while false; do'), "linked shim mismatch:"],
    ["shim-relative-link-from-cwd", source.replace(relative, "*) self=$link ;;"), "linked shim mismatch:"],
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
