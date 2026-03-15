import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { BrainError } from "../errors/index.js";
import { isAgentProviderId } from "../services/AgentPlatform.js";
import type { Provider } from "../../shared/provider.js";

const dirArg = Argument.string("dir").pipe(
  Argument.withDescription("Path to JSONL conversation directory"),
);
const outputFlag = Flag.string("output").pipe(
  Flag.withAlias("o"),
  Flag.withDescription("Output directory (required)"),
);
const batchesFlag = Flag.integer("batches").pipe(
  Flag.withDefault(3),
  Flag.withAlias("b"),
  Flag.withDescription("Number of batch manifests to create"),
);
const fromFlag = Flag.string("from").pipe(
  Flag.optional,
  Flag.withDescription("Include conversations modified on or after this date (YYYY-MM-DD)"),
);
const toFlag = Flag.string("to").pipe(
  Flag.optional,
  Flag.withDescription("Include conversations modified on or before this date (YYYY-MM-DD)"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));
const minSizeFlag = Flag.integer("min-size").pipe(
  Flag.withDefault(500),
  Flag.withDescription("Minimum file size in bytes to process (default: 500)"),
);
const verboseFlag = Flag.boolean("verbose").pipe(
  Flag.withAlias("v"),
  Flag.withDescription("Print per-conversation details to stderr"),
);

interface Message {
  readonly role: string;
  readonly content: string;
}

interface Conversation {
  readonly uuid: string;
  readonly messages: Message[];
  readonly modifiedAt: Date;
}

const providerFlag = Flag.string("provider").pipe(
  Flag.optional,
  Flag.withDescription("Conversation provider (claude or codex)"),
);

const detectProviderFromPath = (inputDir: string): Provider =>
  inputDir.includes("/.codex/") ? "codex" : "claude";

const parseClaudeMessage = (parsed: Record<string, unknown>): Message[] => {
  const msgType = parsed["type"];
  if (msgType !== "user" && msgType !== "assistant") return [];
  if (parsed["isMeta"] === true) return [];
  const subType = parsed["subType"];
  if (
    subType === "tool_use" ||
    subType === "tool_result" ||
    subType === "mcp_tool_use" ||
    subType === "mcp_tool_result"
  ) {
    return [];
  }

  const msg = parsed["message"];
  if (typeof msg !== "object" || msg === null) return [];
  const rawContent = (msg as Record<string, unknown>)["content"];
  const texts: string[] = [];

  if (typeof rawContent === "string") {
    texts.push(rawContent);
  } else if (Array.isArray(rawContent)) {
    for (const part of rawContent) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as Record<string, unknown>)["type"] === "text" &&
        typeof (part as Record<string, unknown>)["text"] === "string"
      ) {
        texts.push((part as { text: string }).text);
      }
    }
  }

  return texts
    .map((text) => text.trim())
    .filter((text) => text.length > 10)
    .filter(
      (text) => !(text.startsWith("<system-reminder>") && text.endsWith("</system-reminder>")),
    )
    .map((text) => ({
      role: msgType,
      content: text.slice(0, msgType === "user" ? 3000 : 800),
    }));
};

const parseCodexMessage = (parsed: Record<string, unknown>): Message[] => {
  if (parsed["type"] !== "response_item") return [];
  const payload = parsed["payload"];
  if (typeof payload !== "object" || payload === null) return [];
  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord["type"] !== "message") return [];

  const role = payloadRecord["role"];
  if (role !== "user" && role !== "assistant") return [];

  const content = payloadRecord["content"];
  if (!Array.isArray(content)) return [];

  const texts = content
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const text = record["text"];
      return typeof text === "string" ? [text] : [];
    })
    .map((text) => text.trim())
    .filter((text) => text.length > 10);

  return texts.map((text) => ({
    role,
    content: text.slice(0, role === "user" ? 3000 : 800),
  }));
};

const parseLine = (line: string): Option.Option<Record<string, unknown>> =>
  Option.liftThrowable(() => JSON.parse(line) as Record<string, unknown>)();

/** @internal */
export const extractConversations = Effect.fn("extractConversations")(function* (
  inputDir: string,
  outputDir: string,
  opts: {
    batches?: number;
    from?: Option.Option<string>;
    to?: Option.Option<string>;
    minSize?: number;
    provider?: Provider;
  } = {},
) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const provider = opts.provider ?? detectProviderFromPath(inputDir);

  const fromMs = Option.map(opts.from ?? Option.none(), (d) => new Date(d).getTime());
  const toMs = Option.map(opts.to ?? Option.none(), (d) => new Date(d).getTime() + 86400000 - 1);

  if (Option.isSome(fromMs) && Number.isNaN(fromMs.value)) {
    return yield* new BrainError({
      message: "Invalid --from date. Use YYYY-MM-DD format.",
      code: "INVALID_DATE",
    });
  }
  if (Option.isSome(toMs) && Number.isNaN(toMs.value)) {
    return yield* new BrainError({
      message: "Invalid --to date. Use YYYY-MM-DD format.",
      code: "INVALID_DATE",
    });
  }

  const files = yield* fs
    .readDirectory(inputDir)
    .pipe(
      Effect.mapError(
        (e: PlatformError) =>
          new BrainError({ message: `Cannot read ${inputDir}: ${e.message}`, code: "READ_FAILED" }),
      ),
    );

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort();

  const conversations: Conversation[] = [];

  for (const file of jsonlFiles) {
    const fullPath = path.join(inputDir, file);

    const stat = yield* fs
      .stat(fullPath)
      .pipe(
        Effect.mapError(
          (e: PlatformError) =>
            new BrainError({ message: `Cannot stat ${file}: ${e.message}`, code: "READ_FAILED" }),
        ),
      );

    // Skip directories (e.g. foo.jsonl/)
    if (stat.type !== "File") continue;

    // Skip small files
    if ((stat.size ?? 0) < (opts.minSize ?? 500)) continue;

    const mtime = stat.mtime ?? new Date(0);
    const mtimeMs = mtime.getTime();

    // Date filtering on file mtime
    if (Option.isSome(fromMs) && mtimeMs < fromMs.value) continue;
    if (Option.isSome(toMs) && mtimeMs > toMs.value) continue;

    const content = yield* fs
      .readFileString(fullPath)
      .pipe(
        Effect.mapError(
          (e: PlatformError) =>
            new BrainError({ message: `Cannot read ${file}: ${e.message}`, code: "READ_FAILED" }),
        ),
      );

    const lines = content.trim().split("\n");
    const messages: Message[] = [];

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const parsed = parseLine(line);
      if (Option.isNone(parsed)) continue;

      messages.push(
        ...(provider === "claude"
          ? parseClaudeMessage(parsed.value)
          : parseCodexMessage(parsed.value)),
      );
    }

    if (messages.length < 2) continue;

    const uuid = file.endsWith(".jsonl") ? file.slice(0, -6) : file;
    conversations.push({ uuid, messages, modifiedAt: mtime });
  }

  // Newest first (match brainmaxxing)
  conversations.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  yield* fs.makeDirectory(outputDir, { recursive: true }).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot create ${outputDir}: ${e.message}`,
          code: "WRITE_FAILED",
        }),
    ),
  );

  const writtenPaths: string[] = [];

  for (const [idx, conv] of conversations.entries()) {
    const outLines: string[] = [];
    for (const msg of conv.messages) {
      const tag = msg.role === "user" ? "[USER]:" : "[ASSISTANT]:";
      outLines.push(`${tag} ${msg.content}`);
    }
    const outFile = path.join(outputDir, `${String(idx).padStart(3, "0")}_${conv.uuid}.txt`);
    yield* fs.writeFileString(outFile, outLines.join("\n\n")).pipe(
      Effect.mapError(
        (e: PlatformError) =>
          new BrainError({
            message: `Cannot write ${outFile}: ${e.message}`,
            code: "WRITE_FAILED",
          }),
      ),
    );
    writtenPaths.push(outFile);
  }

  // Create batch manifests from written paths (no re-read of output dir)
  const batches = opts.batches ?? 3;
  const batchDir = path.join(outputDir, "batches");
  yield* fs.makeDirectory(batchDir, { recursive: true }).pipe(
    Effect.mapError(
      (e: PlatformError) =>
        new BrainError({
          message: `Cannot create ${batchDir}: ${e.message}`,
          code: "WRITE_FAILED",
        }),
    ),
  );

  const batchCount = Math.min(batches, Math.max(1, writtenPaths.length));
  const batchSize = Math.max(1, Math.ceil(writtenPaths.length / batchCount));

  const batchPaths: string[] = [];
  for (let b = 0; b < batchCount; b++) {
    const batchFiles = writtenPaths.slice(b * batchSize, (b + 1) * batchSize);
    if (batchFiles.length === 0) continue;
    const batchPath = path.join(batchDir, `batch_${b}.txt`);
    yield* fs
      .writeFileString(batchPath, batchFiles.join("\n") + "\n")
      .pipe(
        Effect.mapError(
          (e: PlatformError) =>
            new BrainError({ message: `Cannot write batch: ${e.message}`, code: "WRITE_FAILED" }),
        ),
      );
    batchPaths.push(batchPath);
  }

  return { conversations, writtenPaths, batchPaths };
});

export const extract = Command.make("extract", {
  dir: dirArg,
  output: outputFlag,
  batches: batchesFlag,
  from: fromFlag,
  to: toFlag,
  json: jsonFlag,
  minSize: minSizeFlag,
  provider: providerFlag,
  verbose: verboseFlag,
}).pipe(
  Command.withDescription("Extract conversations for ruminate"),
  Command.withHandler(
    ({ dir, output, batches, from: fromDate, to: toDate, json, minSize, provider, verbose }) =>
      Effect.gen(function* () {
        if (Option.isSome(provider) && !isAgentProviderId(provider.value)) {
          return yield* new BrainError({
            message: `Unknown provider "${provider.value}". Valid: claude, codex`,
            code: "UNSUPPORTED_PROVIDER",
          });
        }
        const selectedProvider = Option.map(provider, (value) => value as Provider);

        const result = yield* extractConversations(dir, output, {
          batches,
          from: fromDate,
          to: toDate,
          minSize,
          provider: Option.getOrUndefined(selectedProvider),
        });

        if (verbose) {
          for (const conv of result.conversations) {
            yield* Console.error(
              `  ${conv.uuid}: ${conv.messages.length} msgs, modified ${conv.modifiedAt.toISOString().slice(0, 10)}`,
            );
          }
        }

        if (json) {
          // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
          yield* Console.log(
            JSON.stringify({
              conversations: result.conversations.length,
              batches: result.batchPaths,
              output,
            }),
          );
        } else {
          yield* Console.error(`Extracted ${result.conversations.length} conversations`);
          for (const bp of result.batchPaths) {
            yield* Console.log(bp);
          }
        }
      }),
  ),
);
