blocked

Protocol: supplied implementor worker protocol. Spec: orchestrator's step3/O6, cli-pilots/plan.md and decisions.md, common.md.
Head: 3460d48c0d64c52ebc3df0b224ef3c3a9af35873, sole okra-ergo clone. Compiler pin 1f6ed12d4defc7a08c9a25681899cb68b41f3466. Full blocker: /home/exedev/.cache/baton/wf10/cli-pilots/O6/blocked.md.

O5 is green and defaults to Ergo: live files, Start outside/Wait inside/Stop catch, trap status37, 18 counsel mutants, seven switch mutants, head gate/acceptance and prior-pin regressions. No schedule implementation/gate is claimed.

AgentPlatform.ts:83–95 tees raw stdout bytes live while collecting them. Managed ToCaller currently exposes only Lines, which discards newline information and delays partial fragments. The run's O6/raw-probe.log demonstrates identical lines for `x` and `x\n` (LINE COLLISION EXIT:0), then exactly one S104 for the desired byte-stream caller form: Running has no Chunks (RAW CHECK EXIT:1). Buffered Run cannot deliver live; Inherit and ToFile each choose one destination.

Recommended next unit: neutral std exec lossless caller chunks or an equivalent lossless tee sink, retaining ownership/backpressure/grace/reap semantics; prefix-model and real event-driven tee guards. Merge into pilot-pin, repin this same clone, then implement O6 and finish the all-native root/distribution switch. Rejected: guessed newline, buffered downgrade, raw host-process bypass or a new TS fallback. The audit is intentionally not empty: schedule/root/package/dev paths remain. No real scheduler/key/model/agent or paid call, no push/link change. Processes clean, private caches removed before handoff.
