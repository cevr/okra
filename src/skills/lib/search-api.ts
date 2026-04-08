import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { SkillsError } from "../errors.js";

export class SearchSkill extends Schema.Class<SearchSkill>("SearchSkill")({
  id: Schema.String,
  skillId: Schema.String,
  name: Schema.String,
  installs: Schema.Number,
  source: Schema.String,
}) {}

export class SearchResponse extends Schema.Class<SearchResponse>("SearchResponse")({
  query: Schema.String,
  skills: Schema.Array(SearchSkill),
  count: Schema.Number,
}) {}

const SEARCH_URL = "https://skills.sh/api/search";

const decodeResponse = HttpClientResponse.schemaBodyJson(SearchResponse);

export const search = Effect.fn("searchSkills")(function* (query: string) {
  const client = yield* HttpClient.HttpClient;
  return yield* client
    .execute(HttpClientRequest.get(`${SEARCH_URL}?q=${encodeURIComponent(query)}`))
    .pipe(
      Effect.flatMap(decodeResponse),
      Effect.mapError(
        () => new SkillsError({ message: `Search failed for: ${query}`, code: "SEARCH_FAILED" }),
      ),
      Effect.withSpan("searchSkills", { attributes: { query } }),
    );
});
