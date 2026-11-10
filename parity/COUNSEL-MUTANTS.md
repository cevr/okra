# Counsel seams and mutants (O5)

Named before adding each guard. The guard is a case of `parity/counsel.ts`
(fixed cases, plus 24 seeded cases); `parity/counsel-mutants.ts` builds each
mutant and requires `counsel parity mismatch: <guard>`. Earlier keys, repo,
skills and image guards never call counsel.

| Mutant                          | Guard case              | What it shows                                                 |
| ------------------------------- | ----------------------- | ------------------------------------------------------------- |
| jsonl-opener-ends-member        | claude-ok               | `[` or `{` after `:` is a value, not a stop (the round-1 bug) |
| jsonl-opener-ends-element       | claude-nested           | `[` or `{` as an array element is a value                     |
| jsonl-later-garbage-fails       | claude-later-garbage    | a wrong line after a value keeps the values before it         |
| jsonl-cut-first-fails           | claude-cut              | a cut-off first value is no value, not a parse defect         |
| claude-mistyped-is-error-read   | claude-mistyped         | a result whose `is_error` is not a boolean is skipped         |
| claude-model-not-read           | claude-ok               | the manifest model is the init event's model                  |
| codex-takes-last-failure        | codex-turn-failed       | the first `turn.failed` refuses                               |
| codex-fallback-on-any-refusal   | codex-fallback-stops    | only a model refusal tries the next model                     |
| empty-marker-counts             | marker-empty            | an empty marker variable is no marker                         |
| exit-status-ignored-with-answer | claude-exit-with-answer | an answer with a non-zero exit is a failure                   |
| bucket-drops-dotted-i           | bucket-names            | U+0130 lowers to `i` in the bucket name                       |
| stdin-bom-not-blank             | prompt-stdin-blank      | U+FEFF is blank for the stdin prompt (JavaScript `trim`)      |
| display-unquoted                | spawn-failed            | the spawn failure quotes each word for a POSIX shell          |

The native stream driver guards the timeout without a wall-clock wait:
an injected Scheduler waits for the fake agent's FIFO event, checks both
partial sink files while it runs, then expires. The agent's TERM trap exits 37. New mutants in counsel-mutants.ts use this driver:

| Mutant                  | Guard            | What it shows                                            |
| ----------------------- | ---------------- | -------------------------------------------------------- |
| live-stdout-discarded   | stream-lifecycle | stdout bytes reach the file before exit                  |
| live-stderr-discarded   | stream-lifecycle | stderr bytes reach the file before exit                  |
| timeout-grace-lost      | stream-lifecycle | TERM gets its 15-second grace, not immediate KILL        |
| timeout-status-invented | stream-lifecycle | the manifest input is the actual post-termination status |

The switch guard also kills shim-counsel-to-ts. No live agent, real key,
live model catalogue or paid service is used. Managed exec's own lifecycle
property guards group cleanup; this driver exercises the consumer contract.
