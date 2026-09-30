---
"@cvr/okra": minor
---

Counsel now writes `manifest.json` into each run directory, with a new `model` field. It names the model that answered: the fallback model after a Codex model rejection, and the concrete Claude model behind the `opus` or `fable` alias. The manifest also carries the run `status` and, for a failed run, the `failure` reason. `--dry-run` shows the requested model in its invocation preview.
