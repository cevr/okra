import { Schema } from "effect";

export class SkillsError extends Schema.TaggedErrorClass<SkillsError>()(
  "@cvr/okra/skills/SkillsError",
  {
    message: Schema.String,
    code: Schema.String,
  },
) {}

export const isSkillsError = (e: unknown): e is { _tag: string; code: string; message: string } => {
  if (typeof e !== "object" || e === null || !("_tag" in e)) return false;
  const tag = (e as { _tag: unknown })._tag;
  return tag === "@cvr/okra/skills/SkillsError";
};
