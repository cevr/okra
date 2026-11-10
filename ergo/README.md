# Native pilot

Pin: `ergo-toolchain.json`. Layout: keys owns the Store contract, private entries,
JSON persistence and typed failures; keyfile implements Store over captured fs
capabilities; memory implements it over a sync.Ref. how is a pure immutable
catalogue. cli declares std flag command trees. Only cmd/okra chooses providers.

This is a new port from current main, informed by examples/okra-keys and okra-how
at ec6f1be2, not a blind copy: it uses CU1 trees, std json.Value, UTF-16 masking
and name sort, JavaScript trimming and JSON-string escaping. Guide assets come
from current registered topics during the build, not the older example snapshot.

Effect intent: a replaceable store with explicit failures and secret-safe output.
Context.Service/Layer become an operation type and root context; Schema classes
become checked records plus a codec boundary; tagged string errors become typed
alternatives and one total catch; CLI builders become std command data. The
original's wider temporary file permissions are not copied.

Repo (O2): the domain package repo owns specs (only Parse makes one from
text), the index with its Catalog contract and LoadSeesSave law, and the
JavaScript text rules the output depends on. cachefile implements Catalog over
metadata.json and owns the cache tree (removal through Go's os.RemoveAll, which
never follows a link out of the cache). gitexec runs git and registryhttp
fetches npm, PyPI and crates.io documents and tarballs, both through std
contracts (exec.Runner, http.Network) that only main binds. cli/repo.ergo runs
the five commands. cmd/okra-parity is a second entry that sends registry URLs
to one loopback fake and can reach no other origin.

Effect intent (repo): Context.Service layers become std contracts bound in main
and one Catalog operation type; Schema.Struct decoding becomes jsview, which
keeps Schema's rules (unknown keys ignored, optional means absent not null, the
last repeated key wins); RepoError's string code stays a record with the code,
because the code is the CLI's printed contract. Not copied: Effect.orDie on a
cache-folder read, and the temporary tarball file (tar reads standard input).

Skills (O3): the domain package skills owns sources, front matter, the lock
with its Locks contract and LoadSeesSave law, file hashing and the update
report. skillfile implements Locks over .skill-lock.json and owns the skills
folder. github reads GitHub over HTTP, or through gh when no token is set and
gh is signed in; the token is bound to the GitHub origins only. skillsh
searches skills.sh with no credential. cli/skills.ergo and skills_add.ergo run
list, search, add, remove and update; add's multi-select is std prompt's
MultiSelect machine on term.Terminal, so cli tests drive it with scripted keys.

Effect intent (skills): Prompt.MultiSelect becomes a prompt machine whose
NotInteractive and Cancelled failures sit in the row of the function that
asks, so a run without a person is a typed failure, not an interrupt. The
SkillsError tag becomes one Failed record with the printed code.

Image (O4): the domain package image owns the command, the route (Codex,
Generate or Edit, a union matched in full), option checks, media types, output
names and image dimensions, and the Failed record with the printed code.
imagehttp sends the OpenAI JSON and multipart requests and the Codex stream
request through http.Network, reads the Codex credentials file and ranks the
cached model catalogue. Only main chooses the origins (`Direct` or the
parity entry's `Offline`). Image bytes arrive as base64 in JSON or in a
finite stream, so no file download is needed.

Effect intent (image): the service layers become one Setup value and std
contracts bound in main; Schema decoding becomes jsview with Schema's rules;
the ImageError tag becomes image.Failed. Effect Schema's diagnostic text is
not copied (owner q100, `parity/declared-differences.md`).

Counsel (O5): counsel owns route/profile/invocation data, event interpretation
and the manifest codec. cli uses managed exec.Start with direct file sinks,
Wait inside the one-hour timeout, and consuming Stop in its catch. Shutdown
allows 15 seconds after TERM and records the actual trap/exit status. The
scope still owns the agent on every exit. No raw pid or detached kill fiber
is kept in application code. `parity/counsel-stream.ts` gates an injected
Scheduler on a fake agent's readiness FIFO, checks both partial files while
the child runs, then checks its TERM trap's status 37. The reference's sink
race may require a reference-only retry; a port run is never retried.

Build and routing: `parity/routing.md`. Run `bun parity/run.ts --record-check` for
two isolated TypeScript runs, or `bun parity/run.ts --seed=42` for TS/native
sessions. The reference always runs from current source with a network-denying
preload. Every case owns its fixture store; no real keys/tokens are read.
