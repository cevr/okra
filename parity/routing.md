# O1 parity table

`bin/okra` execs `okra-ergo` for keys and how; all other subcommands still exec
`okra-ts`. `OKRA_IMPL=ts` or `OKRA_IMPL=ergo` explicitly selects either sibling
for all argv. Unknown override values fail with status 1. Effect-only global
flags and version use TS by default. A TS-only build falls back when the native
binary is absent; an explicit ergo override never falls back.

No installed link is changed. `scripts/build.ts` no longer links HOME/.bun/bin.
`bun run build` builds `okra-ts`; `ERGO=/path/to/pinned/ergo bun run build:ergo`
generates guide assets then builds `okra-ergo`. Publishing is not changed.

## Limits

- Help and usage-error layout use std flag; failures keep status 1.
- Guides are generated from the registered current topics at build time, because
  the pinned compiler has no embed. The binary reads no guide folder at runtime.
  TS remains a build dependency until a later asset-embedding/compiler step.
- A key file is 0600 from its creation, not chmodded after a write. New key
  directories are private (0700), rather than the original umask-based mode.
- Filesystem failure reasons are native Go text; normal command/domain failures
  are compared byte for byte. Permission-denied paths are not yet in the corpus.
- No image, counsel or other paid/credentialed service has been invoked. All
  parity runs get an isolated HOME and explicit synthetic environment only.
- The reference's environment-name table inherits Object.prototype. `keys get`
  for prototype names (such as constructor) has a stable internal-error line.
  Native preserves those bytes with a typed failure rather than calling a
  dynamic non-string as configuration. This is compatibility, not a new API.
