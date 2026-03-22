---
"@cvr/okra": minor
---

Switch agent invocations to streaming JSON output for crash resilience

- Counsel: claude uses `--output-format stream-json`, codex uses `--json`
- Research: codex uses `--json`, extracts agent message from JSONL events
- Both providers now write `events.jsonl` with incremental events, postprocessed to `.md`
- Simplified InvocationRunner: spawn directly to `Bun.file()`, deleted fragile JS stream bridge
- Added `extractCodexMessage` and `extractClaudeMessage` using Schema-decoded JSONL parsing via `Bun.JSONL.parse`
- Added `eventsFile` to counsel `RunManifest` for raw event access
- Added `--color never` to all codex invocations for clean machine-consumed output
