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

/** A holder the capturing mock writes the streamText prompt into. */
interface PromptSink {
  value: unknown;
}

/** Like `mockModelLayer`, but records the `prompt` passed to streamText for assertions. */
const capturingModelLayer = (
  parts: ReadonlyArray<unknown>,
  sink: PromptSink,
): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () => Effect.succeed(parts as never),
      streamText: (options: { readonly prompt: unknown }) => {
        sink.value = options.prompt;
        return Stream.fromIterable(parts as never);
      },
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

  it.effect("sends a plain-string prompt when no refs are given", () => {
    const sink: PromptSink = { value: undefined };
    return Effect.gen(function* () {
      const images = yield* ImageGenService;
      yield* images.generate({ prompt: "a red dot", size: "auto", format: "png" });
      // Normalized to a single user message with one text part — no file parts.
      const parts = promptParts(sink.value);
      expect(parts.some((p) => p.type === "file")).toBe(false);
      expect(parts.some((p) => p.type === "text")).toBe(true);
    }).pipe((self) =>
      run(self, capturingModelLayer([imageToolResult({ result: PNG_BASE64 })], sink)),
    );
  });

  it.effect("attaches each ref as an image file part in the prompt", () => {
    const sink: PromptSink = { value: undefined };
    return Effect.gen(function* () {
      const images = yield* ImageGenService;
      yield* images.generate({
        prompt: "in this style",
        size: "auto",
        format: "png",
        refs: [
          { data: new Uint8Array([1, 2, 3, 4]), mediaType: "image/png" },
          { data: new Uint8Array([5, 6]), mediaType: "image/jpeg" },
        ],
      });
      const parts = promptParts(sink.value);
      const fileParts = parts.filter((p) => p.type === "file");
      expect(fileParts.length).toBe(2);
      expect(fileParts.map((p) => p.mediaType)).toEqual(["image/png", "image/jpeg"]);
      // The text part is still present alongside the references.
      expect(parts.some((p) => p.type === "text")).toBe(true);
    }).pipe((self) =>
      run(self, capturingModelLayer([imageToolResult({ result: PNG_BASE64 })], sink)),
    );
  });
});

/** Extract the content parts of the first message in a captured normalized prompt. */
const promptParts = (captured: unknown): ReadonlyArray<{ type: string; mediaType?: string }> => {
  const content = (
    captured as {
      content: ReadonlyArray<{ content: ReadonlyArray<{ type: string; mediaType?: string }> }>;
    }
  ).content;
  return content[0]?.content ?? [];
};
