ready

Protocol: supplied orchestrate worker protocol, Implementor (protocol.md/safety.md not read, as the prompt directs).
Spec: `/home/exedev/.cache/baton/wf10/cli-pilots/plan.md` (okra `image` row, §3.2/§3.4), the start message, the resume message (owner q100: option 2 of `O4/blocked.md`).
Head: `e3ccd08` (`feat(ergo): port image behind the subcommand switch`). Mirror commit of this file: `parity/requests/O4-round-1.md`, the next commit on the branch.
Base: `8548c73`. `git diff --stat 8548c73..e3ccd08 | tail -1` → `25 files changed, 1854 insertions(+), 25 deletions(-)` (measured).
Workspace: `/home/exedev/Developer/personal/.worktrees/okra-ergo`, branch `ergo-port`, unpushed, fast-forwarded from the O4 clone (removed after). Installed links unchanged. Compiler pin unchanged (`50facc08`).

## What changed, by file

- `ergo/image/image.ergo`: domain. Command, Input, Route union (Codex, Generate, Edit; matched in full), option checks (edit/mask/fidelity refusals on Codex, legacy quality, ref extensions), media types, prompt slug, output suffixes for several images, PNG/JPEG/WebP dimensions, `Failed{Code, Message}`.
- `ergo/imagehttp/transport.ergo`: OpenAI generations (JSON) and edits (multipart, collision-free boundary) on `http.Network`; key from `OPENAI_API_KEY` (empty = absent, as `Config.String`) then `keys.Store`; response decode with jsview under Schema's rules; base64 as `Uint8Array.fromBase64` (loose padding, whitespace). q100 wording constants `SchemaMismatch`, `TransportFailed`; `send` takes the reference's failure prefix.
- `ergo/imagehttp/codex.ergo`: `~/.codex/auth.json` and version file, Codex responses request, finite SSE read (no content-type, any chunking; first completed image wins), rate-limit/quota/server error lines, model fallback only on "model is not supported".
- `ergo/imagehttp/models.ergo`: model ranking from the Codex models cache and the models.dev catalogue, day cache at `~/.okra/models.json`, 5 s fetch limit, fallback model.
- `ergo/cli/image.ergo`, `ergo/cli/run.ergo`, both mains: flags, file reads/writes, size warning, `[CODE] message` status 1; main binds `imagehttp.Direct()`, the parity entry `imagehttp.Offline(origin)`.
- `bin/okra`, `parity/switch.ts`: `image` routes to Ergo by default; new switch mutant `shim-image-to-ts`.
- `parity/image.ts` (offline compiled TS reference vs native, loopback peer, isolated HOME, 45 fixed + 12 seeded cases), `image-network.ts` (deny-by-default fetch for the reference), `image-reference.ts`, `image-mutants.ts` (+ `--only=`), `IMAGE-MUTANTS.md`.
- `parity/declared-differences.md` (new): the q100 exception, cited, with its exact scope and guard. `parity/routing.md`, `ergo/README.md`: image routing and domain.
- `parity/mutants.ts`, `repo-mutants.ts`, `skills-mutants.ts`, `process.ts`, `run.ts`, `repo.ts`, `skills.ts`: scratch from `OKRA_PARITY_SCRATCH` (default unchanged `/tmp/opencode/linear-port`).

## q100 exception (owner, option 2)

Only in the cases named in `parity/image.ts`'s `q100` table (`missing-created`, `malformed-json`, `transport`, `codex-malformed-sse`, `codex-transport`): the reference's stderr must hold the declared prefix exactly once with a non-empty suffix after it, and the port's stderr must equal the reference's text through that prefix followed by exactly the declared wording. Code, prefix, model, earlier lines, stdout, status, files and requests compare byte for byte; every other case compares stderr byte for byte; server-given detail (401/403/429, Codex 400 detail) is never inside the exception. Measured: before this round the OpenAI transport line had a wrong prefix (`Image request transport failed`); it now keeps `Image generation failed (MODEL): `.

## How to run

```sh
cd /home/exedev/Developer/personal/.worktrees/okra-ergo
# compiler: go build ./cmd/ergo in a detached ergo checkout at 50facc08 -> $s/ergo
export OKRA_PARITY_SCRATCH=$s ERGO=$s/ergo
bun scripts/build.ts --ergo
bun parity/image.ts --build-reference --record-check   # TS vs TS
bun parity/image.ts --seed=42                           # TS vs native
bun parity/image-mutants.ts
bun parity/switch.ts --mutants
```

Environment used: `O4/env.sh` (GOMAXPROCS=1, -p 1, GOMEMLIMIT=6GiB, umask 022, private GOCACHE/GOPATH/GOMODCACHE), each run inside `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 nice -n 19` per common.md's memory rule (its Departs-from line over the protocol's no-own-scope rule).

## Gate (measured)

- `O4/gate-3.log` (script `O4/gate.sh`): every step green up to the last command: guides, Ergo fmt, oxfmt, tsgo strict, oxlint, `sh -n`, check+test of every Ergo package incl. image/imagehttp, both builds, `SWITCH EXIT: 0` (4 switch mutants), keys/how `PARITY EXIT: 0 (309 process pairs, seed 42)`, repo 145 pairs seeds 42/7 + `REPO MUTANTS EXIT: 0 (11 killed)`, `MUTANTS EXIT: 0`, skills 94 pairs seeds 42/7 + `SKILLS MUTANTS EXIT: 0 (8 killed)`, image `--record-check` 57 pairs, `IMAGE PARITY EXIT: 0 (57 process pairs, seed 42)` and seed 7, 18 image mutants killed. Exit line `GATE SHELL EXIT: 1`: mutant `unparsable-body-is-no-image` did not compile (the mutant text, not the product). Fixed in the mutant text.
- `O4/mutants-2.log`: `IMAGE MUTANTS EXIT: 0 (20 killed)`, `MUTANTS-2 EXIT: 0`, `SHELL EXIT: 0`. Nothing else changed between gate-3 and this run except `parity/image-mutants.ts`.
- gate-1/gate-2 failed on tsgo lib errors in `@effect/ai-openai` .d.ts (now `--skipLibCheck`; our files stay strict) and on oxlint (shadowing, complexity, side-effect imports; refactored). Not flakes.

## Acceptance at head

`O4/accept.sh` in okra-ergo at `e3ccd08` → `O4/accept-1.log`: `SWITCH EXIT: 0`, `IMAGE PARITY EXIT: 0 (57 process pairs, seed 42)`, `ACCEPT EXIT: 0`. Red at base: `O4/red-1.log` (`RED EXIT: 1`, `image` unknown at 8548c73).

## Mutants (each named before its guard)

20 image mutants in `parity/IMAGE-MUTANTS.md`, all killed; new this round: `schema-suffix-undeclared` (missing-created), `transport-prefix-dropped` (transport), `codex-transport-is-openai` (codex-transport), `unparsable-body-is-no-image` (malformed-json), `sse-skips-bad-event` (codex-malformed-sse). Switch: `shim-image-to-ts`.

## Known gaps

- Parity is against a compiled offline reference and a synthetic peer; no live-provider compatibility is claimed. No paid call, no real key or token read (fixture values, isolated HOME).
- Codex image bytes are read from a finite, bounded buffered response (std http at the pin); no unbounded stream claim. No CU6 file-download need.
- The skill invocation `okra image "<prompt>" --ref FILE --size WxH -o FILE` is covered by `codex-size` and the seeded cases (ref, size, format, output path).
- No macOS run, no performance claim.
- Safety: no deletion in a shell line; cleanup through `O4/cleanup.ts` (exact paths: the O4 clone and `/tmp/opencode/okra-o4`).
