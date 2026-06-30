// The codex model layer is parameterized by the runtime `--model` flag, so it is
// composed and provided here (the command handler is this domain's entry point)
// rather than statically at the domain root.
/** @effect-diagnostics strictEffectProvide:off */
import { Console, Effect, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
  DEFAULT_FORMAT,
  DEFAULT_MODEL,
  DEFAULT_SIZE,
  IMAGE_BACKGROUND_CHOICES,
  IMAGE_QUALITY_CHOICES,
  isOpenAiImageModel,
  refMediaType,
} from "../constants.js";
import { ImageError } from "../errors.js";
import { CodexAuthService } from "../services/CodexAuth.js";
import { codexModelLayer } from "../services/CodexModel.js";
import {
  type ImageFormat,
  ImageGenService,
  type ImageQuality,
  type ReferenceImage,
} from "../services/ImageGen.js";
import { OpenAiImagesService } from "../services/OpenAiImages.js";

const promptArgument = Argument.string("prompt").pipe(
  Argument.withDescription("Text description of the image to generate"),
  Argument.optional,
);

const outFlag = Flag.string("out").pipe(
  Flag.withAlias("o"),
  Flag.optional,
  Flag.withDescription("Output file path (default: <slug>.<format> in the current directory)"),
);

const sizeFlag = Flag.string("size").pipe(
  Flag.withDefault(DEFAULT_SIZE),
  Flag.withDescription("Image size: auto or WIDTHxHEIGHT (e.g. 1024x1024)"),
);

const formatFlag = Flag.choice("format", ["png", "webp", "jpeg"]).pipe(
  Flag.withDefault(DEFAULT_FORMAT as ImageFormat),
  Flag.withDescription("Output image format"),
);

const modelFlag = Flag.string("model").pipe(
  Flag.withDefault(DEFAULT_MODEL),
  Flag.withDescription(
    "Model. Codex backend (default gpt-5.5), or an OpenAI image model " +
      "(gpt-image-1.5, gpt-image-1, gpt-image-1-mini, dall-e-3) which uses OPENAI_API_KEY.",
  ),
);

// The next three apply only to OpenAI image models; the codex backend ignores them.
const qualityFlag = Flag.choice("quality", IMAGE_QUALITY_CHOICES).pipe(
  Flag.optional,
  Flag.withDescription("Rendering quality (OpenAI image models): auto, low, medium, high"),
);

const backgroundFlag = Flag.choice("background", IMAGE_BACKGROUND_CHOICES).pipe(
  Flag.optional,
  Flag.withDescription("Background (OpenAI image models): auto, transparent, opaque"),
);

const countFlag = Flag.integer("n").pipe(
  Flag.optional,
  Flag.withDescription("Number of images to request (OpenAI image models); default 1"),
);

// Repeatable: each --ref is a style/composition reference image. Routed as input
// images to the codex backend (OpenAI image models have no input-image support).
const refFlag = Flag.string("ref").pipe(
  Flag.atLeast(0),
  Flag.withDescription(
    "Path to a reference image for style/composition (repeatable; codex backend only)",
  ),
);

interface GenerateArgs {
  readonly prompt: string;
  readonly model: string;
  readonly size: string;
  readonly format: ImageFormat;
  readonly quality: Option.Option<ImageQuality>;
  readonly background: Option.Option<"auto" | "transparent" | "opaque">;
  readonly n: Option.Option<number>;
  readonly refs: ReadonlyArray<ReferenceImage>;
}

/** Codex backend: eager auth check, then generate through a per-invocation model layer. */
const generateViaCodex = Effect.fn("image.generateViaCodex")(function* (args: GenerateArgs) {
  const images = yield* ImageGenService;
  const auth = yield* CodexAuthService;
  // Fail fast on missing/unreadable codex credentials, surfacing the precise
  // AUTH_MISSING error before the HTTP layer can box it into a transport error.
  yield* auth.load;
  return yield* images
    .generate({ prompt: args.prompt, size: args.size, format: args.format, refs: args.refs })
    .pipe(Effect.provide(codexModelLayer(args.model)));
});

/** Read each `--ref` path into bytes + sniff its media type from the extension. */
const readRefs = Effect.fn("image.readRefs")(function* (paths: ReadonlyArray<string>) {
  const fs = yield* FileSystem;
  const refs: ReferenceImage[] = [];
  for (const refPath of paths) {
    const mediaType = refMediaType(refPath);
    if (mediaType === undefined) {
      return yield* new ImageError({
        message: `Unsupported reference image type: ${refPath} (use png/jpg/jpeg/webp/gif).`,
        code: "INVALID_INPUT",
      });
    }
    const data = yield* fs.readFile(refPath).pipe(
      Effect.mapError(
        (e) =>
          new ImageError({
            message: `Cannot read --ref ${refPath}: ${e.message}`,
            code: "INVALID_INPUT",
          }),
      ),
    );
    refs.push({ data, mediaType });
  }
  return refs;
});

/** Metered OpenAI Images API path (GPT-image / DALL·E models). */
const generateViaOpenAi = Effect.fn("image.generateViaOpenAi")(function* (args: GenerateArgs) {
  const svc = yield* OpenAiImagesService;
  return yield* svc.generate({
    prompt: args.prompt,
    model: args.model,
    size: args.size,
    format: args.format,
    quality: Option.getOrUndefined(args.quality),
    background: Option.getOrUndefined(args.background),
    n: Option.getOrUndefined(args.n),
  });
});

/** Insert `-N` before the file extension: `out.png` → `out-1.png`, `out` → `out-1`. */
const suffixPath = (filePath: string, index: number): string => {
  const dot = filePath.lastIndexOf(".");
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  // Only treat a dot as an extension separator if it's in the final path segment.
  if (dot > slash) {
    return `${filePath.slice(0, dot)}-${index}${filePath.slice(dot)}`;
  }
  return `${filePath}-${index}`;
};

/** Slugify a prompt into a filesystem-safe base name, mirroring the reference tool. */
const slugify = (prompt: string): string => {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "image";
};

const generateCommand = Command.make(
  "image",
  {
    prompt: promptArgument,
    out: outFlag,
    size: sizeFlag,
    format: formatFlag,
    model: modelFlag,
    quality: qualityFlag,
    background: backgroundFlag,
    n: countFlag,
    ref: refFlag,
  },
  ({ prompt, out, size, format, model, quality, background, n, ref }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      if (Option.isNone(prompt)) {
        return yield* new ImageError({
          message: 'Missing prompt. Usage: okra image "<prompt>" [-o out].',
          code: "INVALID_INPUT",
        });
      }
      const promptText = prompt.value;

      const outPath = Option.getOrElse(out, () =>
        path.join(process.cwd(), `${slugify(promptText)}.${format}`),
      );

      // The model id selects the backend: GPT-image / DALL·E models go to the
      // metered OpenAI Images API; everything else goes through the codex backend.
      const useOpenAi = isOpenAiImageModel(model);
      const backend = useOpenAi ? `OpenAI (${model})` : "codex";

      // A reference image is a style/composition input. Only the codex backend
      // (Responses API input_image) supports it; the OpenAI Images generations
      // endpoint has no input-image field, so fail rather than drop the intent.
      if (useOpenAi && ref.length > 0) {
        return yield* new ImageError({
          message: `--ref (style reference) is not supported by OpenAI image models — use the codex backend (drop --model ${model}).`,
          code: "INVALID_INPUT",
        });
      }
      const refs = yield* readRefs(ref);

      // --quality/--background/--n only affect the OpenAI Images API; warn if set
      // for the codex backend rather than silently dropping them.
      if (!useOpenAi && (Option.isSome(quality) || Option.isSome(background) || Option.isSome(n))) {
        yield* Console.error(
          "Note: --quality/--background/--n apply only to OpenAI image models; ignored for codex.",
        );
      }

      // Progress goes to stderr; stdout is reserved for the saved path(s) only.
      const refNote = refs.length > 0 ? `, ${refs.length} ref${refs.length > 1 ? "s" : ""}` : "";
      yield* Console.error(`Generating image (${size}, ${format}${refNote}) via ${backend}…`);

      const args: GenerateArgs = {
        prompt: promptText,
        model,
        size,
        format,
        quality,
        background,
        n,
        refs,
      };
      // Both backends yield an array; codex always produces exactly one image.
      const images = useOpenAi ? yield* generateViaOpenAi(args) : [yield* generateViaCodex(args)];

      const dir = path.dirname(outPath);
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(
        Effect.mapError(
          (e) =>
            new ImageError({
              message: `Cannot create ${dir}: ${e.message}`,
              code: "WRITE_FAILED",
            }),
        ),
      );

      // With >1 image, suffix each file (`out-1.png`, `out-2.png`, …); a single
      // image keeps the bare path so the common case is unchanged. Pair each
      // image with its path so the writer never indexes into a parallel array.
      const single = images.length === 1;
      const outputs = images.map((bytes, i) => ({
        bytes,
        filePath: single ? outPath : suffixPath(outPath, i + 1),
      }));

      yield* Effect.forEach(outputs, ({ bytes, filePath }) =>
        fs.writeFile(filePath, bytes).pipe(
          Effect.mapError(
            (e) =>
              new ImageError({
                message: `Cannot write ${filePath}: ${e.message}`,
                code: "WRITE_FAILED",
              }),
          ),
        ),
      );

      // The saved path(s), one per line on stdout — safe for `$(okra image ...)` capture.
      yield* Console.log(outputs.map((o) => o.filePath).join("\n"));
    }),
).pipe(Command.withDescription("Generate an image from a prompt (codex or OpenAI image models)"));

// API-key storage moved to the top-level `okra keys` command (the key store is
// generic, not image-specific). `okra image` is now just the generate command.
export const imageCommandDef = generateCommand;
