ready

Protocol: supplied orchestrate worker protocol, Implementor (protocol.md/safety.md not read).
Spec: `/home/exedev/.cache/baton/wf10/cli-pilots/plan.md` sections 1.2, 3.1, 3.2, 3.4 plus the start message. This group is keys/how; repo follows separately.
Head: `f600a2c48fb6a9337e0850debbcdd7d305dcf58c` (code head).
Base: `c30423b307a5477b43e1b2a74232bc2927f545e9` (fresh origin/main).
Diff: `24 files changed, 1181 insertions(+), 56 deletions(-)` (`git diff --stat c30423b..f600a2c | tail -1`).
Workspace: okra-ergo, ergo-port, unpushed. Canonical request: `/home/exedev/.cache/baton/wf10/cli-pilots/O1/round-1-request.md`.

## Changes

- keys owns private Keys entries, JSON ordering/last-value semantics, Unicode construction, UTF-16 masking/name order, JS trimming, Store law and typed command failures.
- keyfile captures filesystem providers and writes 0600 from creation; its row-free in-memory constructor admits the actual provider law. memory uses a shared Ref and the same law.
- how renders immutable current guide data. CLI uses CU1 trees; main alone chooses host providers.
- scripts/guides.ts generates native assets from current registered topics, not the older Ergo examples. The ignored generated file is reproducible build output.
- scripts/build.ts builds siblings and no longer changes the installed link. bin/okra execs keys/how through native, other groups through TS, with OKRA_IMPL override. Package scripts, module/pin, ignores, routing docs and tool lint adapters accompany it. TS source/tests and npm bin metadata remain.
- parity contains isolated current-source TS/native sessions, a network-denying preload, owned-process helpers, deterministic replay, switch guards, mutants and ledger. Streams, exits, file bytes/modes compare after every step. Usage layout is declared std flag behavior.

## Run and measured receipts

Use compiler ec6f1be2 with private Go caches. `ERGO=/path/to/ergo bun run build:ergo`; `bun run build`; `bun parity/run.ts --record-check`; `bun parity/run.ts`; `bun parity/switch.ts --mutants`; `bun parity/mutants.ts`.

- Gate: `sh /home/exedev/.cache/baton/wf10/cli-pilots/O1/gate.sh`; `O1/gate-1.log`, final run 3 at f600a2c: `GATE EXIT: 0`, `GATE SHELL EXIT: 0`. Formatting/typecheck/lint, six package checks/tests, both builds, switch, stable TS pairs and native parity pass. Both Store laws run 100 cases, no skip.
- At-head acceptance: `bun parity/run.ts` in that gate: `PARITY EXIT: 0 (309 process pairs, seed 42)`. Only fixture HOME/cwd/env; no inherited keys or tokens. TS preload refuses every network request.
- Red: `O1/red-1.log` ends `RED EXIT: 1` (no native implementation at base). duplicate-red.log and inherited-red.log prove the two smallest compatibility bugs red. check-5.log records invalid-byte persistence law failure, seed42 case11.
- Ten product mutants and one switch mutant killed. Ledger lists distinct guards: inherited remove, shadowed JSON member, invalid-byte construction, prototype env name, memory save, unrelated-provider preservation, env precedence, UTF-16 mask, JS trim, numeric-key order and switch routing. `O1/mutants-2.log`: `MUTANTS EXIT: 0`, `FOCUSED EXIT: 0`.
- Earlier gates failed on harness lint and non-unique/formatter-sensitive mutant edits only. Those edits are now unique, compile and fail their intended guards. No load flake, deleted assertion or relaxed comparison.

## Decisions and known gaps

Decided by derive-dont-sync: current guide assets are generated during build because embed is absent. Effect tags/layers become Store/context; runtime schemas/tags become codec/records and typed failures; CLI builders become command data. Reference prototype bugs retain their measured failure/existence policy through typed compatibility code, not unchecked dynamic values. Private writes improve the original's chmod-after-write window.

Help/usage layout is native. New key directories are 0700. Filesystem failure reason text is native; permission-denied paths are not in the corpus. Evidence is finite testing, not a universal proof. No performance claim. Repo and the remaining groups are still TS; their source has only been read. No paid call, real key/token read, owner-link change, push, publish or Ergo compiler edit.

Umask 022, nice 19, GOMAXPROCS=1, Go -p 1, GOMEMLIMIT=6GiB, kernel data ceiling 8 GiB and private caches. No custom scope because the supplied higher-priority protocol forbids it despite common.md 42–44. Owned groups checked. Written cleanup script L4b/cleanup.ts removed only the detached compiler worktree and owned scratch/module/Go caches; `O1/cleanup.log`: `CLEANUP EXIT: 0`, `CLEANUP SCRIPT EXIT: 0`. CLI clones retained.
