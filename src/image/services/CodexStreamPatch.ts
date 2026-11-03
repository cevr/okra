import { Effect, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const STATUS_AI_OPENAI_STREAM_SCHEMA_ACCEPTS = `"status":"in_progress"`;
const CODEX_ONLY_GENERATING_STATUS = /"status"\s*:\s*"generating"/g;

export const makeCodexStatusTransform = (): TransformStream<Uint8Array, Uint8Array> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const rewriteWholeEvent = (event: string): string => {
    if (event.includes(`"generating"`))
      return event.replace(CODEX_ONLY_GENERATING_STATUS, STATUS_AI_OPENAI_STREAM_SCHEMA_ACCEPTS);
    return event;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const event = buffer.slice(0, sep + 2);
        buffer = buffer.slice(sep + 2);
        controller.enqueue(encoder.encode(rewriteWholeEvent(event)));
        sep = buffer.indexOf("\n\n");
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        controller.enqueue(encoder.encode(rewriteWholeEvent(buffer)));
        buffer = "";
      }
    },
  });
};

const patchUntypedSseResponse = (
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

export const withCodexStreamPatch = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
  HttpClient.transformResponse(client, Effect.map(patchUntypedSseResponse));
