# Declared differences

The parity bar is q95: `--json` and `--dry-run` output, failure lines and exit
status are byte-equal to the TypeScript reference. Repo and skills differences
are listed in `routing.md`. This file lists owner-approved exceptions to q95,
and the counsel differences that wait for the owner (marked so).

## Image (O4): decode and transport suffix (owner q100, 2026-11-10)

Owner decision q100 approves one narrow exception, option 2 of O4's
`blocked.md`. It is not TypeScript byte equality.

- Scope: the text after the failure prefix, when that text comes from Effect
  Schema, the JSON parser or the HTTP adapter. The port prints one wording:
  `response does not match the expected schema` when a response does not
  decode, and `request transport failed` when the request does not reach a
  response.
- Kept byte-equal: the `[CODE]`, the prefix text, the model, the path, every
  earlier line (progress), stdout, exit status 1, the files and the requests.
  Error detail that the server gives (`error.message`, Codex's detail, HTTP
  status texts) is never part of the exception.
- The prefixes are:
  - `[GENERATION_FAILED] OpenAI returned an unexpected response (MODEL): `
  - `[GENERATION_FAILED] Image generation failed (MODEL): ` (OpenAI transport;
    `Image edit failed` for an edit)
  - `[GENERATION_FAILED] Image generation failed: ` (Codex stream decode and
    transport)
- Example, a successful HTTP response with no `created` member:
  - reference: `... (gpt-image-2.5-flare): Missing key` and a second line
    `  at ["created"]`
  - port: `... (gpt-image-2.5-flare): response does not match the expected schema`
- Example, a refused connection:
  - reference: `... (gpt-image-2.5-flare): Transport error (POST https://api.openai.com/v1/images/generations)`
  - port: `... (gpt-image-2.5-flare): request transport failed`

Guard: `parity/image.ts` applies the exception only to the cases in its `q100`
table (`missing-created`, `malformed-json`, `transport`, `codex-malformed-sse`,
`codex-transport`). For those, the reference's stderr must hold the declared
prefix once and a non-empty suffix, and the port's stderr must be exactly the
reference's text up to and including the prefix, then the declared wording.
All other fields compare byte for byte. Every other case compares stderr byte
for byte. Mutants `schema-suffix-undeclared`, `transport-prefix-dropped` and
`codex-transport-is-openai` (`IMAGE-MUTANTS.md`) show that a different wording
or prefix fails.

## Counsel (O5): no streamed exec yet (waits for the owner, q1)

Status: not approved. `bin/okra` keeps sending `counsel` to `okra-ts`;
`OKRA_IMPL=ergo` selects the port. The pinned compiler has no streamed exec
(unit CU4, after batch 16), so the port runs each agent with the buffered
`exec.Runner.Run`. Each difference below comes only from that, and goes away
when the port moves to CU4's streams.

- While the agent runs, `events.jsonl` and `<agent>.stderr` do not exist yet.
  The reference writes them as the agent writes. The port writes them, whole,
  when the agent ends. After the run, the files hold the same bytes. The port
  holds the agent's output in memory until it ends.
- The reference forks its two file sinks and ends them when the agent exits,
  so it can lose the tail of the agent's output (measured: in record runs it
  lost whole files, more than ten times in a row for one case). The port never
  loses output. `parity/counsel.ts` reruns only the reference until its files
  are complete; a port run is never rerun.
- After one hour, the reference sends SIGTERM, then SIGKILL after 15 s, and
  records the exit code that the agent then gives. The port's `exec.Run`
  sends SIGKILL to the agent's process group at once; the port records exit
  code 137 and writes the two files empty. The status (`timeout`), the failure
  line and exit status 124 are the same. No parity case runs for an hour; this
  is inferred from the source of both (`InvocationRunner.ts`,
  `runtime/v1/exec.go` at the pin).
- The port's `exec.Run` starts the agent in a process group of its own and
  kills what is left of that group when the agent exits. The reference leaves
  an agent's background children running. An interrupt of `okra counsel`
  sends SIGTERM to the agent in the reference; in the port the agent's group
  gets SIGKILL when the run is stopped. Not in the corpus (inferred from the
  source).

Everything else (dry-run JSON, the run folder's files and modes, the
manifest, stdout, failure lines, exit status and the agents' argv) is compared
byte for byte by `parity/counsel.ts`, with the slug, timestamp and duration
checked for form and then normalized.
