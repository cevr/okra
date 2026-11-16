// Builds Go because stdout/stderr/status, the run folder's files and the
// agent programs' argv are the user contract; the checker cannot observe
// process effects. The agents are fake executables in each case folder that
// replay fixed text (recorded against the TS reference); the model catalog is
// one loopback peer. No real agent, model, key or paid service is reached.
// No run is repeated: a fake agent exits only after the CLI's events and
// stderr files hold all it wrote, so the reference's forked sinks (which
// end at the agent's exit) cannot lose output; `complete` checks both sides.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { frozen } from "./frozen";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o5";
await mkdir(scratch, { recursive: true });
const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const seed = Number(arg("seed") ?? 42);
const binary = arg("binary") ?? join(root, "bin/okra-ergo-parity");

const catalog = {
  openai: {
    models: {
      "gpt-6-sol": { family: "gpt-sol", release_date: "2026-09-22" },
      "gpt-6.1-sol": { family: "gpt-sol", release_date: "2026-09-29" },
      "gpt-6.2-sol": { family: "gpt-sol", release_date: "2026-10-03" },
      "gpt-9-sol": { family: "gpt-sol", release_date: "2026-10-01", status: "deprecated" },
    },
  },
};
let requests: string[] = [];
const peer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    requests.push(`${req.method} ${path} ${req.headers.get("user-agent") ?? ""}`);
    if (path === "/catalog/api.json") return Response.json(catalog);
    return new Response("unexpected", { status: 404 });
  },
});
const origin = `http://127.0.0.1:${peer.port}`;

// An agent's scripted reply. `by` replies per --model value (Codex fallback).
type Reply = { out?: string; err?: string; status?: number };
type Case = {
  name: string;
  args: string[];
  env?: Record<string, string>;
  stdin?: string;
  reply?: Reply;
  by?: Record<string, Reply>;
  agents?: "both" | "none" | "plain" | "badshebang" | "dir";
  models?: "fresh" | "fetch";
  setup?: (dir: string) => Promise<void>;
  cwd?: string; // a folder below the case folder to run in
  usage?: boolean;
};

const claudeOk: Reply = {
  out:
    '{"type":"system","subtype":"init","model":"claude-opus-fixture"}\n' +
    '{"type":"assistant","message":{"content":[]}}\n' +
    '{"type":"result","subtype":"success","result":"Looks fine.\\nOne risk."}\n',
  err: "claude warning\n",
};
const codexOk: Reply = {
  out:
    '{"type":"thread.started","thread_id":"t"}\n' +
    '{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}\n' +
    '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}\n' +
    '{"type":"item.completed","item":{"type":"agent_message","text":"Answer λ 🌱"}}\n' +
    '{"type":"turn.completed"}\n',
};
const rejected: Reply = {
  out: '{"type":"turn.failed","error":{"message":"The model is not supported when using Codex with a ChatGPT account."}}\n',
  status: 1,
};
const run = (...args: string[]) => ["--from", "claude", "-o", "out", ...args];
const cases: Case[] = [
  { name: "dry-claude-to-codex", args: ["--from", "claude", "--dry-run", "review this"] },
  { name: "dry-codex-to-claude-deep", args: ["--from", "codex", "--deep", "--dry-run", "x"] },
  { name: "dry-codex-deep", args: ["--from", "claude", "--deep", "--dry-run", "x"] },
  { name: "dry-relative-out", args: ["--from", "codex", "--dry-run", "-o", "a/../b/./c/", "x"] },
  {
    name: "dry-absolute-out",
    args: ["--from", "codex", "--dry-run", "--output-dir=/var/tmp/x//y", "x"],
  },
  { name: "dry-empty-out", args: ["--from", "codex", "--dry-run", "-o", "", "x"] },
  { name: "dry-empty-prompt", args: ["--from", "codex", "--dry-run", ""] },
  { name: "marker-claudecode", args: ["--dry-run", "x"], env: { CLAUDECODE: "1" } },
  { name: "marker-entrypoint", args: ["--dry-run", "x"], env: { CLAUDE_CODE_ENTRYPOINT: "cli" } },
  { name: "marker-codex-thread", args: ["--dry-run", "x"], env: { CODEX_THREAD_ID: "t" } },
  { name: "marker-codex-ci", args: ["--dry-run", "x"], env: { CODEX_CI: "1" } },
  { name: "marker-both", args: ["--dry-run", "x"], env: { CLAUDECODE: "1", CODEX_CI: "1" } },
  { name: "marker-none", args: ["--dry-run", "x"] },
  { name: "marker-empty", args: ["--dry-run", "x"], env: { CLAUDECODE: "" } },
  { name: "from-overrides", args: ["--from", "codex", "--dry-run", "x"], env: { CLAUDECODE: "1" } },
  { name: "prompt-file", args: ["--from", "codex", "--dry-run", "-f", "prompt.md"] },
  { name: "prompt-file-eq", args: ["--from", "codex", "--dry-run", "--file=sub/../prompt.md"] },
  { name: "prompt-stdin", args: ["--from", "codex", "--dry-run"], stdin: "  piped prompt \n" },
  {
    name: "prompt-stdin-blank",
    args: ["--from", "codex", "--dry-run"],
    stdin: " \t\n\u3000\ufeff",
  },
  { name: "prompt-stdin-nel", args: ["--from", "codex", "--dry-run"], stdin: "\u0085" },
  { name: "prompt-stdin-ignored", args: ["--from", "codex", "--dry-run", "inline"], stdin: "x" },
  { name: "conflict-file", args: ["--from", "codex", "--dry-run", "-f", "prompt.md", "x"] },
  { name: "conflict-stdin", args: ["--from", "codex", "--dry-run", "-f", "prompt.md"], stdin: "y" },
  { name: "missing", args: ["--from", "codex", "--dry-run"] },
  { name: "file-missing", args: ["--from", "codex", "-o", "out", "-f", "nofile"] },
  { name: "file-denied", args: ["--from", "codex", "-o", "out", "-f", "secret.md"] },
  { name: "file-dir", args: ["--from", "codex", "-f", "sub"], usage: true },
  { name: "file-under-file", args: ["--from", "codex", "-f", "prompt.md/x"], usage: true },
  { name: "file-loop", args: ["--from", "codex", "-f", "loop1"], usage: true },
  { name: "bad-from", args: ["--from", "bob", "x"], usage: true },
  { name: "two-prompts", args: ["--from", "codex", "x", "y"], usage: true },
  { name: "file-twice", args: ["--from", "codex", "-f", "a", "-f", "b"], usage: true },
  { name: "unknown-flag", args: ["--from", "codex", "--nope", "x"], usage: true },
  { name: "not-installed", args: ["--from", "codex", "--dry-run", "x"], agents: "none" },
  { name: "not-executable", args: ["--from", "claude", "--dry-run", "x"], agents: "plain" },
  { name: "agent-dir", args: ["--from", "claude", "--dry-run", "x"], agents: "dir" },
  { name: "codex-models-fresh", args: ["--from", "claude", "--dry-run", "x"], models: "fresh" },
  { name: "codex-models-fetch", args: ["--from", "claude", "--dry-run", "x"], models: "fetch" },
  { name: "claude-ok", args: ["--from", "codex", "-o", "out", "review"], reply: claudeOk },
  {
    name: "claude-deep-file",
    args: ["--from", "codex", "--deep", "-o", "out", "-f", "prompt.md"],
    reply: claudeOk,
  },
  {
    name: "claude-stdin",
    args: ["--from", "codex", "-o", "out"],
    stdin: "λ prompt\n",
    reply: claudeOk,
  },
  {
    name: "claude-error-subtype",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: { out: '{"type":"result","subtype":"error_max_turns","is_error":true}\n' },
  },
  {
    name: "claude-is-error",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: { out: '{"type":"result","subtype":"success","is_error":true,"result":"boom"}\n' },
  },
  {
    name: "claude-mistyped",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: {
      out:
        '{"type":"result","subtype":5}\n{"type":"result","subtype":"success","is_error":null,"result":"null flag"}\n' +
        '{"type":"result","subtype":"success","result":7}\n[1]\n"result"\n{"type":"result","subtype":"success"}\n' +
        '{"type":"result","subtype":"success","result":"late"}\n',
    },
  },
  {
    name: "claude-silent",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: { err: "no output\n", status: 3 },
  },
  {
    name: "claude-garbage",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: { out: "Error: offline\n" },
  },
  { name: "claude-cut", args: ["--from", "codex", "-o", "out", "x"], reply: { out: "hello" } },
  {
    name: "claude-later-garbage",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: { out: '{"type":"result","subtype":"success","result":"a"}\nnot json\n' },
  },
  {
    name: "claude-crlf-blank",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: {
      out: '\r\n\n  {"type":"system","subtype":"init","model":"m2"}\t\r\n{"type":"result","subtype":"success","result":"b"}',
    },
  },
  {
    name: "claude-exit-with-answer",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: { out: '{"type":"result","subtype":"success","result":"c"}\n', status: 2 },
  },
  {
    name: "claude-duplicate-keys",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: {
      out: '{"type":"x","type":"result","subtype":"success","result":"first","result":"second"}\n',
    },
  },
  {
    name: "claude-nested",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: {
      out:
        '[[1],{"b":{"c":[{}]}},[[]]]\n{"type":"assistant","message":{"content":[{"type":"text"},[1,[2]]]}}\n' +
        '{"type":"result","subtype":"success","result":"d","usage":{"in":[1,{"x":[]}]}}\n',
    },
  },
  { name: "codex-ok", args: run("x"), reply: codexOk },
  {
    name: "codex-turn-failed",
    args: run("x"),
    reply: {
      out:
        '{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}\n' +
        '{"type":"turn.failed","error":{"message":"stream disconnected"}}\n' +
        '{"type":"turn.failed","error":{"message":"second"}}\n',
      status: 1,
    },
  },
  { name: "codex-silent", args: run("x"), reply: { out: '{"type":"turn.completed"}\n' } },
  { name: "codex-rejected-only", args: run("x"), reply: rejected },
  {
    name: "codex-fallback",
    args: run("x"),
    models: "fresh",
    by: { "gpt-6.2-sol": rejected, "gpt-6.1-sol": rejected, "gpt-6-sol": codexOk },
  },
  {
    name: "codex-fallback-stops",
    args: run("x"),
    models: "fresh",
    by: {
      "gpt-6.2-sol": rejected,
      "gpt-6.1-sol": { out: '{"type":"turn.failed","error":{"message":"quota"}}\n', status: 1 },
      "gpt-6-sol": codexOk,
    },
  },
  {
    name: "codex-fallback-all",
    args: run("x"),
    models: "fresh",
    by: { "gpt-6.2-sol": rejected, "gpt-6.1-sol": rejected, "gpt-6-sol": rejected },
  },
  {
    name: "write-under-file",
    args: ["--from", "codex", "-o", "prompt.md/sub", "x"],
    reply: claudeOk,
  },
  { name: "write-denied", args: ["--from", "codex", "-o", "locked/out", "x"], reply: claudeOk },
  {
    name: "spawn-failed",
    args: ["--from", "codex", "-o", "out", "it's a \\ test"],
    agents: "badshebang",
  },
  {
    name: "bucket-names",
    args: ["--from", "codex", "-o", "out", "x"],
    reply: claudeOk,
    cwd: "Wörk Dir_İK/--My.Proj--",
  },
  { name: "bucket-root-like", args: ["--from", "codex", "--dry-run", "x"], cwd: "a/b/c/___" },
];

// Seeded cases: generated agent streams (valid events, blank lines, cut-off
// and wrong lines), flags and working folders.
let state = seed >>> 0;
const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
const pick = <T>(xs: readonly T[]) => xs[next() % xs.length]!;
const lines = [
  '{"type":"result","subtype":"success","result":"ok ${n}"}',
  '{"type":"result","subtype":"error_during_execution","is_error":true}',
  '{"type":"system","subtype":"init","model":"m${n}"}',
  '{"type":"item.completed","item":{"type":"agent_message","text":"t${n}"}}',
  '{"type":"turn.failed","error":{"message":"f${n}"}}',
  '{"type":"turn.failed","error":{}}',
  "",
  "  ",
  "[1,2]",
  "null",
  "nul",
  "x${n}",
  "Error ${n}: y",
  '{"type":"result"',
  "[1,]",
  "{}x",
  "1 2",
  "-",
  '"\\u12"',
  '{"a" 1}',
  "tru",
  "01",
  '{"type":"assistant","message":{"content":[{"type":"text","text":"t${n}"},[]]}}',
  '[[1],{"b":{}},[{}]]',
];
const segments = ["A", "b c", "İ", "K", "--", "x.y", "ü", "_", "Q9"];
for (let i = 0; i < 24; i++) {
  const n = next() % 1000;
  let out = "";
  const count = next() % 4;
  for (let j = 0; j < count; j++) out += pick(lines).replaceAll("${n}", String(n)) + "\n";
  if (next() % 3 === 0) out += pick(lines).replaceAll("${n}", String(n)); // no final newline
  const from = pick(["claude", "codex"]);
  const args = ["--from", from, "-o", "out"];
  if (next() % 2 === 0) args.push("--deep");
  if (next() % 5 === 0) args.push("--dry-run");
  args.push(`prompt ${n}`);
  const cwd = Array.from({ length: 1 + (next() % 3) }, () => pick(segments) + pick(segments)).join(
    "/",
  );
  cases.push({
    name: `seed-${seed}-${i}`,
    args,
    cwd,
    reply: { out, err: next() % 2 ? "e\n" : "", status: pick([0, 0, 1, 5]) },
  });
}

function script(c: Case, fixture: string) {
  // Records argv (NUL-separated), the working folder and stdin, then replays.
  return `#!/bin/sh
d='${fixture}'
{ printf '%s' "$0"; for a do printf '\\0%s' "$a"; done; printf '\\n'; pwd; cat; printf '\\n--\\n'; } >> "$d/agent.log"
model=
prev=
for a do [ "$prev" = --model ] && model=$a; prev=$a; done
r="$d/reply"
[ -n "$model" ] && [ -f "$d/reply.$model.out" ] && r="$d/reply.$model"
[ -f "$r.out" ] && cat "$r.out"
[ -f "$r.err" ] && cat "$r.err" >&2
# Exit only once the CLI's events and stderr files hold all this agent
# wrote (a missing file counts as empty when nothing was written): a CLI
# whose sinks lag the exit (the reference's forked sinks) then reads whole
# files. Only the exit time moves; no compared byte changes.
last=
for a do last=$a; done
case $last in
  "Read the file at "*"/prompt.md and follow the instructions within it.")
    out=\${last#Read the file at }
    out=\${out%/prompt.md and follow the instructions within it.}
    name=\${0##*/}
    same() { if [ -s "$1" ]; then cmp -s "$1" "$2"; else [ ! -s "$2" ]; fi; }
    until same "$r.out" "$out/events.jsonl" && same "$r.err" "$out/$name.stderr"; do sleep 0.01; done
    ;;
esac
exit $(cat "$r.status" 2>/dev/null || echo 0)
`;
}

async function writeReply(dir: string, base: string, r: Reply) {
  await writeFile(join(dir, `${base}.out`), r.out ?? "");
  await writeFile(join(dir, `${base}.err`), r.err ?? "");
  await writeFile(join(dir, `${base}.status`), String(r.status ?? 0));
}

async function setup(c: Case, dir: string, fixture: string) {
  await mkdir(fixture, { recursive: true });
  await writeFile(join(fixture, "agent.log"), "");
  await writeReply(fixture, "reply", c.reply ?? claudeOk);
  for (const [model, r] of Object.entries(c.by ?? {}))
    await writeReply(fixture, `reply.${model}`, r);
  await mkdir(join(dir, "bin"));
  const agents = c.agents ?? "both";
  for (const name of ["claude", "codex"]) {
    const file = join(dir, "bin", name);
    if (agents === "none") continue;
    if (agents === "dir") await mkdir(file);
    else if (agents === "plain") await writeFile(file, script(c, fixture), { mode: 0o644 });
    else if (agents === "badshebang")
      await writeFile(file, "#!/nonexistent/interpreter\n", { mode: 0o755 });
    else await writeFile(file, script(c, fixture), { mode: 0o755 });
  }
  await writeFile(join(dir, "prompt.md"), "Prompt from a file.\n");
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "secret.md"), "s", { mode: 0o000 });
  await symlink("loop2", join(dir, "loop1"));
  await symlink("loop1", join(dir, "loop2"));
  await mkdir(join(dir, "locked"), { mode: 0o555 });
  await chmod(join(dir, "locked"), 0o555);
  if (c.models) {
    await mkdir(join(dir, ".codex"));
    await writeFile(
      join(dir, ".codex/models_cache.json"),
      JSON.stringify({
        models: ["gpt-6-sol", "gpt-6.1-sol", "gpt-6.2-sol", "gpt-9-sol"].map((slug) => ({
          slug,
          visibility: "list",
        })),
      }),
    );
    if (c.models === "fresh") {
      await mkdir(join(dir, ".okra"));
      await writeFile(
        join(dir, ".okra/models.json"),
        JSON.stringify({ format: 1, fetchedAt: 9000000000000000, catalog }) + "\n",
      );
    }
  }
  if (c.cwd) await mkdir(join(dir, c.cwd), { recursive: true });
  if (c.setup) await c.setup(dir);
}

// The raw events.jsonl and agent stderr files of one run, in path order.
let agentFiles: string[] = [];
const slugPattern = /\d{8}-\d{6}-(claude|codex)-to-(claude|codex)-[0-9a-f]{6}/g;
// normalize replaces the run's time and random suffix, after checking that
// each slug, timestamp and duration is well formed and consistent.
// The run's folder and its output bucket name the scratch path, which differs
// between the recorded reference and a check; both become placeholders. The
// bucket is the reference's: the last two segments in slug form and the first
// eight hex digits of the folder's SHA-256.
let runPaths: [string, string][] = [];
function bucket(cwd: string) {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const tail = normalized
    .split("/")
    .filter((s) => s.length > 0)
    .slice(-2)
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter((s) => s.length > 0);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return tail.length > 0 ? `${tail.join("-")}-${hash}` : hash;
}
function normalize(text: string, slugs: Set<string>) {
  for (const [from, to] of runPaths) text = text.replaceAll(from, to);
  for (const m of text.matchAll(slugPattern)) slugs.add(m[0]);
  return text.replaceAll(slugPattern, "<SLUG>");
}

async function snapshot(dir: string, slugs: Set<string>, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(join(dir, rel))).sort()) {
    const path = join(rel, name);
    const info = await lstat(join(dir, path));
    if (path === "bin" || path === "locked" || path === "secret.md" || path.startsWith("loop"))
      continue;
    if (info.isDirectory()) {
      out.push(`${normalize(path, slugs)}/ ${info.mode & 0o777}`);
      out.push(...(await snapshot(dir, slugs, path)));
      continue;
    }
    let text = (await readFile(join(dir, path))).toString("latin1");
    if (path.endsWith("manifest.json")) {
      const m = JSON.parse(Buffer.from(text, "latin1").toString()) as Record<string, unknown>;
      if (
        typeof m.timestamp !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.timestamp)
      )
        throw new Error(`bad timestamp ${String(m.timestamp)}`);
      const t = m.timestamp.replace(/[-:]/g, "");
      if (typeof m.slug !== "string" || !m.slug.startsWith(`${t.slice(0, 8)}-${t.slice(9, 15)}-`))
        throw new Error(`slug ${String(m.slug)} is not the run's time ${m.timestamp}`);
      if (typeof m.durationMs !== "number" || !Number.isInteger(m.durationMs) || m.durationMs < 0)
        throw new Error(`bad duration ${String(m.durationMs)}`);
      text = text
        .replace(/"timestamp":"[^"]*"/, '"timestamp":"<TIME>"')
        .replace(/"durationMs":\d+/, '"durationMs":"<MS>"');
    }
    if (path === ".okra/models.json")
      text = text.replace(/"fetchedAt":\d+/, '"fetchedAt":"<CLOCK>"');
    if (path.endsWith(".stderr") || path.endsWith("/events.jsonl"))
      agentFiles.push(Buffer.from(text, "latin1").toString());
    const shown = normalize(text, slugs);
    out.push(
      `${normalize(path, slugs)} ${info.mode & 0o777} ${createHash("sha256").update(shown).digest("hex").slice(0, 16)} ${shown.length < 400 ? JSON.stringify(shown) : ""}`,
    );
  }
  return out;
}

async function execute(program: string, c: Case, dir: string) {
  const fixture = `${dir}.fixture`;
  await mkdir(dir);
  await setup(c, dir, fixture);
  requests = [];
  const cwd = c.cwd ? join(dir, c.cwd) : dir;
  runPaths = [
    [bucket(cwd), "<BUCKET>"],
    [dir, "<DIR>"],
  ];
  const child = spawn(program, ["counsel", ...c.args], {
    cwd,
    detached: true,
    stdio: [c.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    env: {
      HOME: dir,
      PATH: `${dir}/bin:/usr/bin:/bin`,
      NO_COLOR: "1",
      TERM: "dumb",
      OKRA_PARITY_ORIGIN: origin,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(scratch, "bun-cache"),
      ...c.env,
    },
  });
  if (c.stdin !== undefined) {
    // A program that exits before it reads stdin closes the pipe (EPIPE).
    child.stdin!.on("error", () => {});
    child.stdin!.end(c.stdin);
  }
  let out = "",
    err = "",
    active = true;
  const stop = () => {
    if (active && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already ended */
      }
    }
  };
  const timer = setTimeout(stop, 120_000); // only stops a hung counsel case
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  child.stdout!.on("data", (s) => {
    out += s;
  });
  child.stderr!.on("data", (s) => {
    err += s;
  });
  let code: number;
  try {
    code = await new Promise<number>((yes, no) => {
      child.once("error", no);
      child.once("close", (status, signal) =>
        signal ? no(new Error(`hung counsel case ${c.name}: ${signal}`)) : yes(status ?? 1),
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
    throw new Error("owned counsel process remains");
  const slugs = new Set<string>();
  agentFiles = [];
  const log = (await readFile(join(fixture, "agent.log"))).toString();
  const result = {
    out: normalize(out, slugs),
    err: normalize(err, slugs),
    code,
    files: await snapshot(dir, slugs),
    agents: normalize(log, slugs),
    requests: [...requests],
  };
  if (slugs.size > 1) throw new Error(`one run named two slugs: ${[...slugs].join(", ")}`);
  return { result, complete: complete(c, log, agentFiles) };
}

// complete is whether the run's events.jsonl and agent stderr hold all that
// the last agent run wrote. The reference forks its two file sinks and ends
// them when the agent exits, so it could lose output (a race); the fake
// agent now exits only after both files hold its bytes, so every run of
// either side must be complete, and none is repeated.
function complete(c: Case, log: string, files: string[]) {
  const runs = log.split("\n--\n").filter((s) => s !== "");
  if (runs.length === 0) return files.length === 0;
  const argv = runs[runs.length - 1]!.split("\n")[0]!.split("\0");
  const model = argv[argv.indexOf("--model") + 1] ?? "";
  const reply = c.by?.[model] ?? c.reply ?? claudeOk;
  return files.length === 2 && files[0] === (reply.err ?? "") && files[1] === (reply.out ?? "");
}

type Result = Awaited<ReturnType<typeof settled>>;
async function settled(program: string, c: Case, dir: string, port: boolean) {
  const once = await execute(program, c, dir);
  if (once.complete || c.usage) return once.result;
  throw new Error(
    `${port ? "port" : "reference"} lost agent output: ${c.name} ${JSON.stringify(once.result)}`,
  );
}

const records = frozen("counsel", seed, Boolean(arg("case")));
let count = 0;
try {
  for (const c of cases.filter((x) => !arg("case") || x.name === arg("case"))) {
    const writes = !c.args.includes("--dry-run") && !c.usage;
    if (writes && !c.args.some((a) => a === "-o" || a.startsWith("--output-dir")))
      throw new Error(`case ${c.name} would write under /tmp/counsel`);
    // Both programs run in one folder path, so the bucket (a hash of the
    // working folder) is the same; the first run's folder is moved aside.
    const base = await mkdtemp(join(scratch, "counsel-"));
    const dir = join(base, "case");
    const want = records.get<Result>(c.name);
    const got = await settled(binary, c, dir, true);
    if (c.usage) {
      if (want.code !== 1 || got.code !== 1 || !got.out.includes("okra") || got.err === "")
        throw new Error(`usage lost help/error/status: ${c.name} ${JSON.stringify(got)}`);
      got.out = want.out;
      got.err = want.err;
    }
    if (!isDeepStrictEqual(want, got)) {
      console.error(
        JSON.stringify(
          {
            seed,
            case: c,
            want,
            got,
            replay: `bun parity/counsel.ts --seed=${seed} --case=${c.name}`,
          },
          null,
          2,
        ),
      );
      throw new Error(`counsel parity mismatch: ${c.name}`);
    }
    if (want.err.includes("parity refuses")) throw new Error(`invalid reference ${c.name}`);
    console.log(`counsel ${c.name}: ${want.code}`);
    count++;
  }
  if (count === 0) throw new Error("no counsel cases selected");
  records.done();
  console.log(`COUNSEL PARITY EXIT: 0 (${count} process pairs, seed ${seed})`);
} finally {
  await peer.stop(true);
}
