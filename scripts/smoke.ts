// Smoke the npm package the way a user gets it: pack it, install the tarball
// with bun and with npm into a clean HOME, then run the installed `okra` on
// this host: --version, --help, and two fixed cases (`how`, `keys get missing`
// in an empty HOME) byte-equal to the TypeScript reference bin/okra-ts (bun run
// build). It runs after scripts/release.ts has built at least this host's
// binary. Offline: the package has no dependencies, and the cases reach no
// network.
//
//   bun scripts/smoke.ts [--scratch=DIR]
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const base =
  process.argv.find((arg) => arg.startsWith("--scratch="))?.slice(10) ?? "/tmp/opencode/okra-smoke";
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "smoke-"));
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const hostPath = process.env.PATH ?? "/usr/bin:/bin";

async function run(command: string, args: string[], env: Record<string, string>, cwd = scratch) {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  child.stdout.on("data", (data) => (out += data));
  child.stderr.on("data", (data) => (err += data));
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) =>
        signal ? reject(new Error(`${command} stopped: ${signal}`)) : resolve(status ?? 1),
      );
    });
    return { out, err, code };
  } finally {
    stop();
    active = false;
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, stop);
  }
}

function must(ok: boolean, what: string, detail: unknown) {
  if (!ok) throw new Error(`smoke: ${what}: ${JSON.stringify(detail)}`);
}

// Pack. --ignore-scripts: `prepare` installs git hooks; prepack's check runs here.
const packEnv = { PATH: hostPath, HOME: join(scratch, "pack-home") };
const checked = await run(
  process.execPath,
  [join(root, "scripts/release.ts"), "--check", `--platform=${hostPlatform()}`],
  packEnv,
  root,
);
must(checked.code === 0, "release check", checked);
const packed = await run(
  "npm",
  [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    scratch,
    "--cache",
    join(scratch, "npm-cache"),
  ],
  packEnv,
  root,
);
must(packed.code === 0, "npm pack", packed);
const [{ filename, files }] = JSON.parse(packed.out);
const tarball = join(scratch, filename);
const listed: string[] = files.map((f: { path: string }) => f.path);
must(listed.includes("bin/okra"), "the package has bin/okra", listed);
must(
  listed.includes(`npm/${npmDir(hostPlatform())}/okra`),
  "the package has this host's binary",
  listed,
);
must(
  !listed.some(
    (p) =>
      p.startsWith("src/") ||
      p.startsWith("ergo/") ||
      p.startsWith("bin/okra-") ||
      p.endsWith(".partial"),
  ),
  "the package ships only the launcher, the native binaries and skills",
  listed,
);
const modes = spawnSync("tar", ["tvzf", tarball], { encoding: "utf8" }).stdout;
const executables = modes.split("\n").filter((l) => / package\/(bin\/okra|npm\/.*\/okra)$/.test(l));
must(executables.length >= 2, "the tarball lists the launcher and a binary", modes);
for (const line of executables)
  must(line.startsWith("-rwxr-xr-x"), "executables keep their mode in the tarball", line);

// Install into clean homes.
const installs: [string, string][] = [];
{
  const home = join(scratch, "home-bun");
  const env = {
    PATH: hostPath,
    HOME: home,
    BUN_INSTALL: join(home, ".bun"),
    BUN_INSTALL_CACHE_DIR: join(home, "bun-cache"),
  };
  await mkdir(home);
  const got = await run(process.execPath, ["add", "-g", tarball], env, home);
  must(got.code === 0, "bun add -g", got);
  installs.push(["bun", join(home, ".bun/bin/okra")]);
}
{
  const home = join(scratch, "home-npm");
  const env = { PATH: hostPath, HOME: home, npm_config_cache: join(home, "npm-cache") };
  await mkdir(home);
  const got = await run(
    "npm",
    ["install", "-g", "--prefix", join(home, "prefix"), tarball],
    env,
    home,
  );
  must(got.code === 0, "npm install -g", got);
  installs.push(["npm", join(home, "prefix/bin/okra")]);
}

// The fixed cases, against the TypeScript reference in an empty HOME.
const reference = join(root, "bin/okra-ts");
const cases = [["how"], ["keys", "get", "missing"]];
const expected: { out: string; err: string; code: number }[] = [];
for (const args of cases) {
  const home = await mkdtemp(join(scratch, "reference-"));
  expected.push(await run(reference, args, { PATH: "/usr/bin:/bin", HOME: home }, home));
}
for (const [tool, okra] of installs) {
  const work = await mkdtemp(join(scratch, `run-${tool}-`));
  const env = { PATH: "/usr/bin:/bin", HOME: work }; // no bun, node or key on PATH/env
  const v = await run(okra, ["--version"], env, work);
  must(v.code === 0 && v.err === "" && v.out === `okra v${version}\n`, `${tool}: --version`, v);
  const help = await run(okra, ["--help"], env, work);
  must(help.code === 0 && help.out.includes("Commands:"), `${tool}: --help`, help);
  for (const [i, args] of cases.entries()) {
    const got = await run(okra, args, env, work);
    const want = expected[i]!;
    must(
      got.out === want.out && got.err === want.err && got.code === want.code,
      `${tool}: okra ${args.join(" ")} against the reference`,
      { got, want },
    );
  }
  const leftovers = await readdir(work);
  must(leftovers.length === 0, `${tool}: the fixed cases wrote no files`, leftovers);
  console.log(`${tool}: ${okra} --version, --help, how, keys get passed`);
}
console.log(`SMOKE EXIT: 0 (${filename})`);

function hostPlatform() {
  const os = process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  return `${os}/${arch}`;
}
function npmDir(platform: string) {
  return platform.replace("/amd64", "-x64").replace("/arm64", "-arm64").replace("/", "-");
}
