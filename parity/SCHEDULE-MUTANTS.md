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

The `--until` readers (`schedule/date.ergo`, `localzone/zone.ergo`) have one
guard, the until property `parity/until.ts --seed=42` (seeded texts in the
ECMAScript format, in Go's named layouts, at both edges of daylight-saving
changes in nine zones, local wall clocks at both edges of the Date range
(and the exact edge walls in zones whose offset there changes between the
equivalent years), TZ values that name no zone and TZ values drawn from
the carried, ICU and host zone name lists in the forms ICU reads, and near
misses; reference against port, rule in
`routing.md`, Schedule). `schedule-mutants.ts` requires
`until parity mismatch:`. The first ten are the round-1 verifier's parser
mutants; the old two-pass local offset is gone, and its place is taken by
the two local-time mutants.

| Mutant                      | What it shows                                                        |
| --------------------------- | -------------------------------------------------------------------- |
| offset-sign-dropped         | a `-hh:mm` offset is west of UTC                                     |
| colon-less-offset-refused   | `+0530` reads as `+05:30`                                            |
| lower-t-refused             | a lower-case `t` separates the time                                  |
| lower-z-refused             | a lower-case `z` is UTC                                              |
| zone-after-date-alone       | `0001Z` is refused (Bun reads 2001)                                  |
| hour-24-any-minute          | `24:00` is the only hour-24 time                                     |
| day-31-refused              | day 31 is in the format                                              |
| minus-zero-year-accepted    | `-000000` is refused                                                 |
| offset-hour-24-accepted     | an offset hour above 23 is refused                                   |
| range-check-dropped         | an instant past 8.64e15 ms is refused                                |
| go-layouts-skipped          | Go's named layouts are read                                          |
| go-layout-rfc1123-dropped   | RFC1123 is one of them                                               |
| go-no-zone-read-as-utc      | a Go layout with no zone is local time                               |
| go-named-offset-wrong       | `EDT` is UTC-4                                                       |
| go-unknown-zone-as-utc      | an abbreviation outside RFC 822's is refused                         |
| go-unread-zone-ends-search  | `+0012` is RubyDate's offset, after UnixDate refuses it as a name    |
| go-short-year-pivot-dropped | two-digit years 50 to 68 are refused                                 |
| go-low-year-accepted        | a four-digit year below 100 is refused in a Go layout                |
| local-overlap-later         | a repeated wall time is the earlier instant                          |
| local-gap-after-offset      | a skipped wall time reads in the offset before the change            |
| equivalent-wall-dropped     | a wall clock outside the Date range takes an equivalent year's offset |
| unnamed-zone-read-as-utc    | a local time under a TZ that names no zone is refused, not UTC       |
| zone-any-host-file          | a host zoneinfo file that is no zone id (posixrules) names no zone   |
| zone-colon-kept             | `:America/New_York` is New York, as Bun reads it                     |
| zone-prefix-kept            | `posix/America/New_York` is New York, as Bun reads it                |
| zone-prefix-twice           | `posix/right/America/New_York` names no zone (Bun reads UTC)         |
| zone-alias-ignored          | an ICU alias (`PST`) is its carried zone (`America/Los_Angeles`)     |
| zone-case-fold-dropped      | `america/new_york` is New York, as Bun reads it                      |
| zone-fold-mark-ignored      | `pst` names no zone: ICU reads its Java-style ids only as written    |
| zone-olson-check-dropped    | `:EST5EDT` is not EST5EDT: ICU's id check fails on the whole TZ      |
| host-zone-read-as-utc       | a TZ that fails ICU's id check is the host's zone, not UTC           |
| eq-leap-base-1960           | a leap year outside the range takes 2008's offset family, not 2012's |
| zone-data-not-carried       | built without `-tags=timetzdata`, a zone the host lacks fails        |

`zone-data-not-carried` edits no source: it builds with `GOFLAGS=-p=1`. It
dies only on a host whose zoneinfo lacks `America/Godthab` (this one).
`host-zone-read-as-utc` dies only on a host whose own zone is not UTC (on
a UTC host the two readings are the same instants), so the ledger runs it
only there: on the owner's Mac, or on Linux in a private mount namespace
whose `/etc/localtime` names another zone (`unshare -rm` and a bind-mounted
copy of `/etc`).

The switch guard (`parity/switch.ts --mutants`) kills shim-default-to-ts,
shim-schedule-to-ts, shim-empty-to-ts, shim-unknown-to-ts,
shim-root-flag-to-ts, shim-counsel-flag-to-ts and shim-missing-native-to-ts:
nothing reaches TypeScript unless `OKRA_IMPL=ts` asks for it. It also kills
shim-link-unresolved and shim-relative-link-from-cwd: the shim runs through
an absolute link in another folder and a relative link to that link (bun and
npm install `bin/okra` as a link; `~/.bun/bin/okra` is one).

No real agent, key, model, scheduler or network is used.
