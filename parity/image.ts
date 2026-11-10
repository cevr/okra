// Builds Go because stdout/stderr/status, image files and actual multipart/SSE
// exchanges are the user contract; the checker cannot observe process effects.
// Only synthetic loopback peers and an isolated HOME are used, never paid APIs.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o4";
await mkdir(scratch, { recursive: true });
const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const seed = Number(arg("seed") ?? 42);
const tsOnly = process.argv.includes("--record-check");
const reference = join(scratch, "okra-image-ts");
const binary = arg("binary") ?? join(root, "bin/okra-ergo-parity");
if (process.argv.includes("--build-reference")) {
  const result = await Bun.build({
    entrypoints: [join(root, "parity/image-reference.ts")],
    target: "bun",
    compile: { outfile: reference, autoloadBunfig: false },
    define: {
      __VERSION__: JSON.stringify((await Bun.file(join(root, "package.json")).json()).version),
    },
  });
  if (!result.success) throw new Error(`reference build failed: ${result.logs.join("\n")}`);
}

// A header-only synthetic PNG is enough: the CLI reads dimensions, not pixels.
const png = Buffer.alloc(24);
png.set([137, 80, 78, 71, 13, 10, 26, 10]);
png.write("IHDR", 12);
png.writeUInt32BE(1254, 16);
png.writeUInt32BE(1254, 20);
type Case = {
  name: string;
  args: string[];
  mode?: string;
  auth?: string;
  env?: string;
  stored?: string;
  models?: string;
  blockedOutput?: string;
  noHome?: boolean;
  origin?: string;
};
type RequestLog = { path: string; auth: string; body: unknown };
let logs: RequestLog[] = [];
let mode = "ok";
const response = { id: "resp-fixture", model: "gpt-6-sol", created_at: 1, output: [] };
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const catalog = {
  openai: {
    models: {
      "gpt-6-sol": { family: "gpt-sol", release_date: "2026-09-22" },
      "gpt-6.1-sol": { family: "gpt-sol", release_date: "2026-09-29" },
      "gpt-9-sol": { family: "gpt-sol", release_date: "2026-10-01", status: "deprecated" },
      "gpt-6.2-sol": { family: "other", release_date: "2026-10-01" },
    },
  },
};
function sse() {
  let text = event({ type: "response.created", response });
  text += event({
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "image_generation_call", id: "img", status: "generating", result: null },
  });
  text += event({
    type: "response.output_item.done",
    output_index: 0,
    item: {
      type: "image_generation_call",
      id: "pending",
      status: "generating",
      result: "cGVuZGluZw==",
    },
  });
  if (mode !== "no-image") {
    text += event({
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "image_generation_call",
        id: "img",
        status: "completed",
        result: mode === "empty" ? null : png.toString("base64"),
      },
    });
    text += event({
      type: "response.output_item.done",
      output_index: 1,
      item: {
        type: "image_generation_call",
        id: "img2",
        status: "completed",
        result: Buffer.from("must not use second").toString("base64"),
      },
    });
  }
  return text + event({ type: "response.completed", response });
}
async function bodyOf(req: Request) {
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/")) {
    const entries: unknown[] = [];
    for (const [name, value] of await req.formData()) {
      entries.push(
        typeof value === "string"
          ? [name, value]
          : [
              name,
              value.name,
              value.type,
              Buffer.from(await value.arrayBuffer()).toString("base64"),
            ],
      );
    }
    return entries;
  }
  if (req.method === "GET") return null;
  return req.json();
}
const peer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = await bodyOf(req);
    logs.push({ path, auth: req.headers.get("authorization") ?? "", body });
    if (path === "/catalog/api.json") return Response.json(catalog);
    const status = Number(mode);
    if (status >= 400)
      return Response.json({ error: { message: "fixture rejection" } }, { status });
    if (path === "/codex/responses") {
      if (mode === "reject" && (body as Record<string, unknown>).model === "gpt-6.1-sol")
        return Response.json(
          { detail: "The model is not supported when using Codex with a ChatGPT account." },
          { status: 400 },
        );
      // Deliberately no content-type; split across event and UTF-8 borders.
      const bytes = new TextEncoder().encode(
        mode === "malformed" ? 'data: {"type": "response.created", \n\n' : sse(),
      );
      return new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.slice(i, i + 13));
            controller.close();
          },
        }),
      );
    }
    if (path !== "/openai/images/generations" && path !== "/openai/images/edits")
      return new Response("unexpected", { status: 404 });
    return openai(body);
  },
});
function openai(body: unknown) {
  if (mode === "no-image")
    return Response.json({
      created: 1,
      data: [{ url: "https://nonexistent.invalid/no-download" }],
    });
  if (mode === "invalid64")
    return Response.json({ created: 1, data: [{ b64_json: "!!!nope!!!" }] });
  if (mode === "unpadded") return Response.json({ created: 1, data: [{ b64_json: "YQ" }] });
  if (mode === "missing-created")
    return Response.json({ data: [{ b64_json: png.toString("base64") }] });
  if (mode === "malformed") return new Response('{"created": 1, "data": [');
  let n = 1;
  if (Array.isArray(body)) n = Number(body.find((entry) => entry[0] === "n")?.[1] ?? 1);
  else if (typeof body === "object" && body !== null && "n" in body) n = Number(body.n);
  return Response.json({
    created: 1,
    data: Array.from({ length: n }, (_, i) => ({
      b64_json: Buffer.concat([png, Buffer.from([i])]).toString("base64"),
    })),
  });
}
const origin = `http://127.0.0.1:${peer.port}`;
// A loopback port that was bound and then released: a refused connection.
const closedPeer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const closed = `http://127.0.0.1:${closedPeer.port}`;
await closedPeer.stop(true);
const model = "gpt-image-2.5-flare";
// Owner q100 (parity/declared-differences.md): in these cases only, the text
// after the reference's failure prefix comes from Effect Schema, the JSON
// parser or the HTTP adapter, and the port prints its own one wording. The
// prefix (code, message, model), the earlier lines, status, files and requests
// stay byte-equal; the port's text must be exactly the declared wording.
const schemaMismatch = "response does not match the expected schema";
const transportFailed = "request transport failed";
const q100: Record<string, { prefix: string; ergo: string }> = {
  "missing-created": {
    prefix: `[GENERATION_FAILED] OpenAI returned an unexpected response (${model}): `,
    ergo: schemaMismatch,
  },
  "malformed-json": {
    prefix: `[GENERATION_FAILED] OpenAI returned an unexpected response (${model}): `,
    ergo: schemaMismatch,
  },
  transport: {
    prefix: `[GENERATION_FAILED] Image generation failed (${model}): `,
    ergo: transportFailed,
  },
  "codex-malformed-sse": {
    prefix: "[GENERATION_FAILED] Image generation failed: ",
    ergo: schemaMismatch,
  },
  "codex-transport": {
    prefix: "[GENERATION_FAILED] Image generation failed: ",
    ergo: transportFailed,
  },
};
const cases: Case[] = [
  {
    name: "missing-created",
    args: ["cube", "--model", model],
    env: "fixture-env",
    mode: "missing-created",
  },
  {
    name: "malformed-json",
    args: ["cube", "--model", model],
    env: "fixture-env",
    mode: "malformed",
  },
  { name: "transport", args: ["cube", "--model", model], env: "fixture-env", origin: closed },
  {
    name: "codex-malformed-sse",
    args: ["cube", "--model", "gpt-6-sol"],
    auth: "valid",
    mode: "malformed",
  },
  {
    name: "codex-transport",
    args: ["cube", "--model", "gpt-6-sol"],
    auth: "valid",
    origin: closed,
  },
  {
    name: "empty-env",
    args: ["cube", "--model", model, "-o", "out.png"],
    env: "",
    stored: "fixture-stored",
  },
  { name: "no-home", args: ["cube", "--model", "gpt-6-sol"], auth: "valid", noHome: true },
  { name: "missing", args: [] },
  {
    name: "generate",
    args: ["a neutral cube", "--model", model, "-o", "result.png"],
    env: "fixture-env",
  },
  {
    name: "store",
    args: ["cube", "--model", model, "-o", "nested/result.webp", "--format", "webp"],
    stored: "fixture-stored",
  },
  {
    name: "precedence",
    args: ["cube", "--model", model, "-o", "result"],
    env: "fixture-env",
    stored: "fixture-stored",
  },
  {
    name: "multi",
    args: [
      "cube",
      "--model",
      model,
      "--n",
      "3",
      "--quality",
      "max",
      "--background",
      "transparent",
      "-o",
      "nested/out.multi.png",
    ],
    env: "fixture-env",
  },
  { name: "no-key", args: ["cube", "--model", model] },
  { name: "401", args: ["cube", "--model", model], env: "fixture-env", mode: "401" },
  { name: "403", args: ["cube", "--model", model], env: "fixture-env", mode: "403" },
  { name: "429", args: ["cube", "--model", model], env: "fixture-env", mode: "429" },
  { name: "no-image", args: ["cube", "--model", model], env: "fixture-env", mode: "no-image" },
  {
    name: "edit",
    args: [
      "make blue",
      "--model",
      model,
      "--ref",
      "ref.png",
      "--mask",
      "mask.png",
      "-o",
      "edited.png",
    ],
    env: "fixture-env",
  },
  {
    name: "edit-multi",
    args: [
      "make blue",
      "--model",
      "gpt-image-1.5",
      "--ref",
      "ref.jpg",
      "--ref",
      "ref.webp",
      "--fidelity",
      "high",
      "--n",
      "2",
      "-o",
      "edit",
    ],
    env: "fixture-env",
  },
  { name: "codex", args: ["cube", "--model", "gpt-6-sol", "-o", "codex.png"], auth: "valid" },
  {
    name: "codex-size",
    args: [
      "cube",
      "--size",
      "1024x1536",
      "--ref",
      "ref.png",
      "--quality",
      "high",
      "--n",
      "2",
      "-o",
      "codex.png",
    ],
    auth: "valid",
  },
  { name: "codex-noauth", args: ["cube", "--model", "gpt-6-sol"] },
  { name: "codex-malformed", args: ["cube", "--model", "gpt-6-sol"], auth: "malformed" },
  { name: "codex-401", args: ["cube", "--model", "gpt-6-sol"], auth: "valid", mode: "401" },
  {
    name: "codex-noimage",
    args: ["cube", "--model", "gpt-6-sol"],
    auth: "valid",
    mode: "no-image",
  },
  { name: "codex-empty", args: ["cube", "--model", "gpt-6-sol"], auth: "valid", mode: "empty" },
  { name: "codex-edit-refused", args: ["cube", "--edit"] },
  { name: "codex-mask-refused", args: ["cube", "--mask", "mask.png"] },
  { name: "codex-fidelity-refused", args: ["cube", "--fidelity", "high"] },
  { name: "missing-source", args: ["cube", "--model", model, "--edit"] },
  {
    name: "no-fidelity",
    args: ["cube", "--model", model, "--ref", "ref.png", "--fidelity", "high"],
  },
  { name: "fidelity-generation", args: ["cube", "--model", "gpt-image-1", "--fidelity", "low"] },
  { name: "dalle-edit", args: ["cube", "--model", "dall-e-3", "--ref", "ref.png"] },
  { name: "legacy-quality", args: ["cube", "--model", "gpt-image-1", "--quality", "xhigh"] },
  { name: "ref-extension", args: ["cube", "--ref", "bad.txt"] },
  { name: "ref-missing", args: ["cube", "--model", model, "--ref", "gone.png"] },
  { name: "invalid64", args: ["cube", "--model", model], env: "fixture-env", mode: "invalid64" },
  { name: "unpadded", args: ["cube", "--model", model], env: "fixture-env", mode: "unpadded" },
  { name: "zero-count", args: ["cube", "--model", model, "--n", "0"], env: "fixture-env" },
  { name: "large-count", args: ["cube", "--model", model, "--n", "11"], env: "fixture-env" },
  {
    name: "write-failure",
    args: ["cube", "--model", model, "--n", "2", "-o", "out.png"],
    env: "fixture-env",
    blockedOutput: "out-2.png",
  },
  { name: "model-cache", args: ["cube", "-o", "out.png"], auth: "valid", models: "fresh" },
  { name: "model-fetch", args: ["cube", "-o", "out.png"], auth: "valid", models: "fetch" },
  {
    name: "model-fallback",
    args: ["cube", "-o", "out.png"],
    auth: "valid",
    models: "fresh",
    mode: "reject",
  },
  {
    name: "model-no-fallback",
    args: ["cube", "-o", "out.png"],
    auth: "valid",
    models: "fresh",
    mode: "429",
  },
];
let state = seed >>> 0;
const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
for (let i = 0; i < 12; i++) {
  const api = next() % 2 === 0;
  const args = [
    `shape ${next()} λ 🌱`,
    "--model",
    api ? model : "gpt-6-sol",
    "--size",
    ["auto", "1024x1024", "1536x1024"][next() % 3]!,
    "--format",
    ["png", "webp", "jpeg"][next() % 3]!,
    "-o",
    `gen${i}.result`,
  ];
  if (api) args.push("--n", String(1 + (next() % 3)));
  if (next() % 3 === 0) args.push("--ref", "ref.png");
  cases.push({ name: `seed-${seed}-${i}`, args, auth: "valid", env: "fixture-env" });
}

async function setup(c: Case) {
  const dir = await mkdtemp(join(scratch, "image-case-"));
  for (const name of ["ref.png", "ref.jpg", "ref.webp", "mask.png"])
    await writeFile(join(dir, name), png);
  await mkdir(join(dir, ".codex"));
  if (c.blockedOutput) await mkdir(join(dir, c.blockedOutput));
  if (c.models) {
    await writeFile(
      join(dir, ".codex/models_cache.json"),
      JSON.stringify({
        models: ["gpt-6-sol", "gpt-6.1-sol", "gpt-9-sol", "gpt-6.2-sol"].map((slug) => ({
          slug,
          visibility: "list",
        })),
      }),
    );
    if (c.models === "fresh") {
      await mkdir(join(dir, ".okra"), { recursive: true });
      await writeFile(
        join(dir, ".okra/models.json"),
        JSON.stringify({ format: 1, fetchedAt: 9000000000000000, catalog }) + "\n",
      );
    }
  }
  if (c.auth)
    await writeFile(
      join(dir, ".codex/auth.json"),
      c.auth === "valid"
        ? JSON.stringify({
            tokens: { access_token: "fixture-codex", account_id: "fixture-account" },
          })
        : "{}",
    );
  if (c.stored) {
    await mkdir(join(dir, ".okra"));
    await writeFile(join(dir, ".okra/keys.json"), JSON.stringify({ openai: c.stored }), {
      mode: 0o600,
    });
  }
  return dir;
}
async function snapshot(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(join(dir, rel))).sort()) {
    const path = join(rel, name);
    const info = await lstat(join(dir, path));
    if (info.isDirectory()) out.push(...(await snapshot(dir, path)));
    else {
      let bytes = await readFile(join(dir, path));
      if (path === ".okra/models.json") {
        const value = JSON.parse(bytes.toString()) as { fetchedAt: unknown };
        if (typeof value.fetchedAt !== "number" || !Number.isFinite(value.fetchedAt))
          throw new Error("invalid catalog timestamp");
        value.fetchedAt = "<clock>";
        bytes = Buffer.from(JSON.stringify(value));
      }
      out.push(`${path} ${info.mode & 0o777} ${createHash("sha256").update(bytes).digest("hex")}`);
    }
  }
  return out;
}
function semantic(log: RequestLog) {
  if (log.path !== "/codex/responses") return log;
  // SDK-only defaults and random session IDs are not the request contract.
  const b = log.body as Record<string, unknown>;
  return {
    ...log,
    body: {
      model: b.model,
      input: b.input,
      tools: b.tools,
      tool_choice: b.tool_choice,
      store: b.store,
      stream: b.stream,
    },
  };
}
async function execute(program: string, c: Case) {
  const dir = await setup(c);
  logs = [];
  mode = c.mode ?? "ok";
  const child = spawn(program, ["image", ...c.args], {
    cwd: dir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...(c.noHome ? {} : { HOME: "." }),
      PATH: "/usr/bin:/bin",
      NO_COLOR: "1",
      TERM: "dumb",
      OKRA_PARITY_ORIGIN: c.origin ?? origin,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(scratch, "bun-cache"),
      ...(c.env !== undefined ? { OPENAI_API_KEY: c.env } : {}),
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
        /* already ended */
      }
    }
  };
  const timer = setTimeout(stop, 120_000); // only stops a hung image case
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  child.stdout.on("data", (s) => {
    out += s;
  });
  child.stderr.on("data", (s) => {
    err += s;
  });
  let code: number;
  try {
    code = await new Promise<number>((yes, no) => {
      child.once("error", no);
      child.once("close", (status, signal) =>
        signal ? no(new Error(`hung image case ${c.name}: ${signal}`)) : yes(status ?? 1),
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
    throw new Error("owned image process remains");
  return {
    out: out.replaceAll(dir, "<DIR>"),
    err: err.replaceAll(dir, "<DIR>"),
    code,
    files: await snapshot(dir),
    requests: logs.map(semantic),
  };
}
type Run = Awaited<ReturnType<typeof execute>>;
// declared returns both runs with the q100 suffix replaced by one marker, or
// null when the port's stderr is not exactly the reference's head followed by
// the declared wording. Undeclared cases are returned unchanged.
function declared(name: string, want: Run, got: Run): [Run, Run] | null {
  const d = q100[name];
  if (!d) return [want, got];
  const at = want.err.indexOf(d.prefix);
  if (at < 0 || want.err.indexOf(d.prefix, at + 1) >= 0 || !want.err.endsWith("\n")) return null;
  const head = want.err.slice(0, at + d.prefix.length);
  if (want.err.length <= head.length + 1) return null; // the reference gave no suffix
  // The record-check compares the reference with itself.
  if (got.err !== (tsOnly ? want.err : `${head}${d.ergo}\n`)) return null;
  const err = `${head}<q100 suffix>\n`;
  return [
    { ...want, err },
    { ...got, err },
  ];
}
let count = 0;
try {
  for (const c of cases.filter((x) => !arg("case") || x.name === arg("case"))) {
    const want = await execute(reference, c);
    const got = await execute(tsOnly ? reference : binary, c);
    const compared = declared(c.name, want, got);
    if (!compared || !isDeepStrictEqual(compared[0], compared[1])) {
      console.error(
        JSON.stringify(
          {
            seed,
            case: c,
            want,
            got,
            replay: `bun parity/image.ts --seed=${seed} --case=${c.name}`,
          },
          null,
          2,
        ),
      );
      throw new Error(`image parity mismatch: ${c.name}`);
    }
    if (want.err.includes("parity refuses") || want.err.includes("Internal error"))
      throw new Error(`invalid reference ${c.name}`);
    console.log(`image ${c.name}: ${want.code}`);
    count++;
  }
  if (count === 0) throw new Error("no image cases selected");
  console.log(`IMAGE PARITY EXIT: 0 (${count} process pairs, seed ${seed})`);
} finally {
  await peer.stop(true);
}
