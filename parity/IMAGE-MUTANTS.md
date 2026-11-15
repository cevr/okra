# Image seams and mutants (O4)

Named before adding each guard. Earlier keys/repo/skills guards never call image.

| Mutant                           | Public guard                                                            | Misses                             |
| -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| image-command-absent             | recorded binary / native process parity                                 | live service drift                 |
| edit-auto-switches-paid          | codex edit/mask/fidelity refusal and zero requests                      | other CLI usage                    |
| edit-sends-json                  | multipart peer records scalar fields, file bytes, media types and names | wire boundary spelling             |
| generation-drops-count           | n=2/3 process cases compare request and all output files                | unbounded counts                   |
| codex-ignores-done-status        | generating then completed SSE returns only completed image              | live model quality                 |
| codex-takes-last-image           | two completed tool results keep the first, as reference                 | timing                             |
| credentials-use-store-first      | env/store precedence peer guard                                         | real keys (never read)             |
| codex-fallback-on-any-error      | model rejection retries, other error does not                           | real rollout                       |
| suffix-before-first-dot          | multi-image dotted/extensionless paths                                  | host path oddities                 |
| generation-allows-zero           | invalid count cases fail before a paid request                          | edit API validation (server-owned) |
| decoding-requires-padding        | unpadded base64 peer decodes as Bun does                                | malformed JSON diagnostics         |
| default-model-never-ranks        | fresh/stale/fetched model catalog cases                                 | live catalogs                      |
| output-printed-before-last-write | failed multi-output write keeps stdout empty                            | OS-specific errno text             |

Additional mutants, named before their guards:

- response-ignores-created: a missing-created reply is a schema failure, not an image.
- empty-env-used: Config.String treats an empty environment key as absent; the stored key wins.
- missing-home-reads-cwd: missing HOME refuses codex even with a fixture in cwd.

q100 cases (declared suffix, `declared-differences.md`), named before their guards:

- schema-suffix-undeclared: any other decode wording fails `missing-created`.
- transport-prefix-dropped: the OpenAI transport line keeps `Image generation failed (MODEL): ` (`transport`).
- codex-transport-is-openai: the Codex transport line keeps `Image generation failed: ` (`codex-transport`).
- unparsable-body-is-no-image: a body that is not JSON is a decode failure, not NO_IMAGE (`malformed-json`).
- sse-skips-bad-event: a stream event that is not JSON fails the run (`codex-malformed-sse`).

New generated process cases use a replayable seed and the TS binary as the
independent reference. They vary model route, text, ref count, options and image
count; the peer log compares semantic paid request fields, not multipart boundary
bytes or random session IDs. File snapshots compare all bytes and modes.
