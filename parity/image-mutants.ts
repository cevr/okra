// Each mutation has one user-visible guard named in IMAGE-MUTANTS.md. Mutant
// copies and binaries stay in this lane's scratch, never the original source.
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run } from "./process";

const root = resolve(import.meta.dir, "..");
const scratch = process.env.OKRA_PARITY_SCRATCH ?? "/tmp/opencode/okra-o4";
const compiler = process.env.ERGO ?? join(scratch, "ergo");
await mkdir(scratch, { recursive: true });
type Mutant = { name: string; file: string; from: string; to: string; guard: string };
const mutants: Mutant[] = [
  {
    name: "edit-auto-switches-paid",
    file: "image/image.ergo",
    from: "if !API(model) {",
    to: "if !API(model) && !c.Edit {",
    guard: "codex-edit-refused",
  },
  {
    name: "generation-drops-count",
    file: "imagehttp/transport.ergo",
    from: "json.IntNumber(int64(n.Value))",
    to: "json.IntNumber(int64(n.Value)*0+1)",
    guard: "multi",
  },
  {
    name: "codex-ignores-done-status",
    file: "imagehttp/codex.ergo",
    from: 'if status != None && status != (Some[string]{Value: "completed"}) { continue }',
    to: 'if status != None && status != (Some[string]{Value: "completed"}) && false { continue }',
    guard: "codex",
  },
  {
    name: "codex-takes-last-image",
    file: "imagehttp/codex.ergo",
    from: 'kind != "response.output_item.done" || found != None',
    to: 'kind != "response.output_item.done"',
    guard: "codex",
  },
  {
    name: "credentials-use-store-first",
    file: "imagehttp/transport.ergo",
    from: 'match env {\n\tcase Some[string] as e:\n\t\tif e.Value != "" { return e.Value }',
    to: 'match env {\n\tcase Some[string] as e:\n\t\tif false && e.Value != "" { return e.Value }',
    guard: "precedence",
  },
  {
    name: "suffix-before-first-dot",
    file: "image/image.ergo",
    from: 'let dot = strings.LastIndex(path, ".")\n\tlet slash',
    to: 'let dot = strings.Index(path, ".")\n\tlet slash',
    guard: "multi",
  },
  {
    name: "codex-fallback-on-any-error",
    file: "imagehttp/codex.ergo",
    from: 'if !strings.Contains(f.Message, "model is not supported when using Codex") { return f }',
    to: 'if !strings.Contains(f.Message, "model is not supported when using Codex") && false { return f }',
    guard: "model-no-fallback",
  },
  {
    name: "default-model-never-ranks",
    file: "imagehttp/models.ergo",
    from: "if !listed || status ==",
    to: "if !listed || true || status ==",
    guard: "model-cache",
  },
  {
    name: "decoding-requires-padding",
    file: "imagehttp/transport.ergo",
    from: 'if !strings.Contains(normalized, "=") {',
    to: 'if !strings.Contains(normalized, "=") && false {',
    guard: "unpadded",
  },
  {
    name: "generation-allows-zero",
    file: "imagehttp/transport.ergo",
    from: "if n.Value < 1 || n.Value > 10 {",
    to: "if (n.Value < 1 || n.Value > 10) && false {",
    guard: "zero-count",
  },
  {
    name: "edit-sends-json",
    file: "imagehttp/transport.ergo",
    from: "if editing {\n\t\t// The boundary",
    to: "if editing && false {\n\t\t// The boundary",
    guard: "edit",
  },
  {
    name: "output-printed-before-last-write",
    file: "cli/image.ergo",
    from: "try writeImage(path, bytes)",
    to: "io.Stdout.Println(path); try writeImage(path, bytes)",
    guard: "write-failure",
  },
  {
    name: "response-ignores-created",
    file: "imagehttp/transport.ergo",
    from: 'let _ = try jsview.Integer(try jsview.Required(v, "created"))',
    to: "let _ = v",
    guard: "missing-created",
  },
  {
    name: "empty-env-used",
    file: "imagehttp/transport.ergo",
    from: 'match env {\n\tcase Some[string] as e:\n\t\tif e.Value != "" { return e.Value }',
    to: 'match env {\n\tcase Some[string] as e:\n\t\tif true || e.Value != "" { return e.Value }',
    guard: "empty-env",
  },
  {
    name: "missing-home-reads-cwd",
    file: "cli/image.ergo",
    from: 'if homeValue == None { let _ = try image.Fail("AUTH_MISSING", "HOME environment variable is not set") }',
    to: 'if homeValue == None && false { let _ = try image.Fail("AUTH_MISSING", "HOME environment variable is not set") }',
    guard: "no-home",
  },
  // q100 precision: the declared exception admits only the declared wording
  // after the reference's own prefix.
  {
    name: "schema-suffix-undeclared",
    file: "imagehttp/transport.ergo",
    from: 'let SchemaMismatch = "response does not match the expected schema"',
    to: 'let SchemaMismatch = "unexpected response shape"',
    guard: "missing-created",
  },
  {
    name: "transport-prefix-dropped",
    file: "imagehttp/transport.ergo",
    from: 'image.Fail("GENERATION_FAILED", prefix+TransportFailed)',
    to: 'image.Fail("GENERATION_FAILED", "Image "+TransportFailed)',
    guard: "transport",
  },
  {
    name: "codex-transport-is-openai",
    file: "imagehttp/codex.ergo",
    from: 'try send("Image generation failed: ", setup.Codex',
    to: 'try send("Image generation failed (" + input.Model + "): ", setup.Codex',
    guard: "codex-transport",
  },
  {
    name: "unparsable-body-is-no-image",
    file: "imagehttp/transport.ergo",
    from: "let v = try jsview.Parse(text)\n\tlet _ = try jsview.Integer",
    to: 'let v = jsview.Parse(text) catch {\n\tcase _:\n\t\tlet _ = try image.Fail("NO_IMAGE", "OpenAI returned no image data. Try rephrasing the prompt.")\n\t\treturn []string{}\n\t}\n\tlet _ = try jsview.Integer',
    guard: "malformed-json",
  },
  {
    name: "sse-skips-bad-event",
    file: "imagehttp/codex.ergo",
    from: "let v = try jsview.Parse(payload)",
    to: "let v = jsview.Parse(payload) catch {\n\t\tcase _:\n\t\t\tcontinue\n\t\t}",
    guard: "codex-malformed-sse",
  },
];
let count = 0;
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
for (const m of mutants.filter((x) => !only || x.name === only)) {
  const dir = await mkdtemp(join(scratch, "image-mutant-"));
  await cp(join(root, "ergo"), join(dir, "ergo"), { recursive: true });
  const file = join(dir, "ergo", m.file);
  const text = await readFile(file, "utf8");
  if (text.split(m.from).length !== 2) throw new Error(`mutant edit not unique: ${m.name}`);
  await writeFile(file, text.replace(m.from, m.to));
  const binary = join(dir, "mutant");
  const build = await run(compiler, ["build", "ergo/cmd/okra-parity", "-o", binary], dir);
  if (build.code !== 0) throw new Error(`mutant did not compile ${m.name}: ${build.err}`);
  const guard = await run(
    process.execPath,
    ["parity/image.ts", `--binary=${binary}`, `--case=${m.guard}`],
    root,
    { OKRA_PARITY_SCRATCH: scratch },
  );
  if (guard.code === 0 || !guard.err.includes(`image parity mismatch: ${m.guard}`))
    throw new Error(`mutant survived or guard broke ${m.name}: ${guard.out}\n${guard.err}`);
  console.log(`killed ${m.name}: ${m.guard}`);
  count++;
}
console.log(`IMAGE MUTANTS EXIT: 0 (${count} killed)`);
