# O1 mutant ledger

Public seams: current TypeScript versus native CLI session (streams, status and
fixture file bytes/mode), and operation laws over an in-memory provider. No real
key, token, HOME or paid peer is part of a test.

- `memory-save-drops-value`: Store.LoadSeesSave, not process parity (which binds keyfile).
- `key-domain-keeps-invalid-utf8`: Store.LoadSeesSave on the filesystem provider; generated source byte strings must enter the JSON-text domain through Unicode normalization. CLI argv fixtures are Unicode, so their sessions do not cover this.
- `codec-drops-other-provider`: seeded multi-step sessions preserve unrelated entries.
- `decode-validates-shadowed-value`: object session has a non-string member shadowed by a later string. JSON.parse collapses it before the schema runs; no previous malformed-store fixture covers that distinction.
- `env-loses-precedence`: sessions with both fixture env and stored values.
- `prototype-env-name-treated-as-ordinary`: the generated constructor-provider session must retain the reference's process-visible failure without executing a dynamic prototype value.
- `inherited-remove-treated-as-missing`: removing an inherited prototype name from an empty store succeeds in the reference's `name in current` policy; the smallest compatibility session covers that otherwise-unseen branch.
- `utf16-mask-uses-bytes`: sessions with non-ASCII synthetic values, beyond prior ASCII examples.
- `trim-removes-U0085`: generated boundary whitespace sessions distinguish JS trim from Go TrimSpace.
- `index-order-is-insertion`: numeric provider names in generated sessions check file bytes, not just parsed JSON.
- `shim-keys-to-ts`: inert-peer route check; domain parity alone does not execute the switch.

No extra concrete domain rows are needed: seeded command sessions cover domain
behavior; a generated law checks the memory provider's otherwise-unused write.
