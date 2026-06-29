import { Effect, Stream } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/**
 * The codex backend emits `image_generation_call` output items whose `status`
 * is `"generating"` during streaming. The `@effect/ai-openai` streaming schema
 * (`OpenAiSchema.ImageGenerationCall.status` → `MessageStatus`) only models
 * `"in_progress" | "completed" | "incomplete"`, so it hard-fails the SSE decode
 * with `Expected "in_progress" | "completed" | "incomplete", got "generating"`.
 *
 * Upstream's own generated schema (`Generated.ts:ImageGenToolCall`) DOES allow
 * `"generating"`, so the handwritten streaming schema is simply stricter than
 * the API. There is no public option to relax decoding, so we rewrite the
 * offending status to `"in_progress"` (a value the schema accepts and the
 * provider treats identically — the terminal image arrives on a later
 * `completed` event) before the bytes reach the decoder.
 *
 * The rewrite is done at SSE-event granularity: bytes are buffered until a
 * complete event (`\n\n`-delimited) is available, so a replacement never
 * straddles a chunk boundary.
 *
 * The codex backend returns the SSE stream WITHOUT a `content-type:
 * text/event-stream` header (it's `null`), so we cannot gate on content type.
 * This client is codex-only and every call streams, so we patch unconditionally;
 * the rewrite is a no-op on any body that lacks the offending status literal.
 */

const IN_PROGRESS = `"status":"in_progress"`;
// Tolerate insignificant whitespace the backend may include around the colon.
const GENERATING_RE = /"status"\s*:\s*"generating"/g;

/**
 * A TextEncoderStream-free transform that rewrites the codex image status per SSE
 * event. Exported for unit testing the chunk-boundary buffering.
 */
export const makeCodexStatusTransform = (): TransformStream<Uint8Array, Uint8Array> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const rewrite = (event: string): string =>
    // Fast path: skip the regex unless the literal substring is present.
    event.includes(`"generating"`) ? event.replace(GENERATING_RE, IN_PROGRESS) : event;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const event = buffer.slice(0, sep + 2);
        buffer = buffer.slice(sep + 2);
        controller.enqueue(encoder.encode(rewrite(event)));
        sep = buffer.indexOf("\n\n");
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        controller.enqueue(encoder.encode(rewrite(buffer)));
        buffer = "";
      }
    },
  });
};

/** Rebuilds a response with its body run through the status-rewrite transform. */
const patchResponse = (
  response: HttpClientResponse.HttpClientResponse,
): HttpClientResponse.HttpClientResponse => {
  const patchedBody = Stream.toReadableStream(response.stream).pipeThrough(
    makeCodexStatusTransform(),
  );
  const webResponse = new Response(patchedBody, {
    status: response.status,
    headers: response.headers,
  });
  return HttpClientResponse.fromWeb(response.request, webResponse);
};

/**
 * Wraps an `HttpClient` so codex SSE responses have their `image_generation_call`
 * status rewritten from `"generating"` to `"in_progress"` before decoding.
 */
export const withCodexStreamPatch = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
  HttpClient.transformResponse(client, Effect.map(patchResponse));
