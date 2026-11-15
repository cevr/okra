// Builds Go because the contract is process-visible: streams, exit status,
// the cache tree git and tar leave and metadata.json bytes. A checker cannot
// observe git, tar or the file system. All peers are local and synthetic.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { advance, build } from "./repo-world";
import { frozen } from "./frozen";

const root = resolvePath(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/linear-port";
await mkdir(scratch, { recursive: true });
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const candidate = arg("binary") ?? join(root, "bin/okra-ergo-parity");
const seed = Number(arg("seed") ?? 42);
const only = arg("case");
const world = await build(await mkdtemp(join(scratch, "repo-world-")));
const started = Date.now();

type Step = { args: string[]; usage?: boolean; declared?: string; before?: () => Promise<void> };
type Session = { name: string; setup?: (dir: string) => Promise<void>; steps: Step[] };
const step = (...args: string[]): Step => ({ args });
const usage = (...args: string[]): Step => ({ args, usage: true });
const day = 86_400_000;
const at = (daysAgo: number) => new Date(started - daysAgo * day - 3_600_000).toISOString();

async function files(dir: string, tree: Record<string, string>) {
  for (const [path, text] of Object.entries(tree)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), text);
  }
}
const entry = (
  registry: string,
  name: string,
  version: string | null,
  path: string,
  size: number,
  last: number,
  fetched = 50,
) => ({
  spec: version === null ? { registry, name } : { registry, name, version },
  fetchedAt: at(fetched),
  lastAccessedAt: Number.isNaN(last) ? "not-a-date" : at(last),
  sizeBytes: size,
  path,
});
const aged = [
  entry("github", "acme/fresh", null, ".cache/repo/acme/fresh", 2048, 1),
  entry("npm", "old-pkg", "1.0.0", ".cache/repo/npm/old-pkg/1.0.0", 5_000_000, 40),
  entry("pypi", "Mid_Pkg", null, ".cache/repo/pypi/Mid_Pkg/default", 1_536_000, 10),
  entry("crates", "odd-date", null, ".cache/repo/crates/odd-date/default", 2304, Number.NaN),
  entry(
    "npm",
    "@scope/b-tools",
    null,
    ".cache/repo/npm/@scope/b-tools/default",
    1_073_741_824,
    400,
  ),
  entry("github", "acme/a-tools", "v2", ".cache/repo/acme/a-tools", 512, 3),
];
async function agedCache(dir: string) {
  await files(dir, { ".cache/repo/metadata.json": JSON.stringify({ version: 1, repos: aged }) });
  for (const e of aged) await files(dir, { [`${e.path}/file.txt`]: "x".repeat(10) });
}

const sessions: Session[] = [
  {
    name: "empty",
    steps: [
      step("repo", "list"),
      step("repo", "list", "--json"),
      step("repo", "path", "foo/bar"),
      step("repo", "remove", "foo/bar"),
      step("repo", "clean"),
      step("repo", "clean", "--all"),
      step("repo", "path", "npm:@scope/x@1"),
      { args: ["repo"], usage: true },
    ],
  },
  {
    name: "github",
    steps: [
      step("repo", "fetch", "acme/Widget"),
      step("repo", "fetch", "acme/widget", "--json"),
      step("repo", "fetch", "acme/widget@v1.0.0"),
      step("repo", "list"),
      step("repo", "list", "--json"),
      step("repo", "path", "ACME/WIDGET"),
      {
        args: ["repo", "fetch", "github:acme/widget"],
        before: () => advance(world.dir, "github.com/acme/widget.git"),
      },
      step("repo", "remove", "acme/widget"),
      step("repo", "list", "--json"),
      step("repo", "fetch", "acme/nope"),
    ],
  },
  {
    name: "github-pinned",
    steps: [
      step("repo", "fetch", "acme/widget#v1.0.0", "--json"),
      step("repo", "fetch", "acme/widget@v1.0.0"),
      step("repo", "fetch", "-f", "acme/widget@v1.0.0", "--json"),
      step("repo", "list", "--sort", "name"),
    ],
  },
  {
    name: "case-folder",
    setup: (dir) =>
      mkdir(join(dir, ".cache/repo/Acme/Gizmo"), { recursive: true }).then(() => undefined),
    steps: [step("repo", "fetch", "acme/gizmo", "--json"), step("repo", "path", "acme/GIZMO")],
  },
  {
    name: "npm",
    steps: [
      step("repo", "fetch", "npm:left-pad", "--json"),
      step("repo", "fetch", "npm:left-pad@beta"),
      step("repo", "fetch", "npm:@scope/kit"),
      step("repo", "fetch", "npm:@scope/kit", "--json"),
      step("repo", "fetch", "@scope/kit@1.0.0"),
      step("repo", "fetch", "npm:shorthand"),
      step("repo", "fetch", "npm:tiny", "--json"),
      step("repo", "fetch", "npm:missing"),
      step("repo", "fetch", "npm:noversion"),
      step("repo", "fetch", "npm:left-pad@9.9.9"),
      step("repo", "fetch", "npm:gone-tarball"),
      step("repo", "fetch", "npm:broken-tar"),
      step("repo", "list", "--sort", "size"),
      step("repo", "list", "--sort", "name", "--json"),
      step("repo", "list", "-r", "npm", "-s", "name"),
      step("repo", "remove", "npm:@scope/kit"),
      step("repo", "clean", "--max-size", "1", "--dry-run"),
    ],
  },
  {
    name: "pypi-crates",
    steps: [
      step("repo", "fetch", "pypi:requests-lite"),
      step("repo", "fetch", "pip:sdistpkg", "--json"),
      step("repo", "fetch", "pypi:sdistpkg==1.0"),
      step("repo", "fetch", "pypi:wheelonly"),
      step("repo", "fetch", "pypi:absent"),
      step("repo", "fetch", "crates:serde-lite", "--json"),
      step("repo", "fetch", "cargo:serde-lite@0.1.0"),
      step("repo", "fetch", "rust:serde-lite@9.9.9"),
      step("repo", "fetch", "crates:nocrate"),
      step("repo", "list", "-r", "pypi", "--json"),
      step("repo", "list"),
    ],
  },
  {
    name: "declared-metadata-cause",
    steps: [
      { args: ["repo", "fetch", "npm:badjson"], declared: "parse-metadata from npm: " },
      { args: ["repo", "fetch", "npm:badshape"], declared: "parse-metadata from npm: " },
      { args: ["repo", "fetch", "pypi:nullhome"], declared: "parse-metadata from pypi: " },
    ],
  },
  {
    name: "aged",
    setup: agedCache,
    steps: [
      step("repo", "list"),
      step("repo", "list", "--sort", "size"),
      step("repo", "list", "-s", "name", "--json"),
      step("repo", "clean", "--days", "5", "--dry-run"),
      step("repo", "clean", "-d", "5", "--max-size", "1.5 MB", "--dry-run"),
      step("repo", "clean", "--max-size", "1x"),
      step("repo", "clean", "--max-size", "2304"),
      step("repo", "clean", "--days", "1000"),
      step("repo", "clean", "--all"),
      step("repo", "fetch", "acme/widget"),
      step("repo", "clean", "--days", "2"),
      step("repo", "list", "--json"),
      step("repo", "clean", "--all", "-y"),
      step("repo", "list", "--json"),
    ],
  },
  {
    // A fetch while entries older than 30 days are in the index: the
    // automatic prune removes them and names the count on standard error.
    name: "auto-prune",
    setup: agedCache,
    steps: [
      step("repo", "fetch", "acme/widget"),
      step("repo", "list", "--json"),
      step("repo", "fetch", "acme/widget", "--json"),
    ],
  },
  {
    name: "file-shapes",
    setup: (dir) =>
      files(dir, {
        ".cache/repo/metadata.json": `{"repos":[{"path":".cache/repo/x/y","sizeBytes":7,"extra":true,"lastAccessedAt":"${at(2)}","fetchedAt":"${at(2)}","spec":{"name":"X/Y","registry":"github","version":"main"}},{"spec":{"registry":"npm","name":"dup"},"fetchedAt":"a","lastAccessedAt":"${at(3)}","sizeBytes":1,"sizeBytes":3,"path":"p"}],"version":2}`,
      }),
    steps: [
      step("repo", "list", "--json"),
      step("repo", "path", "x/y@main"),
      step("repo", "remove", "x/y@main"),
      step("repo", "list", "--json"),
    ],
  },
  {
    name: "corrupt",
    setup: (dir) =>
      files(dir, {
        ".cache/repo/metadata.json":
          '{"version":1,"repos":[{"spec":{"registry":"svn","name":"x"}}]}',
      }),
    steps: [
      step("repo", "list", "--json"),
      step("repo", "fetch", "npm:@scope/kit@1.0.0"),
      step("repo", "list", "--json"),
    ],
  },
  {
    name: "usage",
    steps: [
      usage("repo", "fetch"),
      usage("repo", "list", "--sort", "bad"),
      usage("repo", "clean", "--days", "x"),
      usage("repo", "list", "--json", "--json"),
      usage("repo", "fetch", "a/b", "extra"),
      usage("repo", "nope"),
    ],
  },
];

// Seeded spec property: generated spec texts against a fixed index, through
// the two read-only commands that print the parsed spec back.
let state = seed >>> 0;
const next = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state;
};
const pick = <T>(xs: readonly T[]) => xs[next() % xs.length]!;
const prefixes = ["", "", "npm:", "pypi:", "pip:", "crates:", "cargo:", "rust:", "github:", " "];
const pieces = [
  "acme",
  "Acme",
  "/",
  "@",
  "#",
  "=",
  "==",
  "-",
  "_",
  ".",
  " ",
  "\t",
  "x",
  "1.0",
  "é",
  "@scope",
  "v2",
  "",
];
const specs: string[] = [];
for (let i = 0; i < 24; i++) {
  let text = pick(prefixes);
  const n = next() % 5;
  for (let j = 0; j < n; j++) text += pick(pieces);
  // A leading "-" is flag syntax, whose layout is std flag's (declared).
  specs.push(text.startsWith("-") ? `x${text}` : text);
}
sessions.push({
  name: `spec-${seed}`,
  setup: (dir) =>
    files(dir, { ".cache/repo/metadata.json": JSON.stringify({ version: 1, repos: aged }) }),
  steps: specs.flatMap((s) => [step("repo", "path", s), step("repo", "remove", s)]),
});
// Seeded command walk over the fixture world.
const walk = [
  ["repo", "fetch", "acme/widget"],
  ["repo", "fetch", "npm:@scope/kit"],
  ["repo", "fetch", "pip:sdistpkg"],
  ["repo", "fetch", "npm:left-pad"],
  ["repo", "remove", "npm:@scope/kit"],
  ["repo", "remove", "acme/widget"],
  ["repo", "list", "--json"],
  ["repo", "list", "--sort", "size"],
  ["repo", "clean", "--max-size", "20K", "--dry-run"],
  ["repo", "path", "npm:left-pad"],
];
for (let w = 0; w < 2; w++)
  sessions.push({
    name: `walk-${seed}-${w}`,
    steps: Array.from({ length: 6 }, () => step(...pick(walk))),
  });

function normalize(text: string) {
  // A time the run wrote is <NOW>; a fixture time from at() is named by its
  // days, so a recorded reference holds on any later day.
  return text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, (iso) => {
    const t = Date.parse(iso);
    if (t >= started - 5000) return "<NOW>";
    const days = (started - 3_600_000 - t) / day;
    return Number.isInteger(days) ? `<AT ${days} days ago>` : iso;
  });
}

async function snapshot(dir: string) {
  const out: string[] = [];
  async function walkTree(rel: string) {
    const full = join(dir, rel);
    const info = await lstat(full);
    const mode = (info.mode & 0o777).toString(8);
    if (info.isSymbolicLink()) out.push(`${rel} link`);
    else if (info.isDirectory()) {
      out.push(`${rel}/ ${mode}`);
      for (const name of (await readdir(full)).sort()) await walkTree(join(rel, name));
    } else if (rel.endsWith("metadata.json"))
      out.push(`${rel} ${mode} ${normalize(await readFile(full, "utf8"))}`);
    else if (rel.split("/").includes(".git")) out.push(`${rel} ${mode} ${info.size}`);
    else
      out.push(
        `${rel} ${mode} ${createHash("sha256")
          .update(await readFile(full))
          .digest("hex")
          .slice(0, 16)}`,
      );
  }
  try {
    await walkTree(".cache");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  return out;
}

type Result = Awaited<ReturnType<typeof execute>>;
async function execute(program: string, args: string[], cwd: string) {
  const child = spawn(program, args, {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: ".",
      NO_COLOR: "1",
      TERM: "dumb",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(scratch, "bun-cache"),
      OKRA_PARITY_ORIGIN: world.origin,
      ...world.gitEnv,
    },
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
  const timer = setTimeout(stop, 120_000); // stops only a hung invocation, which then fails
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  child.stdout.on("data", (data) => {
    out += data;
  });
  child.stderr.on("data", (data) => {
    err += data;
  });
  let code: number;
  try {
    code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) =>
        signal
          ? reject(new Error(`hung invocation stopped: ${JSON.stringify(args)} ${signal}`))
          : resolve(status ?? 1),
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
    ps.stdout
      .split("\n")
      .some(
        (line) =>
          line.trim().split(/\s+/)[1] === String(child.pid) &&
          !line.trim().split(/\s+/)[2]?.startsWith("Z"),
      )
  )
    throw new Error("owned CLI process remains");
  return { out: normalize(out), err: normalize(err), code, tree: await snapshot(cwd) };
}

const records = frozen("repo", seed, Boolean(only));
let compared = 0;
try {
  for (const session of sessions.filter((s) => !only || s.name === only)) {
    const dir = await mkdtemp(join(scratch, `repo-${session.name}-`));
    if (session.setup) await session.setup(dir);
    for (const [index, current] of session.steps.entries()) {
      if (current.before) await current.before();
      const want = records.get<Result>(`${session.name}#${index}`);
      const got = await execute(candidate, current.args, dir);
      // A usage error (the reference names it under ERRORS) has std flag's layout.
      if (current.usage || want.err.startsWith("\nERRORS\n")) {
        if (
          want.code !== got.code ||
          !got.out.includes("okra") ||
          (got.code !== 0 && got.err === "")
        )
          throw new Error(`usage lost help/error/status: ${JSON.stringify(current.args)}`);
        got.out = want.out;
        got.err = want.err;
      }
      if (current.declared) {
        const cut = (s: string) =>
          s.slice(0, s.indexOf(current.declared!) + current.declared!.length);
        if (!want.err.includes(current.declared) || cut(want.err) !== cut(got.err))
          throw new Error(
            `declared prefix differs: ${JSON.stringify({ want: want.err, got: got.err })}`,
          );
        got.err = want.err;
      }
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        console.error(
          JSON.stringify(
            {
              session: session.name,
              seed,
              step: current.args,
              reference: want,
              actual: got,
              replay: `bun parity/repo.ts --seed=${seed} --case=${session.name}`,
            },
            null,
            2,
          ),
        );
        throw new Error(`${session.name}: parity mismatch`);
      }
      if (process.argv.includes("--show"))
        console.log(
          JSON.stringify({ args: current.args, code: want.code, out: want.out, err: want.err }),
        );
      compared++;
    }
    console.log(`ok ${session.name}`);
  }
} finally {
  world.stop();
}
if (!compared) throw new Error("No cases selected");
records.done();
console.log(`REPO PARITY EXIT: 0 (${compared} process pairs, seed ${seed})`);
