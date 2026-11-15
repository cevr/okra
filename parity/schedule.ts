// Builds Go because stdout/stderr/status, the files under HOME (tasks, the
// plist, logs), the argv each fake program received and the bytes an agent
// run tees to the terminal are the user contract; the checker cannot observe
// process effects. Every program the CLI starts is a fake in the case's bin
// folder, first on PATH: launchctl, claude, codex, git, gh, tail and okra.
// The real agents in /usr/local/bin are never reached: claude and codex are
// always present on PATH. No scheduler, agent, key or network is used. The
// clock is frozen (OKRA_PARITY_NOW) on both sides; task ids and stop nonces
// are random on both sides and are renamed in order of appearance.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { frozen } from "./frozen";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o6";
await mkdir(scratch, { recursive: true });
const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const seed = Number(arg("seed") ?? 42);
const tsOnly = process.argv.includes("--record-check");
const reference = join(scratch, "okra-schedule-ts");
const binary = arg("binary") ?? join(root, "bin/okra-ergo-parity");
if (process.argv.includes("--build-reference")) {
  const result = await Bun.build({
    entrypoints: [join(root, "parity/schedule-reference.ts")],
    target: "bun",
    compile: { outfile: reference, autoloadBunfig: false },
    define: {
      __VERSION__: JSON.stringify((await Bun.file(join(root, "package.json")).json()).version),
    },
  });
  if (!result.success) throw new Error(`reference build failed: ${result.logs.join("\n")}`);
}
// The port's parity entry needs a loopback origin; schedule makes no request.
const peer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response("unexpected", { status: 404 }),
});
const origin = `http://127.0.0.1:${peer.port}`;

type Reply = { out?: string; err?: string; status?: number };
type Git = Partial<Record<"branch" | "remote" | "commit" | "head" | "pr", string | null>>;
type Case = {
  name: string;
  steps: string[][]; // argv after "okra"; "$1".. name the ids created so far
  env?: Record<string, string>;
  replies?: Reply[]; // one per agent start, in order
  git?: Git | "none";
  launchctl?: Partial<Record<"list" | "load" | "unload", { status: number; err?: string }>>;
  loaded?: boolean; // a "launchctl list" of any label succeeds before the run
  files?: Record<string, string>; // created under HOME before the run
  setup?: (dir: string) => Promise<void>;
  cwd?: string;
  now?: number; // frozen clock, Unix milliseconds (whole seconds)
  usage?: boolean; // a usage error: help and error layout are the port's own
  unordered?: boolean; // list output with several tasks: directory order
  agents?: "badshebang";
  noOkra?: boolean;
};

const fullGit: Git = {
  branch: "feature/123-thing",
  remote: "git@github.com:me/proj.git",
  commit: "abc1234",
  head: "origin/main",
  pr: '{"number":42,"url":"https://example.invalid/pr/42"}',
};
const nonceReply: Reply = { out: "working\nall done {NONCE}\n" };
const task = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "fixed01",
    prompt: "check the build",
    provider: "claude",
    schedule: {
      _tag: "Cron",
      minute: 0,
      hour: 9,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "1-5",
      raw: "every weekday at 9am",
    },
    cwd: "WORK",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "active",
    runCount: 0,
    ...over,
  });
const tasks = (id: string, over: Record<string, unknown> = {}) => ({
  [`.okra/schedule/tasks/${id}.json`]: task({ id, ...over }),
});

const cases: Case[] = [
  { name: "bare", steps: [["schedule"]] },
  { name: "no-schedule", steps: [["schedule", "x"]] },
  { name: "invalid", steps: [["schedule", "x", "-s", "bogus"]] },
  { name: "empty-schedule", steps: [["schedule", "x", "-s", ""]] },
  {
    name: "weekday-create-list",
    steps: [
      ["schedule", "do it", "-s", "every weekday at 9am", "--max-runs", "3", "--stop-when", "pr merged"],
      ["schedule", "list"],
      ["schedule", "list", "--json"],
    ],
    git: fullGit,
  },
  {
    name: "codex-every-day",
    steps: [
      ["schedule", "λ prompt 🌱", "-p", "codex", "-s", "every day at 12:30 pm"],
      ["schedule", "list", "-j"],
    ],
  },
  {
    name: "named-days",
    steps: [
      ["schedule", "a", "-s", "every Sunday at 7:05 PM"],
      ["schedule", "b", "-s", "EVERY monday AT 12am"],
      ["schedule", "c", "-s", "every saturday at 11"],
    ],
  },
  {
    name: "oneshots",
    steps: [
      ["schedule", "a", "-s", "  In 2 Hours  "],
      ["schedule", "b", "-s", "in 1 minute"],
      ["schedule", "c", "-s", "in 3 days"],
      ["schedule", "d", "-s", "tomorrow at 12am"],
      ["schedule", "e", "-s", "tomorrow at 9:45pm"],
      ["schedule", "list"],
    ],
    unordered: true,
    now: 1798761599000, // 2026-12-31T23:59:59Z
  },
  {
    name: "cron-forms",
    steps: [
      ["schedule", "a", "-s", "0 9 * * 0-6"],
      ["schedule", "b", "-s", "*/5 * * * 1"],
      ["schedule", "c", "-s", "0x1F 1.5 -3 1e3 1"],
      ["schedule", "d", "-s", "99999999999999999999 9 * * 0"],
      ["schedule", "e", "-s", "0 9 * * 6-0"],
      ["schedule", "f", "-s", "0 9 * * 7"],
      ["schedule", "g", "-s", "0\t9  1 2 *"],
      ["schedule", "h", "-s", "5 * * * 3-4"],
      ["schedule", "list", "--json"],
    ],
    unordered: true,
  },
  {
    name: "odd-times",
    steps: [
      ["schedule", "a", "-s", "every day at 25pm"],
      ["schedule", "b", "-s", "every day at 9:5"],
      ["schedule", "c", "-s", "every day at 09:59am"],
      ["schedule", "d", "-s", "every weekday at 12pm"],
    ],
  },
  {
    name: "until-date-only",
    steps: [
      ["schedule", "x", "-s", "every day at 9am", "--until", "2026-03-20"],
      ["schedule", "list"],
      ["schedule", "list", "--json"],
    ],
  },
  {
    name: "until-forms",
    steps: [
      ["schedule", "a", "-s", "every day at 9am", "--until", "2026-03-20T10:00:00Z"],
      ["schedule", "b", "-s", "every day at 9am", "--until", "2026-03-20T10:00+02:00"],
      ["schedule", "c", "-s", "every day at 9am", "--until", "2026-03"],
      ["schedule", "d", "-s", "every day at 9am", "--until", "2027"],
      ["schedule", "e", "-s", "every day at 9am", "--until", "2026-03-20T10:00:00.5Z"],
      ["schedule", "f", "-s", "every day at 9am", "--until", "2026-03-20T10:00"],
      ["schedule", "list", "--json"],
    ],
    unordered: true,
    env: { TZ: "America/Toronto" },
  },
  {
    name: "until-invalid",
    steps: [["schedule", "x", "-s", "every day at 9am", "--until", "someday"]],
    git: fullGit,
  },
  {
    name: "stop-when-needs-fallback",
    steps: [["schedule", "x", "-s", "every day at 9am", "--stop-when", "done"]],
  },
  {
    name: "both-stops",
    steps: [
      ["schedule", "x", "-s", "every day at 9am", "--max-runs", "2", "--until", "2026-02-01", "--stop-when", "a very long condition text here"],
      ["schedule", "list"],
    ],
  },
  {
    name: "context-none",
    steps: [["schedule", "x", "-s", "in 5 minutes"], ["schedule", "list", "--json"]],
    git: "none",
  },
  {
    name: "context-partial",
    steps: [["schedule", "x", "-s", "in 5 minutes"], ["schedule", "list", "--json"]],
    git: { branch: "main", remote: "https://host/a/b/", commit: null, head: "upstream/dev", pr: '{"number":4.5}' },
  },
  {
    name: "context-issue",
    steps: [["schedule", "x", "-s", "in 5 minutes"], ["schedule", "list", "--json"]],
    git: { branch: "user/00-x-0042/y", remote: "a:b:c.git", pr: '{"number":"7","url":"u"}' },
  },
  {
    name: "context-pr-only",
    steps: [["schedule", "x", "-s", "in 5 minutes"], ["schedule", "list", "--json"]],
    git: { pr: '{"url":"https://u","extra":[1]}  ' },
  },
  {
    name: "context-pr-number",
    steps: [["schedule", "x", "-s", "in 5 minutes"]],
    git: { branch: "  \n", pr: '{"number":7,"url":null}', commit: "c" },
  },
  {
    name: "list-empty",
    steps: [["schedule", "list"], ["schedule", "list", "--json"]],
  },
  {
    name: "list-fixtures",
    steps: [["schedule", "list"], ["schedule", "list", "--json"]],
    files: {
      ...tasks("aa", {
        prompt: "a prompt that is certainly longer than forty characters in total",
        status: "completed",
        lastRun: "2026-01-02T00:00:00.000Z",
        runCount: 2,
        stopConditions: [{ _tag: "MaxRuns", count: 5 }, { _tag: "AfterDate", date: "2026-03-20T23:59:59.999Z" }],
        conditionalStop: { condition: "the pull request is merged" },
        extra: true,
      }),
    },
  },
  {
    name: "list-corrupt",
    steps: [["schedule", "list"]],
    files: {
      ...tasks("good"),
      ".okra/schedule/tasks/notes.txt": "x",
      ".okra/schedule/tasks/bad.json": "{",
      ".okra/schedule/tasks/wrong.json": task({ id: "wrong", status: "paused" }),
    },
    setup: (dir) => mkdir(join(dir, ".okra/schedule/tasks/dir.json"), { recursive: true }),
    unordered: true,
  },
  {
    name: "list-null-optional",
    steps: [["schedule", "list"]],
    files: tasks("nul", { lastRun: null }),
  },
  {
    name: "run-decode-mistyped",
    steps: [["schedule", "run", "mist"]],
    files: tasks("mist", { runCount: "1" }),
  },
  {
    name: "list-oneshot-fixture",
    steps: [["schedule", "list"], ["schedule", "list", "--json"]],
    files: tasks("one", {
      provider: "codex",
      schedule: { _tag: "Oneshot", at: "2026-05-05T05:05:05.000Z", raw: "in 2 days" },
      context: { gitBranch: "b", prNumber: 3 },
    }),
  },
  {
    name: "run-plain",
    steps: [["schedule", "run", "plain1"], ["schedule", "list", "--json"]],
    files: tasks("plain1"),
    replies: [{ out: "partial out", err: "agent err\n" }],
  },
  {
    name: "run-codex-context",
    steps: [["schedule", "run", "cx"], ["schedule", "list", "--json"]],
    files: tasks("cx", {
      provider: "codex",
      context: {
        gitBranch: "feature/9",
        gitRemoteUrl: "git@h:o/r.git",
        gitRepo: "r",
        gitCommit: "abc",
        gitDefaultBranch: "main",
        prNumber: 9,
        prUrl: "https://u/9",
        issueNumber: 9,
      },
    }),
    replies: [{ out: "line one\nline two\n", status: 3 }],
  },
  {
    name: "run-oneshot",
    steps: [["schedule", "run", "once"], ["schedule", "list", "--json"]],
    files: tasks("once", {
      schedule: { _tag: "Oneshot", at: "2026-01-01T13:00:00.000Z", raw: "in 1 hour" },
    }),
    loaded: true,
    replies: [{ out: "ok\n" }],
  },
  {
    name: "run-max-runs-pre",
    steps: [["schedule", "run", "maxed"], ["schedule", "list", "--json"]],
    files: tasks("maxed", { runCount: 3, stopConditions: [{ _tag: "MaxRuns", count: 3 }] }),
  },
  {
    name: "run-max-runs-post",
    steps: [["schedule", "run", "last"], ["schedule", "list", "--json"]],
    files: tasks("last", { runCount: 2, stopConditions: [{ _tag: "MaxRuns", count: 3 }] }),
    replies: [{ out: "x" }],
  },
  {
    name: "run-after-date",
    steps: [["schedule", "run", "late"]],
    files: tasks("late", { stopConditions: [{ _tag: "AfterDate", date: "2026-01-01T11:59:59.999Z" }] }),
  },
  {
    name: "run-before-date",
    steps: [["schedule", "run", "early"]],
    files: tasks("early", { stopConditions: [{ _tag: "AfterDate", date: "2026-01-01T12:00:00.000Z" }] }),
    replies: [{ out: "ran\n" }],
  },
  {
    name: "run-signal-verified",
    steps: [["schedule", "run", "sig"], ["schedule", "list", "--json"]],
    files: tasks("sig", {
      stopConditions: [{ _tag: "MaxRuns", count: 10 }],
      conditionalStop: { condition: 'the "PR" is merged' },
    }),
    replies: [nonceReply, { out: "  yes, it is\n" }],
  },
  {
    name: "run-signal-rejected",
    steps: [["schedule", "run", "sig"], ["schedule", "list", "--json"]],
    files: tasks("sig", {
      provider: "codex",
      stopConditions: [{ _tag: "MaxRuns", count: 10 }],
      conditionalStop: { condition: "done" },
    }),
    replies: [{ out: "{NONCE}" }, { out: "NO\n", err: "verifier noise\n" }],
  },
  {
    name: "run-no-signal",
    steps: [["schedule", "run", "sig"]],
    files: tasks("sig", {
      stopConditions: [{ _tag: "MaxRuns", count: 10 }],
      conditionalStop: { condition: "done" },
    }),
    replies: [{ out: "OKRA_STOP_00000000\n" }],
  },
  {
    name: "run-signal-long-output",
    steps: [["schedule", "run", "sig"]],
    files: tasks("sig", {
      stopConditions: [{ _tag: "MaxRuns", count: 10 }],
      conditionalStop: { condition: "done" },
    }),
    replies: [
      { out: Array.from({ length: 230 }, (_, i) => `line ${i}`).join("\n") + "\n{NONCE}\n\n" },
      { out: "Yes" },
    ],
  },
  {
    name: "run-invalid-utf8",
    steps: [["schedule", "run", "sig"]],
    files: tasks("sig", {
      stopConditions: [{ _tag: "MaxRuns", count: 10 }],
      conditionalStop: { condition: "done" },
    }),
    replies: [{ out: "bad \xff\xfe and cut \xe2\x82 end {NONCE}\n" }, { out: "no" }],
  },
  {
    name: "run-spawn-failed",
    steps: [["schedule", "run", "bad"], ["schedule", "list", "--json"]],
    files: tasks("bad"),
    agents: "badshebang",
  },
  {
    name: "run-missing-cwd",
    steps: [["schedule", "run", "gone"]],
    files: tasks("gone", { cwd: "/nonexistent/okra-parity-cwd" }),
  },
  { name: "run-not-found", steps: [["schedule", "run", "nothere"]] },
  { name: "run-invalid-id", steps: [["schedule", "run", "../x"]] },
  {
    name: "run-decode-failed",
    steps: [["schedule", "run", "broken"]],
    files: { ".okra/schedule/tasks/broken.json": '{"id":"broken"}' },
  },
  {
    name: "remove-loaded",
    steps: [["schedule", "remove", "gone"], ["schedule", "list"]],
    files: {
      ...tasks("gone"),
      ".okra/schedule/logs/gone.log": "old log\n",
      "Library/LaunchAgents/com.cvr.okra.schedule-gone.plist": "<plist/>\n",
    },
    loaded: true,
  },
  {
    name: "remove-missing",
    steps: [["schedule", "remove", "nothere"]],
  },
  {
    name: "remove-invalid-id",
    steps: [["schedule", "remove", "a b"]],
  },
  {
    name: "remove-unload-fails",
    steps: [["schedule", "remove", "stuck"]],
    files: tasks("stuck"),
    loaded: true,
    launchctl: { unload: { status: 5, err: "  Unload failed: 5: Input/output error  \n" } },
  },
  {
    name: "remove-unload-fails-silent",
    steps: [["schedule", "remove", "stuck"]],
    files: tasks("stuck"),
    loaded: true,
    launchctl: { unload: { status: 5 } },
  },
  {
    name: "create-load-fails",
    steps: [["schedule", "x", "-s", "every day at 9am"]],
    launchctl: { load: { status: 1, err: "Load failed: 5\n" } },
  },
  {
    name: "create-and-remove",
    steps: [
      ["schedule", "x", "-s", "every day at 9am"],
      ["schedule", "logs"],
      ["schedule", "remove", "$1"],
      ["schedule", "list", "--json"],
    ],
  },
  {
    name: "logs-list",
    steps: [["schedule", "logs"]],
    files: {
      ".okra/schedule/logs/a.log": "a\n",
      ".okra/schedule/logs/notes.txt": "n",
    },
  },
  {
    name: "logs-show",
    steps: [["schedule", "logs", "a"], ["schedule", "logs", "missing"]],
    files: { ".okra/schedule/logs/a.log": "first\nsecond" },
  },
  {
    name: "logs-follow",
    steps: [["schedule", "logs", "a", "-f"], ["schedule", "logs", "--follow", "a"]],
    files: { ".okra/schedule/logs/a.log": "x\n" },
  },
  {
    name: "no-okra-on-path",
    steps: [["schedule", "x", "-s", "every day at 9am"]],
    noOkra: true,
  },
  {
    name: "xml-escaping",
    steps: [["schedule", "x", "-s", "in 5 minutes"]],
    cwd: "a&b<c>'d\"",
  },
  {
    name: "invalid-schema-value",
    steps: [["schedule", "x", "-s", "x 9 * * *"], ["schedule", "list", "--json"]],
    git: fullGit,
  },
  { name: "provider-bad", steps: [["schedule", "x", "-s", "in 5 minutes", "-p", "gemini"]], usage: true },
  { name: "max-runs-bad", steps: [["schedule", "x", "-s", "in 5 minutes", "--max-runs", "abc"]], usage: true },
  { name: "list-extra", steps: [["schedule", "list", "extra"]], usage: true },
  { name: "remove-no-id", steps: [["schedule", "remove"]], usage: true },
  { name: "run-no-id", steps: [["schedule", "run"]], usage: true },
  { name: "logs-two-ids", steps: [["schedule", "logs", "a", "b"]], usage: true },
  { name: "root-version", steps: [["--version"], ["-v"], ["schedule", "list", "--version"], ["keys", "get", "x", "-v"]] },
  { name: "root-empty", steps: [[]] },
  { name: "root-version-after-dashdash", steps: [["how", "--", "--version"]] },
  { name: "root-unknown", steps: [["unknown"]], usage: true },
];

// Seeded cases: generated schedule texts (valid and invalid forms), stop
// flags and a run with a generated agent reply.
let state = seed >>> 0;
const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
const pick = <T>(xs: readonly T[]) => xs[next() % xs.length]!;
const scheduleTexts = () => {
  const h = String(next() % 14);
  const m = pick(["", ":00", ":07", ":30", ":5", ":99"]);
  const ampm = pick(["", "am", "pm", " PM", "Am"]);
  const day = pick(["monday", "Tuesday", "WEDNESDAY", "thursday", "friday", "saturday", "sunday", "funday"]);
  const field = () => pick(["*", "0", "5", "12", "59", "007", "1-5", "0-6", "2-2", "6", "7", "x"]);
  return pick([
    `every day at ${h}${m}${ampm}`,
    `every weekday at ${h}${m}${ampm}`,
    `every ${day} at ${h}${m}${ampm}`,
    `tomorrow at ${h}${m}${ampm}`,
    `in ${next() % 100} ${pick(["minute", "minutes", "hour", "Hours", "day", "days", "weeks"])}`,
    `${field()} ${field()} ${field()} ${field()} ${field()}`,
    `${field()} ${field()} ${field()} ${field()}`,
    `  every   day   at ${h}${ampm}  `,
  ]);
};
for (let i = 0; i < 16; i++) {
  const create = ["schedule", `seeded ${i}`, "-s", scheduleTexts()];
  if (next() % 3 === 0) create.push("--max-runs", String(next() % 3));
  if (next() % 3 === 0) create.push("--until", pick(["2025-12-31", "2026-01-01", "2026-06-30T00:00:00Z", "2026-13-01"]));
  if (next() % 4 === 0) create.push("--stop-when", "it is done");
  if (next() % 2 === 0) create.push("-p", pick(["claude", "codex"]));
  const out = pick(["", "plain\n", "no newline", "{NONCE}\n", "x\n{NONCE}"]);
  cases.push({
    name: `seed-${seed}-${i}`,
    steps: [create, ["schedule", "list", "--json"], ["schedule", "run", "$1"], ["schedule", "list"]],
    replies: [{ out, status: pick([0, 0, 1]) }, { out: pick(["YES", "no", " yes\n"]) }],
    git: pick([fullGit, "none" as const, { branch: "x/12" }]),
  });
}

const fakeAgent = (fixture: string) => `#!/bin/sh
export LC_ALL=C
f='${fixture}'
n=$(( $(cat "$f/count") + 1 ))
echo "$n" > "$f/count"
{ printf '%s' "\${0##*/}"; for a do printf '\\0%s' "$a"; done; printf '\\n'; pwd; printf -- '--\\n'; } >> "$f/agent.log"
nonce=
for a do
  case $a in *OKRA_STOP_*) nonce=$(printf '%s' "$a" | grep -o 'OKRA_STOP_[0-9a-f]*' | /usr/bin/tail -n 1) ;; esac
done
r="$f/reply.$n"
[ -f "$r.out" ] || r="$f/reply.none"
[ -f "$r.out" ] && sed "s/{NONCE}/$nonce/g" "$r.out"
[ -f "$r.err" ] && cat "$r.err" >&2
exit $(cat "$r.status" 2>/dev/null || echo 0)
`;

const fakeLaunchctl = (fixture: string, c: Case) => {
  const fail = (op: "list" | "load" | "unload") => {
    const f = c.launchctl?.[op];
    if (!f) return "";
    return `printf '%s' ${shq(f.err ?? "")} >&2; exit ${f.status}`;
  };
  return `#!/bin/sh
f='${fixture}'
printf '%s\\n' "launchctl $*" >> "$f/launchctl.log"
case $1 in
list) ${fail("list")}
  [ -f "$f/loaded/$2" ] || [ -f "$f/loaded/any" ] ;;
load) ${fail("load")}
  n=\${2##*/}; n=\${n%.plist}; mkdir -p "$f/loaded"; : > "$f/loaded/$n" ;;
unload) ${fail("unload")}
  n=\${2##*/}; n=\${n%.plist}; rm -f "$f/loaded/$n" "$f/loaded/any" ;;
*) exit 64 ;;
esac
`;
};

function shq(s: string) {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

function fakeGit(git: Git | "none") {
  const g = git === "none" ? {} : git;
  const answer = (v: string | null | undefined) =>
    v === undefined || v === null ? "exit 128" : `printf '%s\\n' ${shq(v)}`;
  return [
    `#!/bin/sh
case "$*" in
"rev-parse --abbrev-ref HEAD") ${answer(g.branch)} ;;
"remote get-url origin") ${answer(g.remote)} ;;
"rev-parse --short HEAD") ${answer(g.commit)} ;;
"rev-parse --abbrev-ref origin/HEAD") ${answer(g.head)} ;;
*) exit 1 ;;
esac
`,
    `#!/bin/sh
[ "$*" = "pr view --json number,url" ] || exit 2
${g.pr === undefined || g.pr === null ? "echo 'no pull requests found' >&2; exit 1" : `printf '%s' ${shq(g.pr)}`}
`,
  ];
}

async function setup(c: Case, dir: string, fixture: string) {
  await mkdir(join(dir, "bin"), { recursive: true });
  await mkdir(fixture, { recursive: true });
  await writeFile(join(fixture, "count"), "0\n");
  await writeFile(join(fixture, "agent.log"), "");
  await writeFile(join(fixture, "launchctl.log"), "");
  if (c.loaded) {
    await mkdir(join(fixture, "loaded"));
    await writeFile(join(fixture, "loaded/any"), "");
  }
  for (const [i, r] of (c.replies ?? []).entries()) {
    await writeFile(join(fixture, `reply.${i + 1}.out`), Buffer.from(r.out ?? "", "latin1"));
    await writeFile(join(fixture, `reply.${i + 1}.err`), r.err ?? "");
    await writeFile(join(fixture, `reply.${i + 1}.status`), String(r.status ?? 0));
  }
  const bin = (name: string, text: string, mode = 0o755) =>
    writeFile(join(dir, "bin", name), text, { mode });
  for (const agent of ["claude", "codex"])
    await bin(agent, c.agents === "badshebang" ? "#!/nonexistent/interpreter\n" : fakeAgent(fixture));
  await bin("launchctl", fakeLaunchctl(fixture, c));
  const [git, gh] = fakeGit(c.git ?? fullGit);
  await bin("git", git!);
  await bin("gh", gh!);
  await bin("tail", `#!/bin/sh\nprintf 'tail'; printf ' [%s]' "$@"; printf '\\n'; cat "$2"\n`);
  if (!c.noOkra) await bin("okra", "#!/bin/sh\nexit 0\n");
  const work = join(dir, c.cwd ?? "work");
  await mkdir(work, { recursive: true });
  for (const [rel, text] of Object.entries(c.files ?? {})) {
    const path = join(dir, rel);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text.replaceAll('"WORK"', JSON.stringify(work)));
  }
  if (c.setup) await c.setup(dir);
}

// dir: the case folder, a scratch path that differs between the recorded
// reference and a check, shown as <DIR>.
type Renames = { ids: Map<string, string>; nonces: Map<string, string>; dir: string };
// Declared difference: why a task file does not decode is each side's own
// text (Effect Schema's or the port's); the line and its code are compared.
function causes(text: string) {
  const out: string[] = [];
  let warning = false;
  for (const line of text.replace(/^(\[DECODE_FAILED\] Decode failed: )[^]*$/m, "$1<CAUSE>\n").split("\n")) {
    const m = /^(Warning: skipping corrupt task file [^:]*: )/.exec(line);
    if (m) out.push(`${m[1]}<CAUSE>`);
    else if (!(warning && line.startsWith("  "))) out.push(line);
    warning = m !== null || (warning && line.startsWith("  "));
  }
  return out.join("\n");
}
function normalize(text: string, r: Renames) {
  let out = causes(text).replaceAll(r.dir, "<DIR>");
  for (const m of out.matchAll(/OKRA_STOP_[0-9a-f]{8}/g))
    if (!r.nonces.has(m[0])) r.nonces.set(m[0], `OKRA_STOP_<N${r.nonces.size + 1}>`);
  for (const [from, to] of [...r.ids, ...r.nonces]) out = out.replaceAll(from, to);
  return out;
}

async function snapshot(dir: string, r: Renames, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(join(dir, rel))).sort()) {
    const path = join(rel, name);
    if (path === "bin") continue;
    const info = await lstat(join(dir, path));
    if (info.isDirectory()) {
      out.push(`${normalize(path, r)}/ ${(info.mode & 0o777).toString(8)}`);
      out.push(...(await snapshot(dir, r, path)));
      continue;
    }
    const shown = normalize((await readFile(join(dir, path))).toString("latin1"), r);
    out.push(
      `${normalize(path, r)} ${(info.mode & 0o777).toString(8)} ${createHash("sha256").update(shown).digest("hex").slice(0, 16)} ${shown.length < 1200 ? JSON.stringify(shown) : ""}`,
    );
  }
  return out;
}

async function step(program: string, args: string[], c: Case, dir: string) {
  const env: Record<string, string> = {
    HOME: dir,
    PATH: `${dir}/bin:/usr/bin:/bin`,
    NO_COLOR: "1",
    TERM: "dumb",
    TZ: "UTC",
    OKRA_PARITY_ORIGIN: origin,
    OKRA_PARITY_NOW: String(c.now ?? 1767268800000), // 2026-01-01T12:00:00Z
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(scratch, "bun-cache"),
    ...c.env,
  };
  const child = spawn(program, args, {
    cwd: join(dir, c.cwd ?? "work"),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
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
  const timer = setTimeout(stop, 120_000); // only stops a hung schedule case
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  child.stdout!.on("data", (s: Buffer) => out.push(s));
  child.stderr!.on("data", (s: Buffer) => err.push(s));
  let code: number;
  try {
    code = await new Promise<number>((yes, no) => {
      child.once("error", no);
      child.once("close", (status, signal) =>
        signal ? no(new Error(`hung schedule case ${c.name}: ${signal}`)) : yes(status ?? 1),
      );
    });
  } finally {
    stop();
    active = false;
    clearTimeout(timer);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, stop);
  }
  const ps = spawnSync("ps", ["-eo", "pid,pgid,stat,comm"], { encoding: "utf8" });
  if (
    ps.status !== 0 ||
    ps.stdout.split("\n").some((line) => {
      const f = line.trim().split(/\s+/);
      return f[1] === String(child.pid) && !f[2]?.startsWith("Z");
    })
  )
    throw new Error("owned schedule process remains");
  return {
    out: Buffer.concat(out).toString("latin1"),
    err: Buffer.concat(err).toString("latin1"),
    code,
  };
}

// unordered sorts the rows after a header, or the elements of a JSON array
// (re-encoded), because the reference lists tasks in directory order.
function unordered(text: string) {
  if (text.startsWith("[")) {
    const items = JSON.parse(Buffer.from(text, "latin1").toString()) as unknown[];
    return JSON.stringify(items.map((x) => JSON.stringify(x)).sort());
  }
  const [head, ...rows] = text.split("\n");
  return [head, ...rows.sort()].join("\n");
}

async function execute(program: string, c: Case, dir: string) {
  const fixture = `${dir}.fixture`;
  await mkdir(dir);
  await setup(c, dir, fixture);
  const r: Renames = { ids: new Map(), nonces: new Map(), dir };
  const taskDir = join(dir, ".okra/schedule/tasks");
  const stored = async () =>
    (await readdir(taskDir).catch(() => [] as string[])).map((n) => n.replace(/\.json$/, ""));
  const fixed = new Set(await stored());
  const results = [];
  for (const raw of c.steps) {
    const args = raw.map((a) => (/^\$\d$/.test(a) ? ([...r.ids.keys()][Number(a[1]) - 1] ?? a) : a));
    const got = await step(program, args, c, dir);
    // A created task is named by its new file (a failed load keeps it).
    for (const id of await stored())
      if (!fixed.has(id) && !r.ids.has(id)) r.ids.set(id, `<ID${r.ids.size + 1}>`);
    const res = { args: raw, out: normalize(got.out, r), err: normalize(got.err, r), code: got.code };
    if (c.unordered && raw.includes("list")) {
      res.out = unordered(res.out);
      res.err = res.err.split("\n").sort().join("\n");
    }
    results.push(res);
  }
  return {
    steps: results,
    files: (await snapshot(dir, r)).sort(), // ids are renamed, so sort after
    agents: normalize(await readFile(join(fixture, "agent.log"), "latin1"), r),
    launchctl: normalize(await readFile(join(fixture, "launchctl.log"), "latin1"), r),
  };
}

const records = frozen("schedule", seed, Boolean(arg("case")));
let count = 0;
try {
  for (const c of cases.filter((x) => !arg("case") || x.name === arg("case"))) {
    // Both programs run in one folder path; the first run's folder is moved aside.
    const base = await mkdtemp(join(scratch, "schedule-"));
    await chmod(base, 0o755);
    const dir = join(base, "case");
    const want = await records.get(c.name, async () => {
      const result = await execute(reference, c, dir);
      await rename(dir, `${dir}.ref`);
      await rename(`${dir}.fixture`, `${dir}.ref.fixture`);
      return result;
    });
    if (process.argv.includes("--dump")) console.log(JSON.stringify({ case: c.name, want }, null, 1));
    const got = await execute(tsOnly ? reference : binary, c, dir);
    if (c.usage && !tsOnly) {
      for (const [i, w] of want.steps.entries()) {
        const g = got.steps[i]!;
        if (w.code !== 1 || g.code !== 1 || !g.out.includes("okra") || g.err === "")
          throw new Error(`usage lost help/error/status: ${c.name} ${JSON.stringify(g)}`);
        g.out = w.out;
        g.err = w.err;
      }
    }
    if (!isDeepStrictEqual(want, got)) {
      console.error(
        JSON.stringify(
          { seed, case: c, want, got, replay: `bun parity/schedule.ts --seed=${seed} --case=${c.name}` },
          null,
          2,
        ),
      );
      throw new Error(`schedule parity mismatch: ${c.name}`);
    }
    if (want.steps.some((s) => s.err.includes("refuses"))) throw new Error(`invalid reference ${c.name}`);
    console.log(`schedule ${c.name}: ${want.steps.map((s) => s.code).join(",")}`);
    count++;
  }
  if (count === 0) throw new Error("no schedule cases selected");
  records.done();
  console.log(`SCHEDULE PARITY EXIT: 0 (${count} cases, seed ${seed})`);
} finally {
  await peer.stop(true);
}
