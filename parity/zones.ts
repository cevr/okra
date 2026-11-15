// The zone name lists the --until property and scripts/zone-names.ts draw
// from: the names of the tzdata Go carries (its lib/time/zoneinfo.zip),
// ICU's zone ids (parity/icu-zone-ids.txt), and the files of the host's
// zoneinfo.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

// The names in a zip: its central directory's file names.
export function zipNames(path: string) {
  const zip = readFileSync(path);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error(`not a zip: ${path}`);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50)
      throw new Error(`bad central directory entry ${i} in ${path}`);
    const nameLen = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    out.push(zip.toString("latin1", at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extra + comment;
  }
  return out.sort();
}

export function goEnv(name: string) {
  const r = spawnSync("go", ["env", name], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`go env ${name}: ${r.stderr}`);
  return r.stdout.trim();
}

export const carriedNames = () => zipNames(join(goEnv("GOROOT"), "lib/time/zoneinfo.zip"));

export const icuNamesFile = join(root, "parity/icu-zone-ids.txt");
export const icuNames = () =>
  readFileSync(icuNamesFile, "utf8")
    .split("\n")
    .filter((l) => l !== "" && !l.startsWith("#"));

// The host's zoneinfo files and links, as TZ names (relative paths).
export function hostZoneFiles(dir = "/usr/share/zoneinfo") {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const name = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(name);
      else out.push(name);
    }
  };
  try {
    walk("");
  } catch {
    return [];
  }
  return out.sort();
}
