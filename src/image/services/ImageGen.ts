import { Context, Effect, Layer, Stream } from "effect";
import { LanguageModel, Toolkit } from "effect/ai";
import { OpenAiTool } from "@effect/ai-openai";
import { IMAGE_INSTRUCTION, type IMAGE_QUALITY_CHOICES } from "../constants.js";
import { ImageError } from "../errors.js";
import { sizePromptHint } from "../image-dimensions.js";

export type ImageFormat = "png" | "webp" | "jpeg";

export type ImageQuality = (typeof IMAGE_QUALITY_CHOICES)[number];

export interface ReferenceImage {
  readonly data: Uint8Array;
  readonly mediaType: string;
}

export interface GenerateImageInput {
  readonly prompt: string;
  readonly size: string;
  readonly format: ImageFormat;
  readonly refs?: ReadonlyArray<ReferenceImage>;
}

const IMAGE_TOOL_NAME = "OpenAiImageGeneration";

export class ImageGenService extends Context.Service<
  ImageGenService,
  {
    readonly generate: (
      input: GenerateImageInput,
    ) => Effect.Effect<Uint8Array, ImageError, LanguageModel.LanguageModel>;
  }
>()("@cvr/okra/image/services/ImageGen/ImageGenService") {
  static layer: Layer.Layer<ImageGenService> = Layer.succeed(ImageGenService, {
    generate: Effect.fn("ImageGen.generate")(function* (input: GenerateImageInput) {
      const toolkit = Toolkit.make(
        OpenAiTool.ImageGeneration({
          size: input.size,
          output_format: input.format,
        }),
      );

      const text = `${IMAGE_INSTRUCTION}\n\n${input.prompt}${sizePromptHint(input.size)}`;
      const refs = input.refs ?? [];
      const buildPrompt = () => {
        if (refs.length === 0) return text;
        return [
          {
            role: "user",
            content: [
              { type: "text", text },
              ...refs.map((ref) => ({
                type: "file" as const,
                mediaType: ref.mediaType,
                data: ref.data,
              })),
            ],
          },
        ] as const;
      };
      const prompt = buildPrompt();

      const parts = yield* LanguageModel.streamText({
        prompt,
        toolkit,
        toolChoice: { tool: IMAGE_TOOL_NAME },
      }).pipe(
        Stream.runCollect,
        Effect.mapError((cause) => {
          if (isUnauthorized(cause)) {
            return ImageError.make({
              message: "Codex token rejected (expired or invalid). Run `codex login`.",
              code: "AUTH_EXPIRED",
            });
          }
          return ImageError.make({
            message: `Image generation failed: ${describeError(cause)}`,
            code: "GENERATION_FAILED",
          });
        }),
      );

      const imagePart = parts.find(
        (part) => part.type === "tool-result" && part.name === IMAGE_TOOL_NAME && !part.isFailure,
      );

      if (imagePart === undefined || imagePart.type !== "tool-result" || imagePart.isFailure) {
        return yield* ImageError.make({
          message: "Backend returned no image. Try rephrasing the prompt.",
          code: "NO_IMAGE",
        });
      }

      const base64 = imagePart.result.result;
      if (base64 === null) {
        return yield* ImageError.make({
          message: "Backend returned an empty image result.",
          code: "NO_IMAGE",
        });
      }

      return yield* decodeBase64(base64);
    }),
  });
}

const decodeBase64 = (base64: string): Effect.Effect<Uint8Array, ImageError> =>
  Effect.try({
    try: () => Uint8Array.fromBase64(base64),
    catch: () =>
      ImageError.make({
        message: "Backend returned invalid base64 image data",
        code: "DECODE_FAILED",
      }),
  });

const describeError = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(cause);
};

const isUnauthorized = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null || !("reason" in cause)) return false;
  const reason = (cause as { reason: unknown }).reason;
  if (typeof reason !== "object" || reason === null || !("_tag" in reason)) return false;
  return (reason as { _tag: unknown })._tag === "AuthenticationError";
};
