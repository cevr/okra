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

Not guarded by a case: the one-hour timeout, an interrupt, and an agent's
background children (`declared-differences.md`, counsel); live agents and
the live model catalog (no real agent or model is called).
