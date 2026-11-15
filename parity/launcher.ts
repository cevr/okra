// Builds no Go. The public seam is the launcher's chosen file, argv, status and
// refusal line, in the package layout (npm/<os>-<arch>/okra), reached through
// the links npm (relative) and bun (absolute) make. A fake `uname` names each
// platform; fake binaries print their directory and argv. parity/switch.ts owns
// the source-checkout layout (bin/okra-ergo, OKRA_IMPL).
//
//   bun parity/launcher.ts [--shim=PATH] [--mutants]
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-launcher";
await mkdir(scratch, { recursive: true });
const sourcePath =
  process.argv.find((arg) => arg.startsWith("--shim="))?.slice(7) ?? join(root, "bin/okra");
const source = await readFile(sourcePath, "utf8");

const dirs = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const supported: [string, string, string][] = [
  ["Linux", "x86_64", "linux-x64"],
  ["Linux", "amd64", "linux-x64"],
  ["Linux", "aarch64", "linux-arm64"],
  ["Linux", "arm64", "linux-arm64"],
  ["Darwin", "arm64", "darwin-arm64"],
  ["Darwin", "x86_64", "darwin-x64"],
];
const unsupported: [string, string][] = [
  ["FreeBSD", "amd64"],
  ["Linux", "riscv64"],
  ["Linux", "armv7l"],
  ["Darwin", "i386"],
  ["MINGW64_NT-10.0", "x86_64"],
];
const refusal = (s: string, m: string) =>
  `okra: no native binary for ${s} ${m}; the platforms are darwin-arm64, darwin-x64, linux-arm64 and linux-x64\n`;

class Fault extends Error {}

async function run(command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, { detached: true, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "",
    err = "",
    active = true;
  const stop = () => {
    if (active && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* exited */
      }
    }
  };
  const timer = setTimeout(stop, 30_000); // stops only a hung launcher probe
  child.stdout.on("data", (data) => (out += data));
  child.stderr.on("data", (data) => (err += data));
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) =>
        signal ? reject(new Error(`launcher stopped: ${signal}`)) : resolve(status ?? 1),
      );
    });
    return { out, err, code };
  } finally {
    stop();
    active = false;
    clearTimeout(timer);
    const ps = spawnSync("ps", ["-eo", "pid,pgid,stat"], { encoding: "utf8" });
    if (
      ps.status !== 0 ||
      ps.stdout.split("\n").some((line) => {
        const fields = line.trim().split(/\s+/);
        return fields[1] === String(child.pid) && !fields[2]?.startsWith("Z");
      })
    )
      // oxlint-disable-next-line no-unsafe-finally -- A leaked owned process invalidates the probe's result.
      throw new Error("launcher left an owned process");
  }
}

async function install(script: string) {
  const home = await mkdtemp(join(scratch, "launcher-"));
  // The installed package, as npm and bun lay it out.
  const pkg = join(home, "lib/node_modules/@cvr/okra");
  await mkdir(join(pkg, "bin"), { recursive: true });
  await writeFile(join(pkg, "bin/okra"), script, { mode: 0o755 });
  for (const dir of dirs) {
    await mkdir(join(pkg, "npm", dir), { recursive: true });
    await writeFile(
      join(pkg, "npm", dir, "okra"),
      `#!/bin/sh\nprintf '%s\\n' '${dir}' "$@"\nexit 23\n`,
      { mode: 0o755 },
    );
  }
  const fake = join(home, "fake");
  await mkdir(fake);
  await writeFile(
    join(fake, "uname"),
    `#!/bin/sh\ncase $1 in -s) printf '%s\\n' "$FAKE_S" ;; -m) printf '%s\\n' "$FAKE_M" ;; *) exit 9 ;; esac\n`,
    { mode: 0o755 },
  );
  // npm: <prefix>/bin/okra -> ../lib/node_modules/@cvr/okra/bin/okra.
  await mkdir(join(home, "bin"));
  await symlink("../lib/node_modules/@cvr/okra/bin/okra", join(home, "bin/okra"));
  // bun: an absolute link, here reached through a second link in another folder.
  await mkdir(join(home, "bun/bin"), { recursive: true });
  await symlink(join(pkg, "bin/okra"), join(home, "bun/bin/okra"));
  await mkdir(join(home, "other"));
  await symlink("../bun/bin/okra", join(home, "other/okra"));
  const entries = [join(pkg, "bin/okra"), join(home, "bin/okra"), join(home, "other/okra")];
  return { home, pkg, fake, entries };
}

async function verify(script: string) {
  const { home, pkg, fake, entries } = await install(script);
  const env = (s: string, m: string, impl?: string) => ({
    PATH: `${fake}:/usr/bin:/bin`,
    HOME: home,
    FAKE_S: s,
    FAKE_M: m,
    ...(impl === undefined ? {} : { OKRA_IMPL: impl }),
  });
  const args = ["keys", "get", "", "two words", "--", "$opaque", "λ"];
  for (const entry of entries) {
    for (const [s, m, dir] of supported) {
      for (const shell of [undefined, "bash"]) {
        const got = shell
          ? await run(shell, [entry, ...args], env(s, m))
          : await run(entry, args, env(s, m));
        if (got.out !== `${[dir, ...args].join("\n")}\n` || got.err !== "" || got.code !== 23)
          throw new Fault(
            `launcher: route mismatch ${JSON.stringify({ entry, s, m, shell, dir, got })}`,
          );
      }
    }
    for (const [s, m] of unsupported) {
      const got = await run(entry, ["--version"], env(s, m));
      if (got.out !== "" || got.err !== refusal(s, m) || got.code !== 1)
        throw new Fault(
          `launcher: unsupported platform ${s} ${m} not refused: ${JSON.stringify(got)}`,
        );
    }
  }
  // OKRA_IMPL=ergo is the default; ts has no TS binary in the package.
  const ergo = await run(entries[1]!, ["keys", "list"], env("Linux", "x86_64", "ergo"));
  if (ergo.out !== "linux-x64\nkeys\nlist\n" || ergo.code !== 23)
    throw new Fault(`launcher: OKRA_IMPL=ergo differs from the default: ${JSON.stringify(ergo)}`);
  const ts = await run(entries[1]!, ["keys", "list"], env("Linux", "x86_64", "ts"));
  if (ts.out !== "" || ts.code !== 1 || !ts.err.startsWith("okra: OKRA_IMPL=ts needs bin/okra-ts"))
    throw new Fault(`launcher: OKRA_IMPL=ts in the package: ${JSON.stringify(ts)}`);
  // A missing binary for this platform is an error; no other platform's runs.
  await rename(join(pkg, "npm/linux-x64/okra"), join(pkg, "npm/linux-x64/gone"));
  const missing = await run(entries[1]!, ["keys", "list"], env("Linux", "x86_64"));
  if (
    missing.out !== "" ||
    missing.code !== 1 ||
    missing.err !==
      `okra: ${join(pkg, "npm/linux-x64/okra")} is missing; reinstall the package, or run bun scripts/release.ts in a source checkout\n`
  )
    throw new Fault(`launcher: missing binary not refused: ${JSON.stringify(missing)}`);
}

await verify(source);
console.log("launcher platforms, links, refusals and argv passed");
if (process.argv.includes("--mutants")) {
  const mutants: [string, string, string][] = [
    ["arch-x64-as-arm64", "x86_64 | amd64) arch=x64 ;;", "x86_64 | amd64) arch=arm64 ;;"],
    ["arch-aarch64-unmapped", "arm64 | aarch64) arch=arm64 ;;", "arm64) arch=arm64 ;;"],
    ["os-darwin-as-linux", "Darwin) os=darwin ;;", "Darwin) os=linux ;;"],
    ["link-unresolved", 'while [ -L "$self" ]; do', "while false; do"],
    ["relative-link-from-cwd", '*) self=$(dirname -- "$self")/$link ;;', "*) self=$link ;;"],
    ["unsupported-arch-as-x64", "*) arch= ;;", "*) arch=x64 ;;"],
    ["unsupported-os-as-linux", "*) os= ;;", "*) os=linux ;;"],
    ["ts-without-binary-runs", '[ -e "$bindir/okra-ts" ] || fail', "true || fail"],
  ];
  for (const [name, from, to] of mutants) {
    if (source.split(from).length !== 2) throw new Error(`${name}: edit is not unique`);
    let killed = false;
    try {
      await verify(source.replace(from, to));
    } catch (error) {
      if (!(error instanceof Fault)) throw error;
      killed = true;
    }
    if (!killed) throw new Error(`${name}: survived`);
    console.log(`killed ${name}`);
  }
}
console.log("LAUNCHER EXIT: 0");
