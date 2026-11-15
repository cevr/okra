# Mutant ledger

Public seams: the native CLI session against the TypeScript CLI's recorded one (parity/frozen) (streams, status and
fixture file bytes/mode), and operation laws over an in-memory provider. No real
key, token, HOME or paid peer is part of a test.

## O1: keys and how (`bun parity/mutants.ts`)

- `memory-save-drops-value`: Store.LoadSeesSave, not process parity (which binds keyfile).
- `key-domain-keeps-invalid-utf8`: Store.LoadSeesSave on the filesystem provider; generated source byte strings must enter the JSON-text domain through Unicode normalization. CLI argv fixtures are Unicode, so their sessions do not cover this.
- `codec-drops-other-provider`: seeded multi-step sessions preserve unrelated entries.
- `decode-validates-shadowed-value`: object session has a non-string member shadowed by a later string. JSON.parse collapses it before the schema runs; no previous malformed-store fixture covers that distinction.
- `env-loses-precedence`: sessions with both fixture env and stored values.
- `prototype-env-name-treated-as-ordinary`: the generated constructor-provider session must retain the reference's process-visible failure without executing a dynamic prototype value.
- `inherited-remove-treated-as-missing`: removing an inherited prototype name from an empty store succeeds in the reference's `name in current` policy; the smallest compatibility session covers that otherwise-unseen branch.
- `utf16-mask-uses-bytes`: sessions with non-ASCII synthetic values, beyond prior ASCII examples.
- `trim-removes-U0085`: generated boundary whitespace sessions distinguish JS trim from Go TrimSpace.
- `index-order-is-insertion`: numeric provider names in generated sessions check file bytes, not just parsed JSON.

No extra concrete domain rows are needed: seeded command sessions cover domain
behavior; a generated law checks the memory provider's otherwise-unused write.

## O2: repo (`bun parity/repo-mutants.ts`; every mutant runs, all failures are listed at the end)

Each repo mutant names the session that kills it. No earlier test reaches the
repo commands, so each session is the first guard of its seam.

- `sort-nan-moves-earlier` (aged): an unreadable lastAccessedAt keeps its place in the default sort, as the engine's comparator with NaN does.
- `collate-by-code-point` (aged): `--sort name` uses the reference's locale order for ASCII, not byte order.
- `format-bytes-ties-round-down` (aged): sizes print with toFixed's rounding at a tie.
- `pypi-double-equals-kept` (pypi-crates): `pypi:x==1.0` and `pypi:x=1.0` name the same version.
- `prune-window-ignored` (auto-prune): a fetch removes entries older than 30 days and names the count. The `aged` session cleaned the index before its fetch, so it never reached this branch; `auto-prune` fetches with 40- and 400-day entries still present.
- `json-first-member-wins` (file-shapes): a repeated key in metadata.json takes the last value, as JSON.parse does.
- `locate-ignores-case-folder` (case-folder): a GitHub spec finds an existing folder of another case spelling.
- `crates-without-user-agent` (pypi-crates): crates.io requests carry the User-Agent the fake requires.
- `failed-extract-keeps-folder` (npm): a tarball that tar refuses leaves no folder.
- `pinned-fetch-updates` (github-pinned): a pinned cached repo is not updated.
- `quote-drops-control-escape` (law LoadSeesSave on cachefile): control characters in generated names survive a save and load.

## O3: skills (`bun parity/skills-mutants.ts`; every mutant runs, all failures are listed at the end)

No earlier test reaches the skills commands. The three prompt mutants are
killed by the scripted-key tests in `ergo/cli/skills_add_test.ergo`; a process
case cannot reach them, because a process case has no terminal.

- `installed-choice-installs` (test AddMarksOnlyWhatIsNotInstalled): an installed skill marked in the multi-select is not installed again.
- `installed-not-labelled` (test AddMarksOnlyWhatIsNotInstalled): an installed option shows `(installed)`.
- `empty-answer-accepted` (test AddAsksAgainUntilOneIsChosen): an empty answer asks again while an option is not installed.
- `prompt-skipped` (local): several candidates never install silently; the reference's 130 case keeps the declared shape (status 1, nothing written).
- `dry-run-writes` (http): `update --dry-run` writes no skill files.
- `local-edit-overwritten` (http): a skill whose files changed since the last write is reported as modified, not overwritten, without `--force`.
- `kebab-drops-capitals` (local; frontmatter-42 at seed 42 reads no name with a description, so it misses this): front matter names map to the reference's kebab case, lower-cased first.
- `lock-drops-ref` (law LoadSeesSave on skillfile): a lock entry's ref survives a save and load.

## SHIP: the package launcher (`bun parity/launcher.ts --mutants`; no earlier probe ran the package layout)

- `arch-x64-as-arm64`, `arch-aarch64-unmapped`, `os-darwin-as-linux`: a supported `uname` pair runs another platform's binary.
- `link-unresolved`, `relative-link-from-cwd`: the npm (relative) or bun (absolute, then relative) link does not reach the package's `npm/` folder.
- `unsupported-arch-as-x64`, `unsupported-os-as-linux`: an unsupported platform runs a binary instead of the refusal line.
- `checkout-binary-ignored`: a source checkout's `bin/okra-ergo` is skipped for the package path.
- `impl-switch-kept`: `OKRA_IMPL=ts` still selects another program (the switch and the TypeScript CLI are gone; owner 2026-11-15).

The shim-*-to-ts mutants of `parity/switch.ts` (O1-O6) are gone with the switch: nothing can route to TypeScript, and `impl-switch-kept` holds that.

## Recorded references (`parity/frozen.ts`)

`bun parity/mutants.ts` (`--only=<name>` runs one):

- `frozen-unused-record-ignored`: a full run no longer fails on a record that no case reached. The guard adds one entry to a copy's `keys-42.json`, and the full run must fail with `records no case reached`.
- `frozen-missing-record-ignored`: a case with no record no longer fails. The guard removes `inherited-remove#0`, and that session must fail with `no frozen reference for`.

Both guards are checked on the real `frozen.ts` first. No other run edits the records, so nothing else reaches these checks.

- `umask-not-fixed`: `frozen.ts` no longer sets umask 022 for the suites, so a host with umask 002 fails every mode-bearing case. The guard runs repo session `empty` (it makes `.cache` folders) under umask 002. It must pass with the real `frozen.ts` and fail with `parity mismatch` without the umask line. Every earlier run used the host's 022, so none reached this.
