import { Schema } from "effect";

export class RepoError extends Schema.TaggedErrorClass<RepoError>()("@cvr/okra/repo/RepoError", {
  message: Schema.String,
  code: Schema.String,
}) {}

export const isRepoError = (e: unknown): e is { _tag: string; code: string; message: string } => {
  if (typeof e !== "object" || e === null || !("_tag" in e)) return false;
  const tag = (e as { _tag: unknown })._tag;
  return tag === "@cvr/okra/repo/RepoError";
};
