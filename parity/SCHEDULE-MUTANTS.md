# Schedule seams and mutants (O6)

Named before adding each guard. A guard is a case of `parity/schedule.ts`
(fixed cases plus 16 seeded cases), or the live-tee driver
`parity/schedule-stream.ts`; `parity/schedule-mutants.ts` builds each mutant
and requires `schedule parity mismatch: <guard>` (or
`schedule stream mismatch:`). The domain laws (`ergo test ergo/schedule`,
`ergo/taskfile`) stay as they were.

| Mutant                     | Guard                    | What it shows                                                     |
| -------------------------- | ------------------------ | ----------------------------------------------------------------- |
| tee-after-exit             | stream                   | agent stdout reaches okra's stdout while the agent runs           |
| schedule-hint-lost         | invalid                  | INVALID_SCHEDULE prints its recovery hint                         |
| pr-url-makes-context       | context-pr-only          | a pull request URL alone makes no context                         |
| origin-prefix-kept         | weekday-create-list      | the default branch drops `origin/`                                |
| until-day-start            | until-date-only          | a date alone stops at the day's last millisecond                  |
| stop-when-without-fallback | stop-when-needs-fallback | `--stop-when` needs `--max-runs` or `--until`                     |
| schema-check-skipped       | invalid-schema-value     | a schedule number Schema refuses is the reference's defect line   |
| remove-checks-id-first     | remove-invalid-id        | remove asks launchctl before it checks the id                     |
| any-nonce-signals          | run-no-signal            | only this run's nonce is a stop signal                            |
| verifier-answer-ignored    | run-signal-rejected      | the verifier's NO keeps the task                                  |
| failed-run-not-counted     | run-spawn-failed         | a failed run still counts and records its time                    |
| post-run-stop-skipped      | run-max-runs-post        | stops are checked again on the updated task after a run           |
| okra-fallback-guessed      | no-okra-on-path          | with no okra found, the plist names the bare `okra`               |
| corrupt-warning-dropped    | list-corrupt             | each task file that does not decode is named on stderr            |
| version-first-word-only    | root-version             | `--version` and `-v` print the version anywhere before `--`       |
| empty-argv-is-usage        | root-empty               | no arguments: no output, status 0                                 |
| max-runs-off-by-one        | run-max-runs-pre         | a task stops when its runs reach the maximum                      |

The switch guard (`parity/switch.ts --mutants`) kills shim-default-to-ts,
shim-schedule-to-ts, shim-empty-to-ts, shim-unknown-to-ts,
shim-root-flag-to-ts, shim-counsel-flag-to-ts and shim-missing-native-to-ts:
nothing reaches TypeScript unless `OKRA_IMPL=ts` asks for it.

No real agent, key, model, scheduler or network is used.
