// Build the native binaries the npm package ships: npm/<os>-<arch>/okra for
// each platform, with the pinned Ergo compiler (ergo-toolchain.json; ERGO names
// its binary, else `ergo` on PATH). bin/okra picks one at run time.
//
//   bun scripts/release.ts [--platform=linux/amd64,darwin/arm64]   build, then check
//   bun scripts/release.ts --check [--platform=...]                check only
//
// The check reads each file's header (format names the OS, machine the arch),
// requires the execute bit and the `--version` line of package.json's version.
// It runs no binary, so it holds for foreign platforms too. Builds only; it
// never publishes or links anything.
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

/** Go's GOOS/GOARCH to the npm directory, named as Node's process.platform/arch. */
export const platforms: Record<string, string> = {
  "darwin/amd64": "darwin-x64",
  "darwin/arm64": "darwin-arm64",
  "linux/amd64": "linux-x64",
  "linux/arm64": "linux-arm64",
};

/** The OS and arch a Mach-O or ELF header names, or why it names none. */
export function headerPlatform(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 20 && view.getUint32(0, false) === 0x7f454c46) {
    if (bytes[4] !== 2 || bytes[5] !== 1) return "an ELF file that is not 64-bit little-endian";
    const machine = view.getUint16(18, true);
    if (machine === 62) return "linux/amd64";
    if (machine === 183) return "linux/arm64";
    return `an ELF file for machine ${machine}`;
  }
  if (bytes.length >= 8 && view.getUint32(0, true) === 0xfeedfacf) {
    const cpu = view.getUint32(4, true);
    if (cpu === 0x01000007) return "darwin/amd64";
    if (cpu === 0x0100000c) return "darwin/arm64";
    return `a Mach-O file for CPU ${cpu.toString(16)}`;
  }
  return "neither ELF nor Mach-O";
}

async function run(command: string, args: string[]) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", detached: true });
  let active = true;
  const stop = () => {
    if (active && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already reaped */
      }
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status) => resolve(status ?? 1));
    });
    if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited ${code}`);
  } finally {
    stop();
    active = false;
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, stop);
  }
}

/** The faults of npm/<dir>/okra for platform, empty when it is releasable. */
export async function check(platform: string, version: string, dir = join(root, "npm")) {
  const path = join(dir, platforms[platform]!, "okra");
  const info = await stat(path).catch(() => undefined);
  if (!info) return [`${path} is missing`];
  const faults: string[] = [];
  if ((info.mode & 0o111) !== 0o111) faults.push(`${path} is not executable by all`);
  const bytes = new Uint8Array(await readFile(path));
  const named = headerPlatform(bytes);
  if (named !== platform) faults.push(`${path} is ${named}, not ${platform}`);
  if (!Buffer.from(bytes).includes(`okra v${version}`))
    faults.push(
      `${path} lacks the version line "okra v${version}" (bun scripts/build.ts --prepare)`,
    );
  return faults;
}

if (import.meta.main) {
  const option = process.argv.find((arg) => arg.startsWith("--platform="));
  const wanted = option ? option.slice("--platform=".length).split(",") : Object.keys(platforms);
  for (const platform of wanted)
    if (!(platform in platforms))
      throw new Error(
        `--platform ${platform}: the platforms are ${Object.keys(platforms).join(", ")}`,
      );
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (!process.argv.includes("--check")) {
    // The guides and the version line are generated Ergo sources.
    await run(process.execPath, ["scripts/build.ts", "--prepare"]);
    for (const platform of wanted) {
      const dir = join(root, "npm", platforms[platform]!);
      await mkdir(dir, { recursive: true });
      const partial = join(dir, "okra.partial");
      const ergo = process.env.ERGO ?? "ergo";
      await run(ergo, ["build", "--platform", platform, "-o", partial, "ergo/cmd/okra"]);
      await chmod(partial, 0o755);
      await rename(partial, join(dir, "okra"));
    }
  }
  const faults = (await Promise.all(wanted.map((p) => check(p, version)))).flat();
  for (const fault of faults) console.error(fault);
  if (faults.length) process.exit(1);
  console.log(`release ${version}: ${wanted.map((p) => platforms[p]).join(" ")}`);
}
