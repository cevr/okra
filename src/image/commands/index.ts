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
  supportsEdits,
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
import { type ImagePart, OpenAiImagesService } from "../services/OpenAiImages.js";

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

// Repeatable: each --ref is a reference image. On codex it's a style/composition
// reference (Responses input_image); on an OpenAI image model it's the source
// image to edit (the /images/edits endpoint).
const refFlag = Flag.string("ref").pipe(
  Flag.atLeast(0),
  Flag.withDescription(
    "Path to a reference image. Codex: style/composition reference. " +
      "OpenAI image models: the source image to edit (repeatable).",
  ),
);

// Explicit opt-in to edit semantics. Requires an OpenAI image model + at least one
// --ref (the source). On OpenAI, --ref already routes to edits, so --edit is just a
// clarity flag; on codex it errors (codex has no pixel-edit primitive).
const editFlag = Flag.boolean("edit").pipe(
  Flag.withDescription("Edit the --ref image(s) in place (OpenAI image models only)"),
);

const maskFlag = Flag.string("mask").pipe(
  Flag.optional,
  Flag.withDescription(
    "Path to a PNG mask; its transparent areas mark where to edit (OpenAI image models only)",
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
  /** Present → route to the OpenAI `/images/edits` endpoint with these as source + mask. */
  readonly mask: Option.Option<ImagePart>;
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

/** Read a single image file into bytes + media type, mapping read/type errors to INVALID_INPUT. */
const readImageFile = Effect.fn("image.readImageFile")(function* (filePath: string, flag: string) {
  const fs = yield* FileSystem;
  const mediaType = refMediaType(filePath);
  if (mediaType === undefined) {
    return yield* new ImageError({
      message: `Unsupported ${flag} image type: ${filePath} (use png/jpg/jpeg/webp/gif).`,
      code: "INVALID_INPUT",
    });
  }
  const data = yield* fs.readFile(filePath).pipe(
    Effect.mapError(
      (e) =>
        new ImageError({
          message: `Cannot read ${flag} ${filePath}: ${e.message}`,
          code: "INVALID_INPUT",
        }),
    ),
  );
  return { data, mediaType } satisfies ImagePart;
});

/** Read each `--ref` path into bytes + sniff its media type from the extension. */
const readRefs = Effect.fn("image.readRefs")(function* (paths: ReadonlyArray<string>) {
  const refs: ReferenceImage[] = [];
  for (const refPath of paths) {
    refs.push(yield* readImageFile(refPath, "--ref"));
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

/** OpenAI `/images/edits` path: edit the --ref source image(s), optionally masked. */
const editViaOpenAi = Effect.fn("image.editViaOpenAi")(function* (args: GenerateArgs) {
  const svc = yield* OpenAiImagesService;
  return yield* svc.edit({
    prompt: args.prompt,
    model: args.model,
    size: args.size,
    format: args.format,
    // ReferenceImage and ImagePart are the same shape (data + mediaType).
    images: args.refs,
    mask: Option.getOrUndefined(args.mask),
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

/** Which backend/endpoint a request resolves to once flags are reconciled. */
type Route = "codex" | "openai-generate" | "openai-edit";

interface RouteInput {
  readonly model: string;
  readonly refCount: number;
  readonly edit: boolean;
  readonly hasMask: boolean;
}

/** Either a resolved route or the `ImageError` describing why the flags conflict. */
type RouteResult =
  | { readonly ok: true; readonly route: Route }
  | {
      readonly ok: false;
      readonly error: ImageError;
    };

const ok = (route: Route): RouteResult => ({ ok: true, route });
const bad = (message: string): RouteResult => ({
  ok: false,
  error: new ImageError({ message, code: "INVALID_INPUT" }),
});

/**
 * Resolve the route from the model + flags. Keeps all the edit/codex/mask
 * validation out of the command handler (which otherwise trips the complexity
 * ceiling).
 *
 * - codex + `--ref` → style reference (`codex`); codex + `--edit`/`--mask` → error.
 * - OpenAI + any input image (`--ref`/`--edit`/`--mask`) → `openai-edit`.
 * - OpenAI with no input image → `openai-generate`.
 */
const resolveRoute = (input: RouteInput): RouteResult => {
  const { model, refCount, edit, hasMask } = input;
  const useOpenAi = isOpenAiImageModel(model);
  const wantsEdit = edit || hasMask;

  if (!useOpenAi) {
    // Codex has no pixel-edit/mask primitive; point at an OpenAI image model.
    if (wantsEdit) {
      return bad(
        `--${edit ? "edit" : "mask"} needs an OpenAI image model — pass --model gpt-image-1.5.`,
      );
    }
    return ok("codex"); // --ref (if any) is a style reference on this path.
  }

  // OpenAI path: any input image means the edits endpoint.
  if (wantsEdit || refCount > 0) {
    if (refCount === 0) {
      return bad(`--${edit ? "edit" : "mask"} needs a source image — pass --ref <path> to edit.`);
    }
    if (!supportsEdits(model)) {
      return bad(
        `${model} cannot edit images — use a GPT image model (e.g. --model gpt-image-1.5).`,
      );
    }
    return ok("openai-edit");
  }
  return ok("openai-generate");
};

/** Human label for the resolved backend, e.g. "OpenAI edit (gpt-image-1.5)". */
const backendLabel = (route: Route, model: string): string => {
  if (route === "openai-edit") return `OpenAI edit (${model})`;
  if (route === "openai-generate") return `OpenAI (${model})`;
  return "codex";
};

/** Build the stderr progress line for a resolved request. */
const progressLine = (
  route: Route,
  model: string,
  size: string,
  format: ImageFormat,
  refCount: number,
  mask: Option.Option<ImagePart>,
): string => {
  const editing = route === "openai-edit";
  const noun = editing ? "source" : "ref";
  const refNote = refCount > 0 ? `, ${refCount} ${noun}${refCount > 1 ? "s" : ""}` : "";
  const maskNote = Option.isSome(mask) ? ", mask" : "";
  const verb = editing ? "Editing" : "Generating";
  return `${verb} image (${size}, ${format}${refNote}${maskNote}) via ${backendLabel(route, model)}…`;
};

/** Dispatch a resolved route to its backend; all yield an array of image bytes. */
const runRoute = Effect.fn("image.runRoute")(function* (route: Route, args: GenerateArgs) {
  if (route === "openai-edit") return yield* editViaOpenAi(args);
  if (route === "openai-generate") return yield* generateViaOpenAi(args);
  // Codex always produces exactly one image.
  return [yield* generateViaCodex(args)];
});

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
    edit: editFlag,
    mask: maskFlag,
  },
  ({ prompt, out, size, format, model, quality, background, n, ref, edit, mask }) =>
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

      // Reconcile model + flags into a single route (or a validation error).
      const resolved = resolveRoute({
        model,
        refCount: ref.length,
        edit,
        hasMask: Option.isSome(mask),
      });
      if (!resolved.ok) return yield* resolved.error;
      const route = resolved.route;

      const refs = yield* readRefs(ref);
      const maskPart = Option.isSome(mask)
        ? Option.some(yield* readImageFile(mask.value, "--mask"))
        : Option.none<ImagePart>();

      // --quality/--background/--n only affect the OpenAI Images API; warn if set
      // for the codex backend rather than silently dropping them.
      if (
        route === "codex" &&
        (Option.isSome(quality) || Option.isSome(background) || Option.isSome(n))
      ) {
        yield* Console.error(
          "Note: --quality/--background/--n apply only to OpenAI image models; ignored for codex.",
        );
      }

      // Progress goes to stderr; stdout is reserved for the saved path(s) only.
      yield* Console.error(progressLine(route, model, size, format, refs.length, maskPart));

      const args: GenerateArgs = {
        prompt: promptText,
        model,
        size,
        format,
        quality,
        background,
        n,
        refs,
        mask: maskPart,
      };
      const images = yield* runRoute(route, args);

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
