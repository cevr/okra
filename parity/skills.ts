// Builds Go because the contract is process-visible: streams, exit status,
// the installed skill tree and the lock file bytes, through a fake gh
// program and a loopback GitHub. A checker cannot observe them. All peers
// are local and synthetic.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { build, fixtureSkill, fixtureToken, seed, type World } from "./skills-world";
import { frozen } from "./frozen";

const root = resolvePath(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/linear-port";
await mkdir(scratch, { recursive: true });
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const candidate = arg("binary") ?? join(root, "bin/okra-ergo-parity");
const seed0 = Number(arg("seed") ?? 42);
const only = arg("case");
const tsOnly = process.argv.includes("--record-check");
const world: World = await build(await mkdtemp(join(scratch, "skills-world-")));
const started = Date.now();

type Env = { SKILLS_DIR?: string; GITHUB_TOKEN?: string; FAKE_GH?: string };
type Step = {
  args: string[];
  usage?: boolean;
  world?: (w: World) => void;
  edit?: (dir: string) => Promise<void>;
};
type Session = { name: string; env?: Env; setup?: (dir: string) => Promise<void>; steps: Step[] };
const step = (...args: string[]): Step => ({ args });

async function files(dir: string, tree: Record<string, string>) {
  for (const [path, text] of Object.entries(tree)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), text);
  }
}
const repo = (name: string) => world.repos.get(name)!.refs.main!;

const sessions: Session[] = [
  {
    name: "empty",
    steps: [
      step("skills"),
      step("skills", "update"),
      step("skills", "update", "--json"),
      step("skills", "update", "--dry-run"),
      step("skills", "update", "--dry-run", "--json"),
      step("skills", "remove", "nothing"),
      step("skills", "rm", "a", "b"),
      step("skills", "search", "widget"),
      step("skills", "search", "none"),
      step("skills", "search", "broken"),
      step("skills", "add", "none"),
      { args: ["skills", "nope"], usage: true },
      { args: ["skills", "add"], usage: true },
    ],
  },
  {
    name: "http",
    env: { SKILLS_DIR: "skills", GITHUB_TOKEN: fixtureToken },
    steps: [
      step("skills", "add", "acme/tools@alpha"),
      step("skills", "add", "acme/tools/skills/beta"),
      step("skills", "i", "https://github.com/acme/single"),
      step("skills", "install", "acme/private@secret"),
      step("skills", "add", "acme/tools@nope"),
      step(
        "skills",
        "add",
        "acme/links@linked",
        "acme/links@escape",
        "acme/links@cycle",
        "acme/links@sub",
      ),
      // Two plans share the display name "alpha"; they install different
      // names, since two installs of one name race in the reference.
      step("skills", "add", "acme/twin@alpha", "acme/nested", "acme/tools@alpha"),
      step("skills", "add", "acme/tools#v1/skills/alpha"),
      step("skills", "add", "acme/tools@alpha"),
      step("skills"),
      step("skills", "update", "--dry-run", "--json"),
      {
        args: ["skills", "update", "--dry-run"],
        world: () => {
          repo("acme/tools")["skills/alpha/SKILL.md"] = fixtureSkill(
            "alpha",
            "First skill, changed",
          );
        },
      },
      step("skills", "update", "--dry-run", "--json"),
      {
        args: ["skills", "update", "--json"],
        world: () => {
          const tools = repo("acme/tools");
          for (const path of Object.keys(tools).filter((p) => p.startsWith("skills/beta/"))) {
            tools[path.replace("skills/beta/", "skills/extra/beta/")] = tools[path]!;
            delete tools[path];
          }
        },
      },
      {
        args: ["skills", "update"],
        edit: (dir) => files(dir, { "skills/single/extra/data.txt": "edited\n" }),
      },
      step("skills", "update", "--json"),
      step("skills", "update", "--force"),
      {
        args: ["skills", "update", "--json"],
        world: (w) => {
          w.repos.delete("acme/single");
          delete repo("acme/links")["skills/sub/SKILL.md"];
          repo("acme/links")["skills/sub/vendor"] = "now a file\n";
        },
      },
      step("skills", "remove", "alpha", "nope"),
      step("skills", "uninstall", "single"),
      step("skills"),
    ],
  },
  {
    name: "gh",
    env: { FAKE_GH: "authed" },
    steps: [
      step("skills", "add", "acme/tools@alpha"),
      step("skills", "add", "acme/private@secret"),
      step("skills", "add", "acme/big@two"),
      step("skills", "add", "acme/links@linked", "acme/links@escape"),
      step("skills", "update", "--dry-run", "--json"),
      {
        args: ["skills", "update"],
        world: () => {
          repo("acme/big")["skills/two/x.md"] = "x2\n";
        },
      },
      step("skills"),
      { args: ["skills", "update", "--json"], world: (w) => w.repos.delete("acme/big") },
    ],
  },
  {
    name: "no-gh",
    env: { FAKE_GH: "absent", SKILLS_DIR: "s" },
    steps: [
      step("skills", "add", "acme/private@secret"),
      step("skills", "add", "acme/single"),
      step("skills", "update", "--json"),
      { args: ["skills", "update"], world: (w) => w.repos.delete("acme/single") },
    ],
  },
  {
    name: "local",
    env: { SKILLS_DIR: "installed" },
    setup: (dir) =>
      files(dir, {
        "src/one/SKILL.md": fixtureSkill("One Skill", "Local one"),
        "src/one/.hidden": "hidden\n",
        "src/one/lib/a.txt": "a\n",
        "src/plain/SKILL.md": "plain\n",
        "src/multi/skills/a/SKILL.md": fixtureSkill("a", "A"),
        "src/multi/skills/b/SKILL.md": fixtureSkill("b", "B"),
        "src/none/README.md": "none\n",
      }),
    steps: [
      step("skills", "add", "./src/one"),
      step("skills", "add", "src/plain"),
      step("skills", "add", "./src/plain"),
      step("skills", "add", "./src/none"),
      step("skills", "add", "./src/absent"),
      step("skills", "add", "~/src/multi/skills/a"),
      step("skills", "add", "./src/multi"),
      step("skills", "add", "./src/multi", "acme/tools"),
      step("skills"),
      {
        args: ["skills", "update", "--dry-run", "--json"],
        edit: (dir) => files(dir, { "src/one/lib/a.txt": "a2\n" }),
      },
      step("skills", "update"),
      step("skills", "remove", "./src/one"),
      step("skills", "remove", "./src/multi"),
      step("skills", "remove", "./src/absent"),
      step("skills", "remove", "./src/none"),
      { args: ["skills", "--json"], usage: true },
    ],
  },
  {
    name: "search-add",
    env: { SKILLS_DIR: "skills", GITHUB_TOKEN: fixtureToken },
    steps: [
      step("skills", "add", "widget"),
      step("skills", "add", "alpha"),
      step("skills", "add", "odd"),
      step("skills", "add", "broken"),
      step("skills", "update", "--json"),
    ],
  },
  {
    name: "corrupt-lock",
    env: { SKILLS_DIR: "skills" },
    setup: (dir) => files(dir, { "skills/.skill-lock.json": '{"version":2,"skills":{}}' }),
    steps: [step("skills", "update"), step("skills"), step("skills", "remove", "x")],
  },
  {
    name: "lock-shapes",
    env: { SKILLS_DIR: "skills", GITHUB_TOKEN: fixtureToken },
    setup: (dir) =>
      files(dir, {
        "skills/.skill-lock.json": JSON.stringify({
          version: 1,
          skills: {
            "2": {
              source: "acme/tools",
              skillPath: "skills/alpha/SKILL.md",
              installedAt: "x",
              updatedAt: "y",
              extra: 1,
            },
            zeta: {
              source: "acme/tools@beta",
              skillPath: "skills/beta/SKILL.md",
              ref: "main",
              installedAt: "x",
              updatedAt: "y",
            },
            "1": {
              source: "local:./gone",
              skillPath: "SKILL.md",
              hash: "sha256:0",
              installedAt: "x",
              updatedAt: "y",
            },
            odd: {
              source: "not a source",
              skillPath: "SKILL.md",
              installedAt: "x",
              updatedAt: "y",
            },
          },
        }),
        "skills/2/SKILL.md": fixtureSkill("two", "Unmanaged by name"),
        "skills/loose/SKILL.md": fixtureSkill("loose", "Unmanaged"),
        "skills/file.txt": "not a skill\n",
      }),
    steps: [
      step("skills"),
      step("skills", "update", "--dry-run", "--json"),
      step("skills", "update"),
      step("skills"),
    ],
  },
];

// Seeded property: generated SKILL.md front matter through list and local
// add, and generated source texts through add.
let state = seed0 >>> 0;
const next = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state;
};
const pick = <T>(xs: readonly T[]) => xs[next() % xs.length]!;
const words = [
  "Alpha",
  "beta",
  "my skill",
  "Ü-ber",
  "x_y",
  "",
  " ",
  "a:b",
  ">",
  "|",
  "--",
  "é",
  "long ".repeat(20),
  "Zed",
];
const lineKinds = [
  () => `name: ${pick(words)}`,
  () => `description: ${pick(words)}`,
  () => `description: >\n  ${pick(words)}\n  ${pick(words)}`,
  () => `name: |\n  ${pick(words)}`,
  () => `other: ${pick(words)}`,
  () => pick(words),
];
const generated: Record<string, string> = {};
for (let i = 0; i < 8; i++) {
  const lines = Array.from({ length: next() % 4 }, () => pick(lineKinds)());
  const crlf = next() % 4 === 0 ? "\r\n" : "\n";
  generated[`gen/s${i}/SKILL.md`] =
    next() % 5 === 0 ? lines.join("\n") : `---${crlf}${lines.join("\n")}${crlf}---\n`;
}
const sourcePieces = [
  "acme",
  "tools",
  "/",
  "@",
  "#",
  "alpha",
  "v1",
  "skills",
  ".",
  "~",
  "https://github.com/",
  "tree/main/",
  "x y",
  "single",
];
const sources = Array.from({ length: 10 }, () => {
  let text = "";
  const n = 1 + (next() % 5);
  for (let j = 0; j < n; j++) text += pick(sourcePieces);
  return text.startsWith("-") ? `x${text}` : text;
});
sessions.push({
  name: `frontmatter-${seed0}`,
  env: { SKILLS_DIR: "skills" },
  setup: (dir) =>
    files(
      dir,
      Object.fromEntries(
        Object.entries(generated).map(([p, t]) => [p.replace("gen/", "skills/"), t]),
      ),
    ),
  steps: [
    step("skills"),
    ...Object.keys(generated).map((p) =>
      step("skills", "add", `./${p.slice(0, -"/SKILL.md".length)}`),
    ),
    step("skills"),
  ],
});
sessions.push({
  name: `sources-${seed0}`,
  env: { SKILLS_DIR: "skills", GITHUB_TOKEN: fixtureToken },
  steps: sources.map((s) => step("skills", "add", s)),
});

// Progress lines arrive in completion order, which concurrency leaves open
// on both sides: a run of them compares as a sorted block.
function normalize(text: string, dir: string) {
  const out = text
    .split(dir)
    .join("<DIR>")
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, (iso) =>
      Date.parse(iso) >= started - 5000 ? "<NOW>" : iso,
    );
  const lines = out.split("\n");
  const result: string[] = [];
  let block: string[] = [];
  for (const line of lines) {
    if (/^ {2}[✓↑→·↻✗◌] /.test(line)) block.push(line);
    else {
      result.push(...block.sort(), line);
      block = [];
    }
  }
  result.push(...block.sort());
  return result.join("\n");
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
    } else if (rel.endsWith(".skill-lock.json"))
      out.push(`${rel} ${mode} ${normalize(await readFile(full, "utf8"), dir)}`);
    else
      out.push(
        `${rel} ${mode} ${createHash("sha256")
          .update(await readFile(full))
          .digest("hex")
          .slice(0, 16)}`,
      );
  }
  for (const name of (await readdir(dir)).sort()) await walkTree(name);
  return out;
}

async function execute(program: string, args: string[], cwd: string, env: Env) {
  const child = spawn(program, args, {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: `${world.bin}:/usr/bin:/bin`,
      HOME: ".",
      NO_COLOR: "1",
      TERM: "dumb",
      FAKE_GH: "unauthed",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(scratch, "bun-cache"),
      OKRA_PARITY_ORIGIN: world.origin,
      ...env,
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
    ps.stdout.split("\n").some((line) => {
      const fields = line.trim().split(/\s+/);
      return fields[1] === String(child.pid) && !fields[2]?.startsWith("Z");
    })
  )
    throw new Error("owned CLI process remains");
  return { out: normalize(out, cwd), err: normalize(err, cwd), code, tree: await snapshot(cwd) };
}

const reference = (args: string[], cwd: string, env: Env) =>
  execute(
    process.execPath,
    ["--preload", join(root, "parity/skills-network.ts"), join(root, "src/main.ts"), ...args],
    cwd,
    env,
  );

const notInteractive =
  "[NOT_INTERACTIVE] choosing skills needs a terminal on standard input; name one skill (owner/repo@skill)\n";
const records = frozen("skills", seed0, Boolean(only));
let compared = 0;
let prompts = 0;
try {
  for (const session of sessions.filter((s) => !only || s.name === only)) {
    seed(world);
    const dirs = await Promise.all(
      ["reference", "candidate"].map((impl) =>
        mkdtemp(join(scratch, `skills-${session.name}-${impl}-`)),
      ),
    );
    if (session.setup) for (const dir of dirs) await session.setup(dir);
    const env = session.env ?? {};
    for (const [index, current] of session.steps.entries()) {
      if (current.world) current.world(world);
      if (current.edit) for (const dir of dirs) await current.edit(dir);
      const want = await records.get(`${session.name}#${index}`, () =>
        reference(current.args, dirs[0]!, env),
      );
      const got = tsOnly
        ? await reference(current.args, dirs[1]!, env)
        : await execute(candidate, current.args, dirs[1]!, env);
      // A usage error (the reference names it under ERRORS) has std flag's layout.
      if ((current.usage || want.err.startsWith("\nERRORS\n")) && !tsOnly) {
        if (
          want.code !== got.code ||
          !got.out.includes("okra") ||
          (got.code !== 0 && got.err === "")
        )
          throw new Error(`usage lost help/error/status: ${JSON.stringify(current.args)}`);
        got.out = want.out;
        got.err = want.err;
      }
      // Declared difference: where add opens its multi-select and standard
      // input is not a terminal, the reference draws the prompt on stdout
      // and ends as an interrupt (130); the port fails before anything is
      // written, with one line and status 1.
      if (want.code === 130 && !tsOnly) {
        if (
          got.code !== 1 ||
          got.out !== "" ||
          got.err !== want.err + notInteractive ||
          JSON.stringify(got.tree) !== JSON.stringify(want.tree)
        )
          throw new Error(
            `prompt case lost its declared shape: ${JSON.stringify({ args: current.args, got })}`,
          );
        prompts++;
        got.code = want.code;
        got.out = want.out;
        got.err = want.err;
      }
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        console.error(
          JSON.stringify(
            {
              session: session.name,
              seed: seed0,
              step: current.args,
              reference: want,
              actual: got,
              replay: `bun parity/skills.ts --seed=${seed0} --case=${session.name}`,
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
if (world.leaks.length) throw new Error(`credential leaks: ${world.leaks.join("; ")}`);
if (!compared) throw new Error("No cases selected");
records.done();
if (!tsOnly && !only && !prompts)
  throw new Error("no prompt case ran: the declared prompt rule was never exercised");
console.log(
  `SKILLS PARITY EXIT: 0 (${compared} process pairs, ${prompts} declared prompt cases, seed ${seed0})`,
);
