import { Effect, Layer, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { describe, expect, it } from "effect-bun-test";
import { isImageError } from "../../src/image/errors.js";
import { ImageGenService } from "../../src/image/services/ImageGen.js";

const IMAGE_TOOL_NAME = "OpenAiImageGeneration";

// A 1x1 transparent PNG, base64-encoded — the smallest valid image payload.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Builds a mock LanguageModel layer whose stream emits the supplied parts. */
const mockModelLayer = (parts: ReadonlyArray<unknown>): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () => Effect.succeed(parts as never),
      streamText: () => Stream.fromIterable(parts as never),
    }),
  );

const imageToolResult = (result: unknown): unknown => ({
  type: "tool-result",
  id: "ig_test",
  name: IMAGE_TOOL_NAME,
  result,
  isFailure: false,
});

const run = <A, E>(
  effect: Effect.Effect<A, E, ImageGenService | LanguageModel.LanguageModel>,
  model: Layer.Layer<LanguageModel.LanguageModel>,
) => effect.pipe(Effect.provide(Layer.mergeAll(ImageGenService.layer, model)));

describe("ImageGenService.generate", () => {
  it.effect("decodes the base64 image from the tool-result part", () =>
    Effect.gen(function* () {
      const images = yield* ImageGenService;
      const bytes = yield* images.generate({ prompt: "a red dot", size: "auto", format: "png" });
      // PNG magic number: 0x89 0x50 0x4E 0x47.
      expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    }).pipe((self) => run(self, mockModelLayer([imageToolResult({ result: PNG_BASE64 })]))),
  );

  it.effect("fails NO_IMAGE when the image tool-result carries a null result", () =>
    Effect.gen(function* () {
      const images = yield* ImageGenService;
      const result = yield* Effect.flip(
        images.generate({ prompt: "x", size: "auto", format: "png" }),
      );
      expect(isImageError(result)).toBe(true);
      expect(result.code).toBe("NO_IMAGE");
    }).pipe((self) => run(self, mockModelLayer([imageToolResult({ result: null })]))),
  );

  it.effect("fails DECODE_FAILED on invalid base64", () =>
    Effect.gen(function* () {
      const images = yield* ImageGenService;
      const result = yield* Effect.flip(
        images.generate({ prompt: "x", size: "auto", format: "png" }),
      );
      expect(result.code).toBe("DECODE_FAILED");
    }).pipe((self) => run(self, mockModelLayer([imageToolResult({ result: "!!!not base64!!!" })]))),
  );
});
