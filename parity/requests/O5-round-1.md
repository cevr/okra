ready

Protocol: supplied orchestrate implementor worker protocol. Spec: orchestrator's three-step message (step3/O5), cli-pilots/plan.md and decisions.md, common.md. Full request: /home/exedev/.cache/baton/wf10/cli-pilots/O5/round-1-request.md.
Head: 3460d48c0d64c52ebc3df0b224ef3c3a9af35873. Base: 6599d8a07b32c539b7deecaae440327995f4d2ba. Existing okra-ergo clone, ergo-port. No rebase/push/link change.
Measured diff: 11 files changed, 235 insertions(+), 83 deletions(-).

Changed ergo-toolchain.json to pilot-pin 1f6ed12d; cli/counsel.ergo now starts outside timeout, streams live files, waits inside, and consumes Stop in the catch with 15s grace and actual status. Staged sink names are published by open-file rename only after Start succeeds, with scope cleanup, preserving failed-spawn artifacts. cmd/counsel-probe and parity/counsel-stream.ts drive a readiness-gated fake Scheduler/agent and TERM trap status37. counsel-mutants/ledger add five unique guards. bin/okra/switch route counsel to Ergo and remove flag/missing-native fallback for ported commands. README/routing describe it; obsolete buffered differences are removed.

Replay: sh O5/gate.sh, sh O5/pin-regressions.sh, sh O5/accept.sh under the run directory, in the common.md42–44 bounded scope. GOMAXPROCS1/-p1, umask022, nice19, private cache/module paths and isolated HOME. common.md3's protocol.md read was not followed because the supplied prompt forbids it.

Measured O5/gate-cu4b-2.log: GATE EXIT:0, GATE SHELL EXIT:0 (fmt, strict typecheck/lint, touched-package tests, builds, parity seeds42/7, stream driver, 18/18 counsel and seven switch mutants). O5/finish-cu4b.log: PIN REGRESSIONS EXIT:0, ACCEPT EXIT:0, FINISH EXIT:0. Head acceptance commands: bun parity/counsel.ts --seed=42 (88 pairs) and bun parity/counsel-stream.ts (live partial files, timeout, status37), both exit0. Earlier keys/how/repo/skills/image pin regressions green; no full gate claim.

Red: prior status-probe.log rejects Wait after consuming Close; CU4b red.log rejects missing Stop. The first resumed gate proved failed-spawn empty sink publication; staging fixes it. New unique mutants: failed-spawn-publishes-sink, live-stdout-discarded, live-stderr-discarded, timeout-grace-lost and timeout-status-invented. New switch mutants: shim-counsel-to-ts, shim-counsel-flag-to-ts, shim-missing-native-to-ts. Reference-only retries for its known forked-sink race remain visible; no port retry/assertion deletion/normalization added.

Effect's scoped streams and detached termination become owned Running, ToFile, borrowing/takes and scope cleanup. Go open-file rename retains the same fd. Elixir Port reports status messages; Gleam shellout buffers; ReScript binds Node streams. No speed/Mac/live-service claim. No real agent/key/model/scheduler, paid call or push/link change. Processes clean, private scratch removed before handoff.

Known gap: O6 needs lossless live stdout tee/capture. The default-TS audit remains nonempty for schedule/root/distribution, so this is READY for O5 only, not step3 as a whole. See O6-round-1.md and the run's O6/blocked.md.
