// The --until property: seeded texts in every production of the ECMAScript
// date-time format, in each of Go's named layouts, at both edges of
// daylight-saving changes in several zones, and near misses of both, each
// run through `okra schedule x -s "every day at 9am" --until <text>` by the
// compiled reference (Bun's Date.parse) and by the port, with TZ set per
// text. The rule (owner, O6 q1/q2; parity/routing.md, Schedule):
//   - a text in the ECMAScript format: the same bytes, status and stored stop,
//     except a local time under a TZ that names no zone, which the port
//     refuses (Bun reads it as UTC; declared);
//   - a text in a Go named layout: the port reads it; the reference gives
//     the same instant, or refuses a form declared port-only;
//   - any other text: the same result, or the port refuses one that only
//     Bun's legacy parser reads, or, near a port-only form, the port reads
//     one Bun refuses (both declared). Never two different instants.
// Builds Go because the stored stop, stdout, stderr and the status are the
// user contract, and the reference is a Bun binary; both run with fakes
// first on PATH (launchctl, git, gh, okra), no scheduler, agent or network.
// A failing text prints "until parity mismatch: <n> <text> TZ=<zone>"; the
// replay is `bun parity/until.ts --seed=<seed> --only=<n>`.
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o6";
const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const seed = Number(arg("seed") ?? 42);
const only = arg("only");
const first = process.argv.includes("--first");
const reference = join(scratch, "okra-schedule-ts");
const binary = arg("binary") ?? join(root, "bin/okra-ergo-parity");
if (!(await Bun.file(reference).exists()))
  throw new Error(`no reference at ${reference}: run bun parity/schedule.ts --build-reference first`);

let state = seed >>> 0;
const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
// The high bits: an LCG's low bits repeat with a short period (the lowest
// alternates), which would tie one choice to the next.
const below = (n: number) => Math.floor((next() / 4294967296) * n);
const pick = <T>(xs: readonly T[]) => xs[below(xs.length)]!;
const two = (n: number) => String(n).padStart(2, "0");

type Kind = "es" | "go" | "near";
type Item = { text: string; zone: string; kind: Kind; portOnly?: boolean; unnamed?: boolean; why: string };
const items: Item[] = [];
const zones = [
  "UTC",
  "America/Toronto",
  "Asia/Kolkata",
  "Australia/Lord_Howe",
  "America/Sao_Paulo",
  "Europe/London",
  "Pacific/Chatham",
  "America/St_Johns",
  "America/Godthab", // a backward name some hosts' zoneinfo lacks: the port's carried tzdata has it
];
const add = (text: string, kind: Kind, why: string, portOnly = false, zone = pick(zones)) =>
  items.push({ text, zone, kind, portOnly, why });

// The ECMAScript format as the port reads it (Bun's ISO parser): a model
// written apart from the port's parser. A text the model calls valid must
// give the reference's result exactly, NaN included (out of range).
type Es = { year: string; month?: string; day?: string; t?: string; time?: string; zone?: string };
function esValid(e: Es) {
  if (e.year === "-000000") return false;
  if (!/^(\d{4}|[+-]\d{6})$/.test(e.year)) return false;
  if (e.month !== undefined && !/^(0[1-9]|1[0-2])$/.test(e.month)) return false;
  if (e.day !== undefined && (e.month === undefined || !/^(0[1-9]|[12]\d|3[01])$/.test(e.day))) return false;
  if (e.time === undefined) return e.zone === undefined && e.t === undefined;
  if (e.t !== "T" && e.t !== "t") return false;
  const m = /^(\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?$/.exec(e.time);
  if (!m) return false;
  const [h, mi, s, f] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
  if (mi > 59 || s > 59 || h > 24 || (h === 24 && (mi > 0 || s > 0 || f > 0))) return false;
  if (e.zone === undefined || e.zone === "Z" || e.zone === "z") return true;
  const z = /^[+-](\d\d):?(\d\d)$/.exec(e.zone);
  return z !== null && Number(z[1]) <= 23 && Number(z[2]) <= 59;
}
const esText = (e: Es) =>
  e.year + (e.month === undefined ? "" : `-${e.month}`) + (e.day === undefined ? "" : `-${e.day}`) +
  (e.time === undefined ? "" : `${e.t ?? ""}${e.time}`) + (e.zone ?? "");
function esYear() {
  return pick([
    "2026", "2027", "1999", "2024", "1970", "0001", "0099", "0100", "9999",
    "+002026", "-000001", "+000000", "-000000", "+275760", "-271821", "+010000", "02026", "26",
  ]);
}
function esTime(valid: boolean) {
  const h = valid ? below(25) : pick([24, 25, 99, below(24)]);
  const mi = valid ? (h === 24 ? 0 : below(60)) : pick([60, 99, below(60)]);
  const s = valid ? (h === 24 ? 0 : below(60)) : pick([60, below(60)]);
  const frac = h === 24 ? "0".repeat(1 + below(4)) : "123456789".slice(0, 1 + below(9));
  return pick([
    `${two(h)}:${two(mi)}`,
    `${two(h)}:${two(mi)}:${two(s)}`,
    `${two(h)}:${two(mi)}:${two(s)}.${frac}`,
    ...(valid ? [] : [`${two(h)}:${two(mi)}:${two(s)}.`, `${h}:${two(mi)}`, `${two(h)}${two(mi)}`, `${two(h)}:${two(mi)}:${two(s)},5`]),
  ]);
}
function esZone(valid: boolean) {
  const sign = pick(["+", "-"]);
  const h = valid ? below(24) : pick([24, 99, below(24)]);
  const m = valid ? pick([0, 30, 45, below(60)]) : pick([60, below(60)]);
  return pick([
    undefined, "Z", "z",
    `${sign}${two(h)}:${two(m)}`,
    `${sign}${two(h)}${two(m)}`,
    ...(valid ? [] : [`${sign}${two(h)}`, `${sign}${two(h)}:${m}`, " Z", "UTC"]),
  ]);
}
for (let i = 0; i < 110; i++) {
  const near = i % 3 === 2;
  const e: Es = { year: near ? esYear() : pick(["2026", "1999", "2024", "0001", "9999", "+002026", "-000001", "+275760", "-271821", "+000000"]) };
  const depth = below(4);
  if (depth >= 1) e.month = near ? pick(["00", "13", two(1 + below(12)), "1"]) : two(1 + below(12));
  if (depth >= 2) e.day = near ? pick(["00", "32", two(1 + below(31)), "7"]) : two(1 + below(31));
  if (depth === 3 || below(3) === 0) {
    e.t = near ? pick(["T", "t", " ", "_"]) : pick(["T", "T", "t"]);
    e.time = esTime(!near || below(2) === 0);
    e.zone = esZone(!near || below(2) === 0);
  } else if (near) e.zone = pick(["Z", "z", "+05:00", undefined]); // 0001Z: a zone after a date alone
  const text = esText(e);
  add(text, esValid(e) ? "es" : "near", "ecmascript");
}
// The edges of each production, each on a random date: hour 24, the
// largest offset, signed years, the last day of a month.
const date = () => `${pick(["2026", "1999", "+002026", "0001"])}-${two(1 + below(12))}-${two(1 + below(28))}`;
for (const [text, kind] of [
  [`${date()}T24:${two(1 + below(59))}`, "near"],
  [`${date()}T24:00:${two(1 + below(59))}`, "near"],
  [`${date()}T24:00:00.${1 + below(999)}`, "near"],
  [`${date()}T24:00${pick(["", ":00", ":00.000"])}${pick(["Z", "", "+01:00"])}`, "es"],
  [`${date()}T23:59:59.${"9".repeat(1 + below(9))}Z`, "es"],
  [`${date()}T${two(below(24))}:${two(below(60))}${pick(["+", "-"])}23:59`, "es"],
  [`${date()}T${two(below(24))}:${two(below(60))}${pick(["+", "-"])}24:00`, "near"],
  [`${date()}T${two(below(24))}:${two(below(60))}${pick(["+", "-"])}${two(below(24))}:60`, "near"],
  [`-000000-${two(1 + below(12))}-${two(1 + below(28))}T${two(below(24))}:00Z`, "near"],
  [`+000000-${two(1 + below(12))}-${two(1 + below(28))}T${two(below(24))}:00Z`, "es"],
  [`${pick(["2026", "2027"])}-${pick(["01", "03", "05", "07", "08", "10", "12"])}-31T${two(below(24))}:00Z`, "es"],
  [`${pick(["2026", "2027"])}-${pick(["04", "06", "09", "11", "02"])}-31`, "es"],
] as const)
  add(text, kind, "edge");
// The edges of the range a Date holds (8.64e15 ms either side of 1970).
for (const text of ["+275760-09-13T00:00:00.000Z", "+275760-09-13T00:00:00.001Z", "-271821-04-20T00:00:00.000Z", "-271821-04-19T23:59:59.999Z", "+275760-09-13T00:00", "-271821-04-20T00:00:00+00:01", "+275760-09-13T00:01+00:01"])
  add(text, "es", "range");
// Local wall clocks at both edges of that range, in every zone of the
// corpus (west and east of UTC), within 15 hours outside and inside each
// bound. Outside, Bun reads the zone's offset in an equivalent year
// (schedule.EquivalentWall); the instant may still be in the range. Fields
// from the day count, since a Date cannot hold such a wall clock.
function civil(ms: number) {
  const days = Math.floor(ms / 86400000);
  const rest = ms - days * 86400000;
  const z = days + 719468; // civil_from_days (H. Hinnant)
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const mo = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (mo <= 2 ? 1 : 0);
  return { y, mo, d: doy - Math.floor((153 * mp + 2) / 5) + 1, h: Math.floor(rest / 3600000), mi: Math.floor(rest / 60000) % 60, s: Math.floor(rest / 1000) % 60, milli: rest % 1000 };
}
function esLocal(ms: number) {
  const c = civil(ms);
  const year = c.y >= 0 && c.y <= 9999 ? String(c.y).padStart(4, "0") : `${c.y < 0 ? "-" : "+"}${String(Math.abs(c.y)).padStart(6, "0")}`;
  const seconds = c.milli !== 0 ? `:${two(c.s)}.${String(c.milli).padStart(3, "0")}` : c.s !== 0 || below(2) ? `:${two(c.s)}` : "";
  return `${year}-${two(c.mo)}-${two(c.d)}${pick(["T", "T", "t"])}${two(c.h)}:${two(c.mi)}${seconds}`;
}
const maxWall = 8.64e15;
for (const zone of zones)
  for (const bound of [-maxWall, maxWall])
    for (const outside of [true, false])
      for (let i = 0; i < 2; i++) {
        const away = pick([outside ? 1 : 0, 1000 * (1 + below(59)), 60000 * (1 + below(900)), 3600000 * (1 + below(15))]);
        const wall = bound + ((bound < 0) === outside ? -away : away);
        add(esLocal(wall), "es", `local range ${bound < 0 ? "low" : "high"} ${outside ? "outside" : "inside"}`, false, zone);
      }

// Go's named layouts, written from a random wall time.
const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const longDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number };
function wallOf(ms: number): Wall {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), wd: t.getUTCDay() };
}
const yearMs = (y: number) => {
  const t = new Date(0);
  t.setUTCFullYear(y, 0, 1);
  return t.getTime();
};
function randomWall(lo: number, hi: number) {
  const a = yearMs(lo);
  return wallOf(a + Math.floor(((next() * 4294967296 + next()) / 2 ** 64) * (yearMs(hi + 1) - a)));
}
const numericZone = () => `${pick(["+", "-"])}${two(below(24))}${two(pick([0, 0, 30, 45, below(60)]))}`;
const namedZone = () => pick(["UTC", "GMT", "EST", "EDT", "CST", "CDT", "MST", "MDT", "PST", "PDT"]);
const frac = () => pick(["", "", `.${"987654321".slice(0, 1 + below(9))}`]);
type Layout = { name: string; short: boolean; write: (w: Wall, f: string) => string; portOnly?: boolean };
const hms = (w: Wall, f: string) => `${two(w.h)}:${two(w.mi)}:${two(w.s)}${f}`;
const yy = (w: Wall) => two(w.y % 100);
const y4 = (w: Wall) => String(w.y).padStart(4, "0");
const _2 = (w: Wall) => (w.d < 10 ? ` ${w.d}` : String(w.d));
const layouts: Layout[] = [
  { name: "Layout", short: true, portOnly: true, write: (w, f) => `${two(w.mo + 1)}/${two(w.d)} ${two(w.h % 12 === 0 ? 12 : w.h % 12)}:${two(w.mi)}:${two(w.s)}${f}${w.h < 12 ? "AM" : "PM"} '${yy(w)} ${numericZone()}` },
  { name: "ANSIC", short: false, write: (w, f) => `${shortDays[w.wd]} ${months[w.mo]} ${_2(w)} ${hms(w, f)} ${y4(w)}` },
  { name: "UnixDate", short: false, write: (w, f) => `${shortDays[w.wd]} ${months[w.mo]} ${_2(w)} ${hms(w, f)} ${namedZone()} ${y4(w)}` },
  { name: "RubyDate", short: false, write: (w, f) => `${shortDays[w.wd]} ${months[w.mo]} ${two(w.d)} ${hms(w, f)} ${numericZone()} ${y4(w)}` },
  { name: "RFC822", short: true, write: (w) => `${two(w.d)} ${months[w.mo]} ${yy(w)} ${two(w.h)}:${two(w.mi)} ${namedZone()}` },
  { name: "RFC822Z", short: true, write: (w) => `${two(w.d)} ${months[w.mo]} ${yy(w)} ${two(w.h)}:${two(w.mi)} ${numericZone()}` },
  { name: "RFC850", short: true, write: (w, f) => `${longDays[w.wd]}, ${two(w.d)}-${months[w.mo]}-${yy(w)} ${hms(w, f)} ${namedZone()}` },
  { name: "RFC1123", short: false, write: (w, f) => `${shortDays[w.wd]}, ${two(w.d)} ${months[w.mo]} ${y4(w)} ${hms(w, f)} ${namedZone()}` },
  { name: "RFC1123Z", short: false, write: (w, f) => `${shortDays[w.wd]}, ${two(w.d)} ${months[w.mo]} ${y4(w)} ${hms(w, f)} ${numericZone()}` },
  { name: "RFC3339", short: false, write: (w, f) => `${y4(w)}-${two(w.mo + 1)}-${two(w.d)}T${hms(w, f)}${pick(["Z", `${numericZone().slice(0, 3)}:${two(pick([0, 30]))}`])}` },
  { name: "DateTime", short: false, write: (w, f) => `${y4(w)}-${two(w.mo + 1)}-${two(w.d)} ${hms(w, f)}` },
];
// Near misses of a Go text: forms Go refuses or Bun reads another way.
const goNear: [string, (t: string, w: Wall) => string][] = [
  ["lower case", (t) => t.toLowerCase()],
  ["other zone", (t) => t.replace(/\b(UTC|GMT|[ECMP][SD]T)\b/, pick(["CET", "JST", "GMT+3", "Z", "UT", "AEST"]))],
  ["year below 100", (t, w) => t.replace(String(w.y).padStart(4, "0"), pick(["0099", "0049", "0050", "0000", "0100"]))],
  ["two-digit year 50-68", (t, w) => t.replace(new RegExp(`([ '-])${yy(w)}( |$)`), `$1${50 + below(19)}$2`)],
  ["day past the month", (t, w) => t.replace(new RegExp(`\\b${two(w.d)}\\b`), pick(["31", "30", "00", "32"])).replace(months[w.mo]!, "Feb")],
  ["hour 24 or 25", (t, w) => t.replace(`${two(w.h)}:`, pick(["24:", "25:"]))],
  ["second 60", (t, w) => t.replace(`:${two(w.s)}`, ":60")],
  ["comma fraction", (t, w) => t.replace(new RegExp(`${hms(w, "")}(\\.\\d+)?`), hms(w, ",5"))],
  ["weekday wrong", (t) => t.replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/, pick(["Fun", "Sun", "Xyz"]))],
  ["spaces", (t) => pick([` ${t}`, `${t} `, t.replace(" ", "  ")])],
  ["one-digit day", (t, w) => t.replace(` ${two(w.d)} `, ` ${w.d} `)],
  ["offset 24 or 60", (t) => t.replace(/[+-]\d{4}$/, pick(["+2400", "-0060", "+2360"]))],
];
for (let i = 0; i < 4; i++) {
  for (const l of layouts) {
    const w = l.short ? pick([randomWall(1969, 2049), randomWall(2000, 2049)]) : pick([randomWall(1970, 2100), randomWall(100, 9999)]);
    const text = l.write(w, l.name === "RFC822" || l.name === "RFC822Z" ? "" : frac());
    add(text, l.name === "RFC3339" && esValidText(text) ? "es" : "go", `go ${l.name}`, l.portOnly ?? false);
    const [why, change] = pick(goNear);
    const near = change(text, w);
    // Go reads a comma before the fraction of seconds, and Bun reads no
    // text in the Layout form: what Go still reads there is port-only.
    if (near !== text) add(near, why === "comma fraction" ? "go" : "near", `go ${l.name} ${why}`, why === "comma fraction" || l.portOnly === true);
  }
}
{
  // An offset under an hour: Go's UnixDate takes "+0012" as a zone name
  // before RubyDate reads it as an offset.
  const w = randomWall(1970, 2100);
  add(`${shortDays[w.wd]} ${months[w.mo]} ${two(w.d)} ${hms(w, "")} ${pick(["+", "-"])}00${two(below(24))} ${y4(w)}`, "go", "go RubyDate offset under an hour");
}
function esValidText(text: string) {
  const m = /^([+-]\d{6}|\d{4})-(\d\d)-(\d\d)([Tt])([\d:.]+)(.*)$/.exec(text);
  return m !== null && esValid({ year: m[1]!, month: m[2], day: m[3], t: m[4], time: m[5], zone: m[6] === "" ? undefined : m[6] });
}

// Daylight-saving changes: the wall times at both edges of each change in
// a zone's year, and one inside the gap or the overlap, written in the
// ECMAScript local form and in the Go layouts with no zone.
const formats = new Map<string, Intl.DateTimeFormat>();
function offsetAt(zone: string, ms: number) {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formats.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  const t = new Date(0);
  t.setUTCFullYear(Number(p.year), Number(p.month) - 1, Number(p.day));
  t.setUTCHours(Number(p.hour), Number(p.minute), Number(p.second));
  return t.getTime() - Math.floor(ms / 1000) * 1000;
}
function changes(zone: string, year: number) {
  const out: { at: number; before: number; after: number }[] = [];
  const end = yearMs(year + 1);
  for (let t = yearMs(year); t < end; t += 86400000) {
    if (offsetAt(zone, t) === offsetAt(zone, t + 86400000)) continue;
    let [lo, hi] = [t, t + 86400000];
    while (hi - lo > 1000) {
      const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
      if (offsetAt(zone, mid) === offsetAt(zone, lo)) lo = mid;
      else hi = mid;
    }
    out.push({ at: hi, before: offsetAt(zone, lo), after: offsetAt(zone, hi) });
  }
  return out;
}
const localForms: [Kind, (w: Wall) => string][] = [
  ["es", (w) => `${y4(w)}-${two(w.mo + 1)}-${two(w.d)}T${two(w.h)}:${two(w.mi)}${w.s === 0 && below(2) ? "" : `:${two(w.s)}`}`],
  ["es", (w) => `${y4(w)}-${two(w.mo + 1)}-${two(w.d)}t${two(w.h)}:${two(w.mi)}:${two(w.s)}.${below(1000)}`],
  ["go", (w) => `${y4(w)}-${two(w.mo + 1)}-${two(w.d)} ${hms(w, "")}`],
  ["go", (w) => `${shortDays[w.wd]} ${months[w.mo]} ${_2(w)} ${hms(w, "")} ${y4(w)}`],
];
for (const zone of zones) {
  const years = [pick([1883, 1918, 1945, 1975, 1999]), pick([2007, 2016, 2026]), pick([2037, 2050, 2100])];
  for (const year of years) {
    const found = changes(zone, year);
    const walls: number[] = [];
    for (const c of found) {
      const a = c.at + c.before;
      const b = c.at + c.after;
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      walls.push(lo - 60000, lo, lo + Math.floor(below(Math.max(1, (hi - lo) / 60000))) * 60000, hi - 1000, hi, hi + 60000);
    }
    if (found.length === 0) walls.push(randomWallMs(year));
    for (const ms of walls) {
      const [kind, write] = pick(localForms);
      add(write(wallOf(ms)), kind, `local ${zone} ${year}`, false, zone);
    }
  }
}
function randomWallMs(year: number) {
  return yearMs(year) + below(365) * 86400000 + below(86400) * 1000;
}

// A TZ that names no zone (an unknown name, a path, a POSIX rule): Bun
// reads each as UTC, and Go too (a path as that file). The port refuses a
// local text there, never UTC in silence, and reads a text with a zone as
// Bun does.
for (const zone of ["Nowhere/Unknown", "/usr/share/zoneinfo/America/Toronto", "EST+5EDT,M3.2.0/2,M11.1.0/2", ":Etc/Nowhere"]) {
  const w = randomWall(1970, 2100);
  items.push({ text: `${y4(w)}-${two(w.mo + 1)}-${two(w.d)}T${two(w.h)}:${two(w.mi)}`, zone, kind: "es", unnamed: true, why: "TZ names no zone" });
  add(`${y4(w)}-${two(w.mo + 1)}-${two(w.d)}T${two(w.h)}:${two(w.mi)}${pick(["Z", "+05:30", "-03:00"])}`, "es", "TZ names no zone, text with a zone", false, zone);
}

// The forms okra's help and docs show, and the reference time.
for (const text of ["2026-03-20", "2026-03-20T10:00:00Z", "2026-03-20T10:00", "Mon Jan  2 15:04:05 MST 2006", "Mon, 02 Jan 2006 15:04:05 MST", "2006-01-02 15:04:05"])
  add(text, text.includes("Jan") || text.includes(" ") ? "go" : "es", "docs");
// Layouts with no year or no date: Go reads year 0, so the port refuses.
for (const text of ["3:04PM", "Jan  2 15:04:05", "Jan  2 15:04:05.000", "Jan  2 15:04:05.000000", "15:04:05"])
  add(text, "near", "no year");

const peer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unexpected", { status: 404 }) });
const base = await mkdtemp(join(scratch, "until-"));
await chmod(base, 0o755);
const bin = join(base, "bin");
await mkdir(bin);
const fake = (name: string, text: string) => writeFile(join(bin, name), `#!/bin/sh\n${text}\n`, { mode: 0o755 });
await fake("launchctl", 'case $1 in list) exit 113 ;; *) exit 0 ;; esac');
await fake("git", "exit 128");
await fake("gh", "exit 1");
await fake("okra", "exit 0");

type Result = { code: number; out: string; err: string; stops: string };
async function runOne(program: string, item: Item, dir: string): Promise<Result> {
  await mkdir(join(dir, "work"), { recursive: true });
  const child = spawn(program, ["schedule", "x", "-s", "every day at 9am", `--until=${item.text}`], {
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
  });
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
      child.once("close", (status, signal) => (signal ? no(new Error(`hung until run: ${signal}`)) : yes(status ?? 1)));
    });
  } finally {
    stop();
    active = false;
    clearTimeout(timer);
  }
  const ps = spawnSync("ps", ["-eo", "pid,pgid,stat"], { encoding: "utf8" });
  if (ps.status !== 0 || ps.stdout.split("\n").some((l) => { const f = l.trim().split(/\s+/); return f[1] === String(child.pid) && !f[2]?.startsWith("Z"); }))
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
  return { code, out, err, stops };
}

const tally = { equal: 0, bothRefuse: 0, bunOnly: 0, portOnly: 0 };
let mismatches = 0;
try {
  for (const [n, item] of items.entries()) {
    if (only !== undefined && String(n) !== only) continue;
    const dir = join(base, String(n));
    const want = await runOne(reference, item, dir);
    await rename(dir, `${dir}.ref`);
    const got = await runOne(binary, item, dir);
    const same = want.code === got.code && want.out === got.out && want.err === got.err && want.stops === got.stops;
    const refused = (r: Result) => r.code === 1 && r.stops === "" && r.err.includes("[INVALID_DATE]");
    let ok: boolean;
    if (item.unnamed) {
      // Declared: the port refuses a local time under a TZ naming no zone.
      ok = refused(got) && got.err.includes("TZ names no time zone");
      if (ok && want.code === 0) tally.bunOnly++;
      else if (ok) tally.bothRefuse++;
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
      console.error(`until parity mismatch: ${n} ${JSON.stringify(item.text)} TZ=${item.zone} (${item.kind}, ${item.why})`);
      console.error(`  reference ${JSON.stringify(want)}`);
      console.error(`  port      ${JSON.stringify(got)}`);
      if (first) break;
    } else if (process.argv.includes("--verbose")) console.log(`${n} ${JSON.stringify(item.text)} TZ=${item.zone} ${item.kind}: ${same ? "same" : "declared"}`);
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
console.log(`UNTIL PARITY EXIT: 0 (${counted} texts, seed ${seed}: ${tally.equal} same instant, ${tally.bothRefuse} both refuse, ${tally.bunOnly} only Bun reads, ${tally.portOnly} only the port reads)`);
