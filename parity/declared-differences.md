# Declared differences

The parity bar is q95: `--json` and `--dry-run` output, failure lines and exit
status are byte-equal to the TypeScript reference. Repo and skills differences
are listed in `routing.md`. This file lists owner-approved exceptions to q95.

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
