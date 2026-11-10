ready

Protocol: supplied orchestrate worker protocol, Implementor (protocol.md/safety.md not read, as the prompt directs).
Spec: `/home/exedev/.cache/baton/wf10/cli-pilots/plan.md` sections 1.2, 3.1, 3.2, 3.4 (okra by subcommand: `repo`), plus the start message. Skills moved to unit O3 (orchestrator, after `O2/blocked.md`).
Head: `dcd6e2458feb48fb4122b1897606aeae540a748f` (`dcd6e24 feat(ergo): port repo behind the subcommand switch`).
Base: `35e3219` (O1 request head). Diff: `git diff --stat 35e3219..dcd6e24 | tail -1` → `24 files changed, 2773 insertions(+), 28 deletions(-)` (measured).
Workspace: `/home/exedev/Developer/personal/.worktrees/okra-ergo`, branch `ergo-port`, unpushed. Installed links unchanged. Compiler pin at this head: `ec6f1be2` (O3 re-pins to `50facc08` and re-runs this unit's legs there).

## Changes by file

- `ergo/repo/spec.ergo`, `catalog.ergo`, `text.ergo`: spec parsing (github/npm/pypi/crates), catalog with operation type and law `Catalog.LoadSeesSave`, JS text rules (binary-insertion sort with Bun's NaN behaviour, code-point collation, byte formatting).
- `ergo/jsview/view.ergo`: a JSON view over decoded values (first/last member rules as the original reads them).
- `ergo/cachefile/catalog.ergo`, `tree.ergo`, `tests.ergo`: file Catalog provider and cache-tree operations (removal through `go.Foreign` `os.RemoveAll`; std `fs` has no Lstat).
- `ergo/gitexec/git.ergo`: git clone/fetch/reset/ls-remote/describe over `exec.Runner`.
- `ergo/registryhttp/registry.ergo`: npm, PyPI, crates over `http.Network`; tarballs extracted with `tar` over stdin.
- `ergo/cli/repo.ergo`, `repo_flags.ergo`, `run.ergo`: `repo fetch|path|list|remove|clean`, `--json`, `-q`, `-y`, auto-prune after 30 days.
- `ergo/cmd/okra/main.ergo`, `ergo/cmd/okra-parity/main.ergo`: providers bound in main only; the parity entry rewrites registry origins to a loopback fake and refuses other hosts.
- `bin/okra`, `parity/switch.ts`, `parity/routing.md`, `scripts/build.ts`, `ergo/README.md`: shim sends `repo` to Ergo; switch mutant `shim-repo-to-ts`; declared differences.
- `parity/repo-world.ts`, `registry-network.ts`, `repo.ts`, `repo-mutants.ts`, `MUTANTS.md`: offline world (bare git remotes, tarballs, loopback registries), two-program sessions, tree snapshots, a seeded spec property and walks, 11 mutants.

## Run

```sh
cd /home/exedev/Developer/personal/.worktrees/okra-ergo
ERGO=<compiler built from ergo-toolchain.json> bun scripts/build.ts --ergo
bun parity/repo.ts --record-check
bun parity/repo.ts --seed=42
bun parity/repo-mutants.ts
```

## Evidence (measured)

- Round gate: `O2/gate.sh` → `O2/gate-repo.log`: every keys/how/repo step passed (fmt, oxfmt, tsgo, oxlint, `ergo check`/`ergo test` of every package incl. `repo.Catalog.LoadSeesSave` 100 cases, builds, `SWITCH EXIT: 0`, `PARITY EXIT: 0 (309 process pairs, seed 42)`, `REPO PARITY EXIT: 0 (145 process pairs, seed 42)` and seed 7, `MUTANTS EXIT: 0`, `REPO MUTANTS EXIT: 0 (11 killed)`). The log ends where I stopped it at the skills legs, which belong to O3. Exit line for this unit: `REPO MUTANTS EXIT: 0 (11 killed)`.
- Acceptance: `bun parity/repo.ts --seed=42` → `REPO PARITY EXIT: 0 (145 process pairs, seed 42)` (in `gate-repo.log`, tree at dcd6e24 plus untracked skills files that the repo legs do not read).
- Mutants: `O2/mutants-2.log` → `REPO MUTANTS EXIT: 0 (11 killed)`. `prune-window-ignored` first survived (`mutants-1.log`); the new session `auto-prune` kills it.
- Every run used the bounded runner (common.md memory rule, Departs-from line), nice 19, GOMAXPROCS=1, -p 1, umask 022, isolated HOME.

## Known gaps

- Incident: one manual probe ran the production native binary on `repo fetch bad` with no network guard. It made one unauthenticated GET to the public npm registry for the name "bad" (no credential, no paid service). After that, only `cmd/okra-parity` (loopback only) ran network cases.
- Follow-ups: dedupe JS text helpers (keys vs repo); the reference joins spec names with ".." into the cache path (kept for parity; fix in both).
- No macOS run, no performance claim.
