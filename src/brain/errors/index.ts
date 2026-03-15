import { Schema } from "effect";

export class BrainError extends Schema.TaggedErrorClass<BrainError>()(
  "@cvr/okra/brain/BrainError",
  {
    message: Schema.String,
    code: Schema.String,
  },
) {}

export class VaultError extends Schema.TaggedErrorClass<VaultError>()(
  "@cvr/okra/brain/VaultError",
  {
    message: Schema.String,
    path: Schema.optional(Schema.String),
    code: Schema.String,
  },
) {}

export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()(
  "@cvr/okra/brain/ConfigError",
  {
    message: Schema.String,
    code: Schema.String,
  },
) {}
