# Parity table

`bin/okra` execs `okra-ergo` for every argv: keys, how, repo (O2), skills
(O3), image (O4), counsel (O5), schedule and its subcommands (O6), the empty
argv, root flags (`--version`, `-v`, `--help`) and unknown commands.
`OKRA_IMPL=ts` is the explicit way back to `okra-ts` for all argv (owner q96);
`OKRA_IMPL=ergo` is the default. Unknown override values fail with status 1.
Nothing falls back to TypeScript for a flag or a missing native binary.
Effect-only global flags are dropped (owner q95), not sent to TS. The package
`bin` is `bin/okra`; `bun run dev` builds and runs the Ergo binary.

No installed link is changed. `scripts/build.ts` no longer links HOME/.bun/bin.
`bun run build` builds `okra-ts` (the rollback); `ERGO=/path/to/pinned/ergo bun
run build:ergo` generates guide assets and the version line, then builds
`okra-ergo` and the offline `okra-ergo-parity`. Publishing is not changed.

## Limits

- Help and usage-error layout use std flag; failures keep status 1. An argument
  that starts with "-" is flag syntax in both, with each parser's own rules
  (effect/cli reads `-é\tv2` as a `-v` cluster).
- Guides are generated from the registered current topics at build time, because
  the pinned compiler has no embed. The binary reads no guide folder at runtime.
  TS remains a build dependency until a later asset-embedding/compiler step.
- A key file is 0600 from its creation, not chmodded after a write. New key
  directories are private (0700), rather than the original umask-based mode.
- Filesystem failure reasons are native Go text; normal command/domain failures
  are compared byte for byte. Permission-denied paths are not yet in the corpus.
- No image, counsel or other paid/credentialed service has been invoked. All
  parity runs get an isolated HOME and explicit synthetic environment only.
  Image parity (`parity/image.ts`) runs a compiled offline reference against
  one loopback peer; it shows no live-provider compatibility.
- The reference's environment-name table inherits Object.prototype. `keys get`
  for prototype names (such as constructor) has a stable internal-error line.
  Native preserves those bytes with a typed failure rather than calling a
  dynamic non-string as configuration. This is compatibility, not a new API.
  Removal also preserves the reference's inherited-name existence policy;
  it does not put prototype values into the native store.

## Repo: declared differences

- The cause after `Failed to parse-metadata from <registry>: ` is the port's own
  text ("invalid JSON", "unexpected shape"); the reference prints Effect's
  schema or parser message. The prefix is compared byte for byte.
- A network failure prints the reference's `HttpClientError: Transport error`
  line for any transport failure; Effect's other client error texts are not
  reproduced. A response over 512 MiB fails (the reference has no bound).
- A refused metadata write, or a tree the host will not remove, is ignored
  silently; the reference logs an Effect warning line.
- `sizeBytes` that is not an integer, a lastAccessedAt that is not ISO text,
  npm versions or dist-tags named like Object.prototype members, and a NaN date
  in a list long enough for the engine to leave insertion sort are outside the
  corpus; the port's rules are stated in its source.
- Case mapping of GitHub names uses Go's simple lower case (no final-sigma or
  U+0130 context rules); name collation follows the root order for printable
  ASCII and code points beyond it. A cache folder that matches a GitHub name in
  two case spellings is found in sorted order, not directory order.
- Paths are the reference's: a spec name with ".." is joined as given. This is
  the reference's behaviour, kept for parity; see the follow-up in state.md.

## Skills: declared differences

- `skills add` with several candidates opens a multi-select (std prompt) on
  standard error. Installed skills show as `name (installed)` and are never
  installed; while one is not installed, an empty answer asks again. Escape,
  Ctrl-C or Ctrl-D cancel with status 130. When standard input is not a
  terminal, the reference draws its prompt on stdout and ends as an interrupt
  (status 130); the port writes nothing and fails with status 1 and the line
  `[NOT_INTERACTIVE] choosing skills needs a terminal on standard input; name
one skill (owner/repo@skill)`. `parity/skills.ts` checks that shape on every
  case where the reference ends with 130. The prompt frames are std prompt's,
  not effect/cli's.
- A network failure prints `HttpClientError: Transport error (GET <url>)` for
  any transport failure. A GitHub response whose shape does not match prints
  `unexpected response shape` in place of Effect's schema text. A `gh` that
  answers `--version` but then cannot start is named without the platform text.
- Two concurrent installs of one skill name race in the reference; the corpus
  does not hold such a pair.

## Schedule: declared differences

`parity/schedule.ts` runs the compiled reference (`parity/schedule-reference.ts`,
frozen `Date.now`, no network) and the port in one HOME, with fake `launchctl`,
`claude`, `codex`, `git`, `gh`, `tail` and `okra` first on PATH (the real agents
are never reached). Stdout, stderr, status, every file under HOME, each agent's
argv and folder, and each launchctl call compare byte for byte, except:

- Tasks and logs are listed in name order; the reference lists them in
  directory order (unspecified). The harness sorts list rows for multi-task
  cases.
- Why a task file does not decode is the port's own text after
  `Decode failed: ` and `Warning: skipping corrupt task file <name>: `; the
  line, its code and its status compare.
- `--until` accepts the ECMAScript date-time format (date only, with time,
  `Z` or an offset, fractions) as Bun reads it, and Go's named time layouts
  that write a date and a year (`Layout`, `ANSIC`, `UnixDate`, `RubyDate`,
  `RFC822`, `RFC822Z`, `RFC850`, `RFC1123`, `RFC1123Z`, `RFC3339`,
  `RFC3339Nano`, `DateTime`, `DateOnly`) as Go's `time.Parse` reads them
  (owner, O6 q1/q2). Where the port and Bun both read a text, they give the
  same instant; any other text fails with
  `[INVALID_DATE] ... Use ISO 8601 or YYYY-MM-DD.` A date-time with no zone
  is local time, in both formats, by ECMA-262's rule: in a daylight-saving
  gap the offset from before the change, in an overlap the earlier instant.
  A local wall clock outside the range a Date holds (within hours of
  `-271821-04-20` or `+275760-09-13`) takes the zone's offset in an
  equivalent year, as Bun's JavaScriptCore does (the year of 2008 to 2035
  with the same leap-ness and the same weekday on January 1; ES5 15.9.1.8),
  so the port gives Bun's instant or Bun's refusal there too.
  `parity/until.ts` holds these rules over seeded texts in nine zones,
  including local wall clocks within 15 hours of both edges of the range.
  Zone data: the port reads the host's zoneinfo first, then the tzdata the
  binary carries (Go 2026c, built with `-tags=timetzdata`), so a zone the
  host lacks (`America/Godthab` on hosts without backward names) still
  loads; Bun reads ICU's data (ICU 78.3). The same instant holds where the
  two data sets agree. Measured on this host (`O6/r3-tzcmp-*.txt` in the run
  notes; each Go offset interval's ends and the first of each month,
  1800-2040, against Bun's `Intl`): Go's carried data differs from ICU in
  102 of 598 zone names: in 95, history only, all of it before 1970 (among
  them many zones of Africa and the Caribbean, `Europe/Amsterdam`,
  `Atlantic/Reykjavik`, `Pacific/Majuro`, `America/Creston`; inferred: zones
  that tzdata links to another zone where ICU keeps their own history); in
  7, future rules from 2026 (`Africa/Casablanca`, `Africa/El_Aaiun`,
  `America/Edmonton`, `America/Vancouver`, `America/Yellowknife`,
  `Canada/Mountain`, `Canada/Pacific`; inferred: ICU's tz release is
  older). This host's zoneinfo (Ubuntu 2026c) differs in 121 of the 497
  names it has: history up to 1996 (`WET`), and the same future rules. The
  zones `until.ts` draws agree. A TZ that names no zone (an unknown name, a path, a POSIX rule)
  makes a local time fail (`TZ names no time zone`); Bun reads it as UTC
  (declared, port refuses).
  Texts only one side reads (declared):
  - only the port: Go's `Layout` form (`01/02 03:04:05PM '06 -0700`) and a
    comma before the fraction of seconds (`15:04:05,5`), which Go reads and
    Bun refuses;
  - only Bun: its legacy forms outside both formats (a zone after a date
    alone such as `0001Z`, which Bun reads as 2001; leading or trailing
    space; a day past the month's end, `Feb 30`; a one-digit day where Go
    writes two; an unknown weekday name; `GMT+3`; a lower-case or one-letter
    zone; second 60); the `Stamp` layouts, which write no year (Bun reads
    2001, Go year 0); and in a Go layout a year Bun reads another way (a
    four-digit year below 100, which Bun reads as two digits, and the two
    digits 50 to 68, which Go reads as 2050 to 2068 and Bun as 1950 to
    1968). A zone abbreviation is one of `UTC`, `GMT`, `EST`, `EDT`, `CST`,
    `CDT`, `MST`, `MDT`, `PST` and `PDT` (RFC 822's names), at its fixed
    offset; Go would read the others by the host's zone, and it does not
    read RFC 822's `UT`, which Bun reads.
- `--max-runs` reads a Go integer (std flag); Effect reads a JavaScript number
  and then requires an integer.
- Usage errors (a bad `--provider`, extra or missing arguments) print the
  port's help and error layout with status 1 (owner q95).
- launchd is macOS only; on Linux the corpus runs against the fake
  `launchctl`. No scheduler state was changed on any host.
