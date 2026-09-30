---
"@cvr/okra": patch
---

Counsel now fails when the other agent does not answer, even when that agent exits 0. A Codex usage limit (`turn.failed`) and a Claude API error (`is_error` result, such as a 529 overload or a usage limit) now give exit code 1, print the reason on stderr, and record it as `failure` in the run manifest. Before, counsel exited 0 with an empty `codex.md`, or wrote the Claude error text into `claude.md` as if it were the answer.
