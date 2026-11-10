# Mutant ledger

Public seams: current TypeScript versus native CLI session (streams, status and
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
- `shim-keys-to-ts`: inert-peer route check; domain parity alone does not execute the switch.

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
- `shim-repo-to-ts` (`bun parity/switch.ts --mutants`): repo routes to the native binary.
