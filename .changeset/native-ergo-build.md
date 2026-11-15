---
"@cvr/okra": minor
---

`okra` is now a native binary built with [Ergo](https://github.com/cevr/ergo) instead of a Bun program. The package holds a small `sh` launcher and one binary per platform. It has no postinstall step and needs no Bun or Node to run.

What you will notice:

- Supported platforms are macOS and Linux on arm64 and x64. On any other platform the launcher prints one line and exits 1.
- Cancelling the `okra skills add` picker (Escape, Ctrl-C or Ctrl-D) exits with status 1 and prints `[CANCELLED] no skills chosen`. Before, it exited 130. With no terminal on standard input, it fails with `[NOT_INTERACTIVE]` and status 1.
- The `skills add` picker is a plain multi-select with no "Select All" entry. Skills that are already installed are shown as `name (installed)`.
- Help and usage-error text use a new layout. Failures still exit 1.
- `--wizard`, `--completions` and `--log-level` are gone.
