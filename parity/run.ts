// Builds Go because CLI bytes, exits, stdin, persisted bytes and modes are the
// contract; a checker cannot observe those process boundaries. All data is fake.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

const root = resolvePath(import.meta.dir, "..");
const scratch = "/tmp/opencode/linear-port";
await mkdir(scratch, { recursive: true });
const candidate =
  process.argv.find((a) => a.startsWith("--binary="))?.slice(9) ?? join(root, "bin/okra-ergo");
const seed = Number(process.argv.find((a) => a.startsWith("--seed="))?.slice(7) ?? 42);
const tsOnly = process.argv.includes("--record-check");
const name = process.argv.find((a) => a.startsWith("--case="))?.slice(7);
type Step = { args: string[]; stdin?: string; env?: Record<string, string>; usage?: boolean };
type Session = { name: string; initial?: string; steps: Step[] };
const step = (...args: string[]): Step => ({ args });
const sessions: Session[] = [
  {
    name: "empty",
    steps: [
      step("keys"),
      step("keys", "list"),
      step("keys", "get", "missing"),
      step("keys", "rm", "missing"),
    ],
  },
  {
    name: "stdin",
    steps: [
      { args: ["keys", "set", "demo", "ignored", "--stdin"], stdin: " \tfixture-secret\r\n" },
      step("keys", "get", "demo"),
      step("keys", "list"),
      step("keys", "rm", "demo"),
    ],
  },
  {
    name: "invalid-input",
    steps: [
      step("keys", "set", "demo"),
      { args: ["keys", "set", "demo", "--stdin"], stdin: " \t\n" },
    ],
  },
  {
    name: "object-semantics",
    initial: '{"10":"x","a":123,"2":"y","a":"last","__proto__":"fixture-proto"}',
    steps: [
      step("keys", "list"),
      step("keys", "get", "a"),
      step("keys", "set", "1", "one"),
      step("keys", "rm", "a"),
    ],
  },
  {
    name: "malformed",
    initial: '{"demo":123}',
    steps: [
      step("keys", "list"),
      step("keys", "set", "demo", "fixture"),
      step("keys", "get", "demo"),
    ],
  },
  { name: "syntax", initial: "{", steps: [step("keys", "list")] },
  {
    name: "env",
    initial: '{"openai":"fixture-stored-value","other":"other-stored"}',
    steps: [
      { args: ["keys", "get", "openai"], env: { OPENAI_API_KEY: "fixture-env-value" } },
      { args: ["keys", "get", "openai"], env: { OPENAI_API_KEY: "" } },
      { args: ["keys", "get", "other"], env: { OKRA_KEY_OTHER: "other-env" } },
    ],
  },
  {
    name: "how",
    steps: [
      step("how"),
      ...["schedule", "counsel", "repo", "skills", "image", "keys", "unknown"].map((topic) =>
        step("how", topic),
      ),
    ],
  },
  {
    name: "usage",
    steps: [
      ["keys", "unknown"],
      ["keys", "get"],
      ["keys", "list", "extra"],
      ["keys", "get", "demo", "--bad"],
      ["keys", "set", "demo", "--stdin", "--stdin"],
      ["how", "repo", "extra"],
    ].map((args) => ({ args, usage: true })),
  },
];
let state = seed >>> 0;
const next = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state;
};
const providers = [
  "openai",
  "other",
  "0",
  "10",
  "2",
  "4294967294",
  "4294967295",
  "01",
  "__proto__",
  "constructor",
  "λ",
  "😀",
  "\ue000",
];
const values = [
  "fixture-short",
  "abc😀defgh🦉",
  "abcd😀efghi",
  "é🦉短",
  'quote"slash\\control\b\f',
  "\ufeff fixture \ufeff",
  "\u0085fixture\u0085",
  "\u2028\u2029",
  "line\nsecond",
  "x\0y",
];
sessions.push({
  name: "unicode-boundaries",
  steps: values.flatMap((value) => [
    { args: ["keys", "set", "unicode", "--stdin"], stdin: value },
    step("keys", "get", "unicode"),
  ]),
});
for (let i = 0; i < 12; i++) {
  const steps: Step[] = [];
  for (let j = 0; j < 6; j++) {
    const provider = providers[next() % providers.length]!;
    const value = values[next() % values.length]!;
    steps.push({ args: ["keys", "set", provider, "--stdin"], stdin: value });
    steps.push(step("keys", "get", provider), step("keys", "list"));
    if (next() % 2) steps.push(step("keys", "rm", provider));
  }
  sessions.push({ name: `seed-${seed}-${i}`, steps });
}

async function execute(program: string, args: string[], cwd: string, inputStep: Step) {
  const child = spawn(program, args, {
    cwd,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: ".",
      NO_COLOR: "1",
      TERM: "dumb",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(scratch, "bun-cache"),
      GOPATH: join(scratch, "go"),
      GOMODCACHE: join(scratch, "go/pkg/mod"),
      GOCACHE: join(scratch, "gocache"),
      ...inputStep.env,
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
  const timer = setTimeout(stop, 120_000); // stops only the named hung invocation
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  child.stdout.on("data", (data) => {
    out += data;
  });
  child.stderr.on("data", (data) => {
    err += data;
  });
  child.stdin.on("error", () => {
    /* a usage error may close stdin early */
  });
  child.stdin.end(inputStep.stdin ?? "");
  let code: number;
  try {
    code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) =>
        signal
          ? reject(
              new Error(`hung invocation stopped: ${JSON.stringify(inputStep.args)} ${signal}`),
            )
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
  let file: { text: string; mode: number } | null = null;
  try {
    const path = join(cwd, ".okra/keys.json");
    file = { text: await readFile(path, "utf8"), mode: (await stat(path)).mode & 0o777 };
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  return { out, err, code, file };
}
let compared = 0;
for (const session of sessions.filter((s) => !name || s.name === name)) {
  const dirs = await Promise.all(
    ["reference", "candidate"].map(async (impl) => {
      const dir = await mkdtemp(join(scratch, `okra-${session.name}-${impl}-`));
      if (session.initial !== undefined) {
        await mkdir(join(dir, ".okra"));
        await writeFile(join(dir, ".okra/keys.json"), session.initial, { mode: 0o644 });
      }
      return dir;
    }),
  );
  for (const current of session.steps) {
    const reference = await execute(
      process.execPath,
      [
        "--preload",
        join(root, "parity/deny-network.ts"),
        join(root, "src/main.ts"),
        ...current.args,
      ],
      dirs[0]!,
      current,
    );
    const actual = tsOnly
      ? await execute(
          process.execPath,
          [
            "--preload",
            join(root, "parity/deny-network.ts"),
            join(root, "src/main.ts"),
            ...current.args,
          ],
          dirs[1]!,
          current,
        )
      : await execute(candidate, current.args, dirs[1]!, current);
    if (current.usage && !tsOnly) {
      if (
        reference.code !== 1 ||
        actual.code !== 1 ||
        !actual.out.includes("okra") ||
        actual.err === ""
      )
        throw new Error(`usage lost help/error/status: ${JSON.stringify(current.args)}`);
      actual.out = reference.out;
      actual.err = reference.err;
    }
    if (JSON.stringify(reference) !== JSON.stringify(actual)) {
      // Synthetic fixtures only; never an inherited environment or owner store.
      console.error(
        JSON.stringify(
          {
            session: session.name,
            seed,
            step: current,
            reference,
            actual,
            replay: `bun parity/run.ts --seed=${seed} --case=${session.name}`,
          },
          null,
          2,
        ),
      );
      throw new Error(`${session.name}: parity mismatch`);
    }
    compared++;
  }
  console.log(`ok ${session.name}`);
}
if (!compared) throw new Error("No cases selected");
console.log(`PARITY EXIT: 0 (${compared} process pairs, seed ${seed})`);
