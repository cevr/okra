import { Console, Effect, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { Argument, Command, Flag } from "effect/cli";
import {
  DEFAULT_FORMAT,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_SIZE,
  IMAGE_BACKGROUND_CHOICES,
  IMAGE_FIDELITY_CHOICES,
  IMAGE_QUALITY_CHOICES,
  isOpenAiImageModel,
  refMediaType,
  supportsEdits,
  supportsExtendedQuality,
  supportsInputFidelity,
} from "../constants.js";
import { isCodexModelRejection, resolveCodexSolCandidates } from "../../shared/codex-models.js";
import { ImageError } from "../errors.js";
import { parseSize, readImageDimensions } from "../image-dimensions.js";
import { CodexAuthService } from "../services/CodexAuth.js";
import { codexModelLayer } from "../services/CodexModel.js";
import {
  type ImageFormat,
  ImageGenService,
  type ImageQuality,
  type ReferenceImage,
} from "../services/ImageGen.js";
import { type ImagePart, OpenAiImagesService } from "../services/OpenAiImages.js";

const promptArgument = Argument.String("prompt").pipe(
  Argument.withDescription("Text description of the image to generate"),
  Argument.optional,
);

const outFlag = Flag.String("out").pipe(
  Flag.withAlias("o"),
  Flag.optional,
  Flag.withDescription("Output file path (default: <slug>.<format> in the current directory)"),
);

const sizeFlag = Flag.String("size").pipe(
  Flag.withDefault(DEFAULT_SIZE),
  Flag.withDescription("Image size: auto or WIDTHxHEIGHT (e.g. 1024x1024)"),
);

const formatFlag = Flag.Literals("format", ["png", "webp", "jpeg"]).pipe(
  Flag.withDefault(DEFAULT_FORMAT as ImageFormat),
  Flag.withDescription("Output image format"),
);

const modelFlag = Flag.String("model").pipe(
  Flag.optional,
  Flag.withDescription(
    "Model. Codex backend (default: the newest GPT Sol your codex account can use), or an OpenAI image model " +
      "(gpt-image-2.5-flare or gpt-image-2.5-sunburst) which uses OPENAI_API_KEY.",
  ),
);

const qualityFlag = Flag.Literals("quality", IMAGE_QUALITY_CHOICES).pipe(
  Flag.optional,
  Flag.withDescription(
    "Rendering quality (OpenAI image models): auto, low, medium, high; GPT Image 2.5 also supports xhigh, max",
  ),
);

const backgroundFlag = Flag.Literals("background", IMAGE_BACKGROUND_CHOICES).pipe(
  Flag.optional,
  Flag.withDescription("Background (OpenAI image models): auto, transparent, opaque"),
);

const countFlag = Flag.Int("n").pipe(
  Flag.optional,
  Flag.withDescription("Number of images to request (OpenAI image models); default 1"),
);

const refFlag = Flag.String("ref").pipe(
  Flag.atLeast(0),
  Flag.withDescription(
    "Path to a reference image. Codex: style/composition reference. " +
      "OpenAI image models: the source image to edit (repeatable).",
  ),
);

const editFlag = Flag.Boolean("edit").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Edit the --ref image(s) in place (OpenAI image models only)"),
);

const maskFlag = Flag.String("mask").pipe(
  Flag.optional,
  Flag.withDescription(
    "Path to a PNG mask; its transparent areas mark where to edit (OpenAI image models only)",
  ),
);

const fidelityFlag = Flag.Literals("fidelity", IMAGE_FIDELITY_CHOICES).pipe(
  Flag.optional,
  Flag.withDescription(
    "Edit fidelity to the source (gpt-image-1/1.5 edits only): high or low (default low)",
  ),
);

interface GenerateArgs {
  readonly prompt: string;
  readonly model: string;
  readonly codexModels: readonly [string, ...Array<string>];
  readonly size: string;
  readonly format: ImageFormat;
  readonly quality: Option.Option<ImageQuality>;
  readonly background: Option.Option<"auto" | "transparent" | "opaque">;
  readonly n: Option.Option<number>;
  readonly refs: ReadonlyArray<ReferenceImage>;
  readonly mask: Option.Option<ImagePart>;
  readonly fidelity: Option.Option<"high" | "low">;
}

const generateViaCodex = Effect.fn("image.generateViaCodex")(function* (args: GenerateArgs) {
  const images = yield* ImageGenService;
  const auth = yield* CodexAuthService;
  yield* auth.load;
  const generateWith = (model: string) =>
    images
      .generate({
        prompt: args.prompt,
        size: args.size,
        format: args.format,
        refs: args.refs,
      })
      .pipe(Effect.provide(codexModelLayer(model)));
  const [first, ...fallbacks] = args.codexModels;
  let attempt = generateWith(first);
  for (const model of fallbacks) {
    attempt = attempt.pipe(
      Effect.catchIf(
        (error) => isCodexModelRejection(error.message),
        () => generateWith(model),
      ),
    );
  }
  const image = yield* attempt;
  yield* warnOnSizeMismatch(args.size, image);
  return image;
});

const warnOnSizeMismatch = Effect.fn("image.warnOnSizeMismatch")(function* (
  size: string,
  image: Uint8Array,
) {
  const requested = parseSize(size);
  const actual = readImageDimensions(image);
  if (Option.isNone(requested) || Option.isNone(actual)) return;
  const { width, height } = actual.value;
  if (width === requested.value.width && height === requested.value.height) return;
  yield* Console.error(
    `Note: codex returned ${width}x${height} for --size ${size}; the codex backend chooses the final size. Use an OpenAI image model (--model ${DEFAULT_IMAGE_MODEL}) for an exact size.`,
  );
});

const readImageFile = Effect.fn("image.readImageFile")(function* (filePath: string, flag: string) {
  const fs = yield* FileSystem;
  const mediaType = refMediaType(filePath);
  if (mediaType === undefined) {
    return yield* ImageError.make({
      message: `Unsupported ${flag} image type: ${filePath} (use png/jpg/jpeg/webp/gif).`,
      code: "INVALID_INPUT",
    });
  }
  const data = yield* fs.readFile(filePath).pipe(
    Effect.mapError((e) =>
      ImageError.make({
        message: `Cannot read ${flag} ${filePath}: ${e.message}`,
        code: "INVALID_INPUT",
      }),
    ),
  );
  return { data, mediaType } satisfies ImagePart;
});

const readRefs = Effect.fn("image.readRefs")(function* (paths: ReadonlyArray<string>) {
  const refs: ReferenceImage[] = [];
  for (const refPath of paths) {
    refs.push(yield* readImageFile(refPath, "--ref"));
  }
  return refs;
});

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

const editViaOpenAi = Effect.fn("image.editViaOpenAi")(function* (args: GenerateArgs) {
  const svc = yield* OpenAiImagesService;
  return yield* svc.edit({
    prompt: args.prompt,
    model: args.model,
    size: args.size,
    format: args.format,
    images: args.refs,
    mask: Option.getOrUndefined(args.mask),
    quality: Option.getOrUndefined(args.quality),
    background: Option.getOrUndefined(args.background),
    n: Option.getOrUndefined(args.n),
    inputFidelity: Option.getOrUndefined(args.fidelity),
  });
});

const suffixPath = (filePath: string, index: number): string => {
  const dot = filePath.lastIndexOf(".");
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (dot > slash) {
    return `${filePath.slice(0, dot)}-${index}${filePath.slice(dot)}`;
  }
  return `${filePath}-${index}`;
};

const slugify = (prompt: string): string => {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (slug.length > 0) return slug;
  return "image";
};

type Route = "codex" | "openai-generate" | "openai-edit";

interface RouteInput {
  readonly quality: Option.Option<ImageQuality>;
  readonly model: string;
  readonly refCount: number;
  readonly edit: boolean;
  readonly hasMask: boolean;
  readonly hasFidelity: boolean;
}

type RouteResult =
  | { readonly ok: true; readonly route: Route }
  | {
      readonly ok: false;
      readonly error: ImageError;
    };

const ok = (route: Route): RouteResult => ({ ok: true, route });
const bad = (message: string): RouteResult => ({
  ok: false,
  error: ImageError.make({ message, code: "INVALID_INPUT" }),
});

const editFlagName = (input: RouteInput): string => {
  if (input.edit) return "edit";
  if (input.hasMask) return "mask";
  return "fidelity";
};

const resolveRoute = (input: RouteInput): RouteResult => {
  const { model, refCount, edit, hasMask, hasFidelity } = input;
  const useOpenAi = isOpenAiImageModel(model);
  const wantsEdit = edit || hasMask;

  if (!useOpenAi) {
    if (wantsEdit || hasFidelity) {
      return bad(
        `--${editFlagName(input)} needs an OpenAI image model — pass --model ${DEFAULT_IMAGE_MODEL}.`,
      );
    }
    return ok("codex");
  }

  if (
    Option.isSome(input.quality) &&
    (input.quality.value === "xhigh" || input.quality.value === "max") &&
    !supportsExtendedQuality(model)
  ) {
    return bad(`--quality ${input.quality.value} needs a GPT Image 2.5 model.`);
  }

  if (wantsEdit || refCount > 0) {
    if (refCount === 0) {
      return bad(`--${editFlagName(input)} needs a source image — pass --ref <path> to edit.`);
    }
    if (!supportsEdits(model)) {
      return bad(
        `${model} cannot edit images — use a GPT image model (e.g. --model ${DEFAULT_IMAGE_MODEL}).`,
      );
    }
    if (hasFidelity && !supportsInputFidelity(model)) {
      return bad(`--fidelity is not supported by ${model} — use gpt-image-1 or gpt-image-1.5.`);
    }
    return ok("openai-edit");
  }

  if (hasFidelity) {
    return bad("--fidelity only applies when editing — pass --ref <path> to edit.");
  }
  return ok("openai-generate");
};

const backendLabel = (route: Route, model: string): string => {
  if (route === "openai-edit") return `OpenAI edit (${model})`;
  if (route === "openai-generate") return `OpenAI (${model})`;
  return "codex";
};

const refNoun = (editing: boolean): string => {
  if (editing) return "source";
  return "ref";
};

const progressVerb = (editing: boolean): string => {
  if (editing) return "Editing";
  return "Generating";
};

const describeRefCount = (refCount: number, editing: boolean): string => {
  if (refCount === 0) return "";
  const singular = refNoun(editing);
  if (refCount > 1) return `, ${refCount} ${singular}s`;
  return `, ${refCount} ${singular}`;
};

const progressLine = (
  route: Route,
  model: string,
  size: string,
  format: ImageFormat,
  refCount: number,
  mask: Option.Option<ImagePart>,
  fidelity: Option.Option<"high" | "low">,
): string => {
  const editing = route === "openai-edit";
  const refNote = describeRefCount(refCount, editing);
  const maskNote = Option.match(mask, { onNone: () => "", onSome: () => ", mask" });
  const fidelityNote = Option.match(fidelity, {
    onNone: () => "",
    onSome: (value) => `, ${value} fidelity`,
  });
  const verb = progressVerb(editing);
  return `${verb} image (${size}, ${format}${refNote}${maskNote}${fidelityNote}) via ${backendLabel(route, model)}…`;
};

const runRoute = Effect.fn("image.runRoute")(function* (route: Route, args: GenerateArgs) {
  if (route === "openai-edit") return yield* editViaOpenAi(args);
  if (route === "openai-generate") return yield* generateViaOpenAi(args);
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
    fidelity: fidelityFlag,
  },
  ({
    prompt,
    out,
    size,
    format,
    model: requestedModel,
    quality,
    background,
    n,
    ref,
    edit,
    mask,
    fidelity,
  }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      if (Option.isNone(prompt)) {
        return yield* ImageError.make({
          message: 'Missing prompt. Usage: okra image "<prompt>" [-o out].',
          code: "INVALID_INPUT",
        });
      }
      const promptText = prompt.value;
      const codexModels = yield* Option.match(requestedModel, {
        onNone: () => resolveCodexSolCandidates,
        onSome: (model) => Effect.succeed([model] as const),
      });
      const model = codexModels[0];

      const outPath = Option.getOrElse(out, () =>
        path.join(process.cwd(), `${slugify(promptText)}.${format}`),
      );

      const resolved = resolveRoute({
        model,
        quality,
        refCount: ref.length,
        edit,
        hasMask: Option.isSome(mask),
        hasFidelity: Option.isSome(fidelity),
      });
      if (!resolved.ok) return yield* resolved.error;
      const route = resolved.route;

      const refs = yield* readRefs(ref);
      let maskPart = Option.none<ImagePart>();
      if (Option.isSome(mask)) {
        maskPart = Option.some(yield* readImageFile(mask.value, "--mask"));
      }

      if (
        route === "codex" &&
        (Option.isSome(quality) || Option.isSome(background) || Option.isSome(n))
      ) {
        yield* Console.error(
          "Note: --quality/--background/--n apply only to OpenAI image models; ignored for codex.",
        );
      }

      yield* Console.error(
        progressLine(route, model, size, format, refs.length, maskPart, fidelity),
      );

      const args: GenerateArgs = {
        prompt: promptText,
        model,
        codexModels,
        size,
        format,
        quality,
        background,
        n,
        refs,
        mask: maskPart,
        fidelity,
      };
      const images = yield* runRoute(route, args);

      const dir = path.dirname(outPath);
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(
        Effect.mapError((e) =>
          ImageError.make({
            message: `Cannot create ${dir}: ${e.message}`,
            code: "WRITE_FAILED",
          }),
        ),
      );

      const single = images.length === 1;
      const outputs = images.map((bytes, i) => {
        if (single) return { bytes, filePath: outPath };
        return { bytes, filePath: suffixPath(outPath, i + 1) };
      });

      yield* Effect.forEach(outputs, ({ bytes, filePath }) =>
        fs.writeFile(filePath, bytes).pipe(
          Effect.mapError((e) =>
            ImageError.make({
              message: `Cannot write ${filePath}: ${e.message}`,
              code: "WRITE_FAILED",
            }),
          ),
        ),
      );

      yield* Console.log(outputs.map((o) => o.filePath).join("\n"));
    }),
).pipe(Command.withDescription("Generate an image from a prompt (codex or OpenAI image models)"));

export const imageCommandDef = generateCommand;
