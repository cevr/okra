import { Effect } from "effect";
import { describe, expect, it } from "effect-bun-test";
import { makeCodexStatusTransform } from "../../src/image/services/CodexStreamPatch.js";

/** Feeds `input` through the transform in `chunkSize`-byte slices and returns the text output. */
const runTransform = (input: string, chunkSize: number): Effect.Effect<string> =>
  Effect.promise(() => {
    const bytes = new TextEncoder().encode(input);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.slice(i, i + chunkSize));
        }
        controller.close();
      },
    });
    // `Response.text()` drains the transformed stream without an async closure.
    return new Response(source.pipeThrough(makeCodexStatusTransform())).text();
  });

const imageEvent = (status: string, result: string) =>
  `data: {"type":"image_generation_call","status":"${status}","result":"${result}"}\n\n`;

describe("makeCodexStatusTransform", () => {
  it.effect("rewrites image_generation_call status 'generating' to 'in_progress'", () =>
    Effect.gen(function* () {
      const out = yield* runTransform(imageEvent("generating", "AAAA"), 4096);
      expect(out).not.toContain('"generating"');
      expect(out).toContain('"status":"in_progress"');
      expect(out).toContain('"result":"AAAA"');
    }),
  );

  it.effect("preserves the payload when split across tiny chunks mid-event", () =>
    Effect.gen(function* () {
      const big = "Q".repeat(200_000);
      const input =
        `data: {"type":"response.created","status":"in_progress"}\n\n` +
        imageEvent("generating", big) +
        `data: {"type":"response.completed","status":"completed"}\n\n`;
      // 1000-byte chunks force the huge event to span many reads.
      const out = yield* runTransform(input, 1000);
      expect(out).not.toContain('"generating"');
      expect(out).toContain(`"result":"${big}"`);
      expect(out.length).toBe(input.length + ("in_progress".length - "generating".length));
    }),
  );

  it.effect("leaves other statuses untouched", () =>
    Effect.gen(function* () {
      const input =
        `data: {"type":"response.output_item.added","status":"in_progress"}\n\n` +
        `data: {"type":"response.output_item.done","status":"completed"}\n\n`;
      const out = yield* runTransform(input, 16);
      expect(out).toBe(input);
    }),
  );

  it.effect("rewrites every occurrence across multiple events", () =>
    Effect.gen(function* () {
      const input = imageEvent("generating", "X") + imageEvent("generating", "Y");
      const out = yield* runTransform(input, 8);
      expect(out).not.toContain('"generating"');
      expect((out.match(/in_progress/g) ?? []).length).toBe(2);
    }),
  );
});
