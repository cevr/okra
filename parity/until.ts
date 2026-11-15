// The --until property, replayed: each recorded text goes through
// `okra schedule x -s "every day at 9am" --until <text>` with TZ set per text,
// and the port's result is held to the TypeScript CLI's (Bun's Date.parse),
// recorded in parity/frozen/until-<seed>-<host zone>.json. The texts were drawn
// by seed from every production of the ECMAScript date-time format, each of
// Go's named layouts, both edges of daylight-saving changes in several zones,
// the edges of the range a Date holds, TZ spellings of the carried, ICU and
// host zone names, and near misses of all of these. The rule (owner, O6 q1/q2;
// parity/routing.md, Schedule):
//   - a text in the ECMAScript format: the same bytes, status and stored stop,
//     except a local time under a TZ that names no carried zone, which the
//     port refuses where Bun reads it as UTC (declared);
//   - a text in a Go named layout: the port reads it; the reference gives
//     the same instant, or refuses a form declared port-only;
//   - any other text: the same result, or the port refuses one that only
//     Bun's legacy parser reads, or, near a port-only form, the port reads
//     one Bun refuses (both declared). Never two different instants.
// Builds Go because the stored stop, stdout, stderr and the status are the
// user contract; the port runs with fakes first on PATH (launchctl, git, gh,
// okra), no scheduler, agent or network.
// A failing text prints "until parity mismatch: <n> <text> TZ=<zone>"; the
// replay is `bun parity/until.ts --seed=<seed> --only=<n>`.
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { frozen } from "./frozen";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o6";
const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const seed = Number(arg("seed") ?? 42);
const only = arg("only");
const first = process.argv.includes("--first");
const binary = arg("binary") ?? join(root, "bin/okra-ergo-parity");
// The host's own zone decides a TZ that names no zone, on both sides, so the
// records are per host zone: /etc/localtime's link target, or /etc/timezone
// beside a copied file.
function hostZone() {
  try {
    const link = readlinkSync("/etc/localtime");
    const at = link.indexOf("zoneinfo/");
    if (at >= 0) return link.slice(at + "zoneinfo/".length);
  } catch {
    /* a regular file: name it by /etc/timezone */
  }
  return readFileSync("/etc/timezone", "utf8").trim();
}
const host = hostZone();
const records = frozen("until", `${seed}-${host.replaceAll("/", "_")}`, only !== undefined);

type Kind = "es" | "go" | "near";
// unnamed: a TZ that names no zone, where the port refuses a local time;
// tzName: a TZ drawn from the zone name lists, where the port reads Bun's
// instant or refuses where Bun reads UTC.
type Item = {
  text: string;
  zone: string;
  kind: Kind;
  portOnly?: boolean;
  unnamed?: boolean;
  tzName?: boolean;
  why: string;
};

// ICU's id check (isValidOlsonID, ICU's putil.cpp), written here apart from
// the port: up to the first digit or comma no digit, then at most two
// digits, then the end; or exactly one of the four digit-named zones. ICU
// reads a TZ that fails it as the host's own zone (/etc/localtime), so
// there the port must give Bun's instant on every host.
function icuIdShaped(tz: string) {
  if (["PST8PDT", "MST7MDT", "CST6CDT", "EST5EDT"].includes(tz)) return true;
  return /^[^0-9,]*[0-9]{0,2}$/.test(tz);
}

const peer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response("unexpected", { status: 404 }),
});
const base = await mkdtemp(join(scratch, "until-"));
await chmod(base, 0o755);
const bin = join(base, "bin");
await mkdir(bin);
const fake = (name: string, text: string) =>
  writeFile(join(bin, name), `#!/bin/sh\n${text}\n`, { mode: 0o755 });
await fake("launchctl", "case $1 in list) exit 113 ;; *) exit 0 ;; esac");
await fake("git", "exit 128");
await fake("gh", "exit 1");
await fake("okra", "exit 0");

type Result = { code: number; out: string; err: string; stops: string };
async function runOne(program: string, item: Item, dir: string): Promise<Result> {
  await mkdir(join(dir, "work"), { recursive: true });
  const child = spawn(
    program,
    ["schedule", "x", "-s", "every day at 9am", `--until=${item.text}`],
    {
      cwd: join(dir, "work"),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        HOME: dir,
        PATH: `${bin}:/usr/bin:/bin`,
        NO_COLOR: "1",
        TERM: "dumb",
        TZ: item.zone,
        OKRA_PARITY_ORIGIN: `http://127.0.0.1:${peer.port}`,
        OKRA_PARITY_NOW: "1767268800000",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(scratch, "bun-cache"),
      },
    },
  );
  let out = "";
  let err = "";
  child.stdout!.on("data", (s: Buffer) => (out += s.toString("latin1")));
  child.stderr!.on("data", (s: Buffer) => (err += s.toString("latin1")));
  let active = true;
  const stop = () => {
    if (active && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already ended */
      }
    }
  };
  const timer = setTimeout(stop, 120_000); // only stops a hung run
  let code: number;
  try {
    code = await new Promise<number>((yes, no) => {
      child.once("error", no);
      child.once("close", (status, signal) =>
        signal ? no(new Error(`hung until run: ${signal}`)) : yes(status ?? 1),
      );
    });
  } finally {
    stop();
    active = false;
    clearTimeout(timer);
  }
  const ps = spawnSync("ps", ["-eo", "pid,pgid,stat"], { encoding: "utf8" });
  if (
    ps.status !== 0 ||
    ps.stdout.split("\n").some((l) => {
      const f = l.trim().split(/\s+/);
      return f[1] === String(child.pid) && !f[2]?.startsWith("Z");
    })
  )
    throw new Error("owned until process remains");
  const tasks = join(dir, ".okra/schedule/tasks");
  const names = await readdir(tasks).catch(() => [] as string[]);
  let stops = "";
  for (const name of names) {
    const id = name.replace(/\.json$/, "");
    out = out.replaceAll(id, "<ID>");
    err = err.replaceAll(id, "<ID>");
    stops += JSON.stringify(JSON.parse(await readFile(join(tasks, name), "utf8")).stopConditions);
  }
  // The case folder is a scratch path, which differs between the recorded
  // reference and a check.
  out = out.replaceAll(dir, "<DIR>");
  err = err.replaceAll(dir, "<DIR>");
  return { code, out, err, stops };
}

const tally = { equal: 0, bothRefuse: 0, bunOnly: 0, portOnly: 0 };
let mismatches = 0;
try {
  // The recorded texts, not the checking host's zone lists, are the corpus.
  for (const n of records.keys().map(Number)) {
    if (only !== undefined && String(n) !== only) continue;
    const dir = join(base, String(n));
    const { item, want } = records.get<{ item: Item; want: Result }>(String(n));
    const got = await runOne(binary, item, dir);
    const same =
      want.code === got.code &&
      want.out === got.out &&
      want.err === got.err &&
      want.stops === got.stops;
    const refused = (r: Result) =>
      r.code === 1 && r.stops === "" && r.err.includes("[INVALID_DATE]");
    let ok: boolean;
    if (item.unnamed) {
      // Declared: the port refuses a local time under a TZ naming no zone.
      ok = refused(got) && got.err.includes("TZ names no time zone");
      if (ok && want.code === 0) tally.bunOnly++;
      else if (ok) tally.bothRefuse++;
    } else if (item.tzName) {
      // Bun's instant, or a refusal where the TZ passes ICU's id check and
      // Bun reads it as UTC (declared).
      const utc = new Date(Date.parse(`${item.text}Z`)).toISOString();
      const bunUtc = want.code === 0 && want.stops.includes(JSON.stringify(utc));
      ok =
        same ||
        (icuIdShaped(item.zone) &&
          bunUtc &&
          refused(got) &&
          got.err.includes("TZ names no time zone"));
      if (ok && !same) tally.bunOnly++;
      else if (ok && refused(got)) tally.bothRefuse++;
      else if (ok) tally.equal++;
    } else if (same) {
      // A Go layout text is one the port reads.
      ok = item.kind !== "go" || got.code === 0;
      if (ok && refused(got)) tally.bothRefuse++;
      else if (ok) tally.equal++;
    } else if (item.kind === "es") ok = false;
    else if (item.kind === "go") {
      ok = got.code === 0 && item.portOnly === true && refused(want);
      if (ok) tally.portOnly++;
    } else if (refused(got) && want.code === 0) {
      ok = true;
      tally.bunOnly++;
    } else {
      // A near miss of a port-only form that Go still reads.
      ok = item.portOnly === true && got.code === 0 && refused(want);
      if (ok) tally.portOnly++;
    }
    if (!ok) {
      mismatches++;
      console.error(
        `until parity mismatch: ${n} ${JSON.stringify(item.text)} TZ=${item.zone} (${item.kind}, ${item.why})`,
      );
      console.error(`  reference ${JSON.stringify(want)}`);
      console.error(`  port      ${JSON.stringify(got)}`);
      if (first) break;
    } else if (process.argv.includes("--verbose"))
      console.log(
        `${n} ${JSON.stringify(item.text)} TZ=${item.zone} ${item.kind}: ${same ? "same" : "declared"}`,
      );
  }
} finally {
  await peer.stop(true);
}
const counted = tally.equal + tally.bothRefuse + tally.bunOnly + tally.portOnly;
if (mismatches > 0) {
  console.error(`UNTIL PARITY FAILED: ${mismatches} mismatches (seed ${seed})`);
  process.exit(1);
}
if (counted === 0) throw new Error("no until text selected");
records.done();
console.log(
  `UNTIL PARITY EXIT: 0 (${counted} texts, seed ${seed}: ${tally.equal} same instant, ${tally.bothRefuse} both refuse, ${tally.bunOnly} only Bun reads, ${tally.portOnly} only the port reads)`,
);
