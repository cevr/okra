import { Schema } from "effect";

export class SkillsError extends Schema.TaggedErrorClass<SkillsError>()(
  "@cvr/okra/skills/SkillsError",
  {
    message: Schema.String,
    code: Schema.String,
  },
) {}

export const isSkillsError = (e: unknown): e is { _tag: string; code: string; message: string } =>
  typeof e === "object" &&
  e !== null &&
  "_tag" in e &&
  (e as { _tag: string })._tag === "@cvr/okra/skills/SkillsError";
