# Parity table

`bin/okra` execs `okra-ergo` for keys, how and repo (O2); all other subcommands
still exec `okra-ts`. `OKRA_IMPL=ts` or `OKRA_IMPL=ergo` explicitly selects either
sibling for all argv. Unknown override values fail with status 1. Effect-only
global flags and version use TS by default. A TS-only build falls back when the
native binary is absent; an explicit ergo override never falls back.

No installed link is changed. `scripts/build.ts` no longer links HOME/.bun/bin.
`bun run build` builds `okra-ts`; `ERGO=/path/to/pinned/ergo bun run build:ergo`
generates guide assets then builds `okra-ergo` and the offline `okra-ergo-parity`.
Publishing is not changed.

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
