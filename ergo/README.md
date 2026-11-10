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

Build and routing: `parity/routing.md`. Run `bun parity/run.ts --record-check` for
two isolated TypeScript runs, or `bun parity/run.ts --seed=42` for TS/native
sessions. The reference always runs from current source with a network-denying
preload. Every case owns its fixture store; no real keys/tokens are read.
