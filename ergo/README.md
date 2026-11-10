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

Build and routing: `parity/routing.md`. Run `bun parity/run.ts --record-check` for
two isolated TypeScript runs, or `bun parity/run.ts --seed=42` for TS/native
sessions. The reference always runs from current source with a network-denying
preload. Every case owns its fixture store; no real keys/tokens are read.
