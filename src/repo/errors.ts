import { Schema } from "effect";

export class RepoError extends Schema.TaggedErrorClass<RepoError>()("@cvr/okra/repo/RepoError", {
  message: Schema.String,
  code: Schema.String,
}) {}

export const isRepoError = (e: unknown): e is { _tag: string; code: string; message: string } =>
  typeof e === "object" &&
  e !== null &&
  "_tag" in e &&
  (e as { _tag: string })._tag === "@cvr/okra/repo/RepoError";
