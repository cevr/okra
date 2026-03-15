/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/strictBooleanExpressions:skip-file effect/tryCatchInEffectGen:skip-file effect/preferSchemaOverJson:skip-file effect/nodeBuiltinImport:off */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { BunServices } from "@effect/platform-bun";
import { utimesSync } from "node:fs";
import { extractConversations } from "../../../src/brain/commands/extract.js";
import { withTempDir } from "../helpers/index.js";

const TestLayer = BunServices.layer;

// Helper: create a JSONL file with lines
const writeJsonl = (fs: FileSystem, filePath: string, lines: Record<string, unknown>[]) =>
  fs.writeFileString(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

// Helper: build a standard user message line
const userMsg = (content: string | Array<{ type: string; text: string }>) => ({
  type: "user",
  message: { content },
});

// Helper: build a standard assistant message line
const assistantMsg = (content: string) => ({
  type: "assistant",
  message: { content },
});

// Thin wrapper around the real extractConversations
const runExtract = (
  inputDir: string,
  outputDir: string,
  opts: { batches?: number; from?: string; to?: string } = {},
) =>
  extractConversations(inputDir, outputDir, {
    batches: opts.batches,
    from: opts.from ? Option.some(opts.from) : Option.none(),
    to: opts.to ? Option.some(opts.to) : Option.none(),
  });

describe("extract", () => {
  describe("parsing", () => {
    it.live("parses string content messages", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          yield* writeJsonl(fs, `${inputDir}/conv1.jsonl`, [
            userMsg("This is a user message that is long enough to pass the filter"),
            assistantMsg("This is an assistant response that is long enough"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          const result = yield* runExtract(inputDir, outputDir);

          expect(result.conversations).toHaveLength(1);
          expect(result.conversations[0]!.messages[0]!.role).toBe("user");
          expect(result.conversations[0]!.messages[0]!.content).toContain("user message");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("parses content arrays [{type: 'text', text: '...'}]", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          yield* writeJsonl(fs, `${inputDir}/conv1.jsonl`, [
            userMsg([
              { type: "text", text: "Array content user message that is long enough to pass" },
            ]),
            assistantMsg("Assistant reply that is long enough to pass the filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          const result = yield* runExtract(inputDir, outputDir);

          expect(result.conversations).toHaveLength(1);
          expect(result.conversations[0]!.messages[0]!.content).toContain("Array content");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("parses codex response_item messages", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          yield* writeJsonl(fs, `${inputDir}/conv1.jsonl`, [
            {
              type: "session_meta",
              payload: { cwd: "/Users/cvr/Developer/personal/brain" },
            },
            {
              type: "response_item",
              payload: {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: "Codex user message that is long enough to pass the parser threshold",
                  },
                ],
              },
            },
            {
              type: "response_item",
              payload: {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "Codex assistant response that is also long enough to keep",
                  },
                ],
              },
            },
            {
              type: "event_msg",
              payload: { type: "task_started" },
            },
            { type: "padding", payload: { text: "x".repeat(500) } },
          ]);

          const result = yield* extractConversations(inputDir, outputDir, {
            provider: "codex",
          });

          expect(result.conversations).toHaveLength(1);
          expect(result.conversations[0]!.messages).toHaveLength(2);
          expect(result.conversations[0]!.messages[0]!.role).toBe("user");
          expect(result.conversations[0]!.messages[1]!.role).toBe("assistant");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("filtering", () => {
    it.live("skips system-reminder-only messages", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          yield* writeJsonl(fs, `${inputDir}/conv1.jsonl`, [
            userMsg(
              "<system-reminder>This is system reminder content that should be skipped entirely</system-reminder>",
            ),
            userMsg("Real user message that should definitely pass the length filter"),
            assistantMsg("Real assistant message that should definitely pass the length filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          const result = yield* runExtract(inputDir, outputDir);

          expect(result.conversations).toHaveLength(1);
          // System reminder skipped, only 2 messages remain
          expect(result.conversations[0]!.messages).toHaveLength(2);
          expect(result.conversations[0]!.messages[0]!.content).toContain("Real user");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("skips isMeta: true messages", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          yield* writeJsonl(fs, `${inputDir}/conv1.jsonl`, [
            {
              type: "user",
              isMeta: true,
              message: { content: "Meta message that should be skipped completely" },
            },
            userMsg("Real user message that should definitely pass the length filter"),
            assistantMsg("Real assistant message that should definitely pass the length filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          const result = yield* runExtract(inputDir, outputDir);

          expect(result.conversations[0]!.messages).toHaveLength(2);
          expect(result.conversations[0]!.messages[0]!.content).toContain("Real user");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("skips small files (<500 bytes)", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          // Tiny file — should be skipped
          yield* fs.writeFileString(
            `${inputDir}/tiny.jsonl`,
            '{"type":"user","message":{"content":"hi"}}\n',
          );

          // Big enough file
          yield* writeJsonl(fs, `${inputDir}/big.jsonl`, [
            userMsg("User message long enough to pass the content length filter check"),
            assistantMsg("Assistant message long enough to pass the content length filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          const result = yield* runExtract(inputDir, outputDir);

          expect(result.conversations).toHaveLength(1);
          expect(result.conversations[0]!.uuid).toBe("big");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("preserves messages with subType: thinking", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          yield* writeJsonl(fs, `${inputDir}/conv1.jsonl`, [
            userMsg("User message that is long enough to pass the content filter check"),
            {
              type: "assistant",
              subType: "thinking",
              message: { content: "Extended thinking content that is long enough to pass filter" },
            },
            assistantMsg("Assistant response that is long enough to pass the content filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          const result = yield* runExtract(inputDir, outputDir);

          expect(result.conversations).toHaveLength(1);
          // thinking message + user + assistant = 3 messages
          expect(result.conversations[0]!.messages).toHaveLength(3);
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("skips tool_use and tool_result subTypes", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          yield* writeJsonl(fs, `${inputDir}/conv1.jsonl`, [
            userMsg("User message that is long enough to pass the content filter check"),
            {
              type: "assistant",
              subType: "tool_use",
              message: { content: "Tool use content that should be filtered out entirely" },
            },
            {
              type: "user",
              subType: "tool_result",
              message: { content: "Tool result content that should be filtered out entirely" },
            },
            assistantMsg("Assistant response that is long enough to pass the content filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          const result = yield* runExtract(inputDir, outputDir);

          expect(result.conversations).toHaveLength(1);
          // Only user + assistant = 2 messages (tool_use and tool_result skipped)
          expect(result.conversations[0]!.messages).toHaveLength(2);
        }),
      ).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("date filtering", () => {
    it.live("--from filters out conversations before the date", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          const oldFile = path.join(inputDir, "old.jsonl");
          const newFile = path.join(inputDir, "new.jsonl");

          yield* writeJsonl(fs, oldFile, [
            userMsg("Old conversation that should be filtered out by date range"),
            assistantMsg("Old assistant response long enough to pass the content filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          yield* writeJsonl(fs, newFile, [
            userMsg("New conversation that should pass the date range filter check"),
            assistantMsg("New assistant response long enough to pass the content filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          // Set mtimes: old → 2024-01-01, new → 2024-06-01
          const oldDate = new Date("2024-01-01");
          const newDate = new Date("2024-06-01");
          yield* Effect.sync(() => {
            utimesSync(oldFile, oldDate, oldDate);
            utimesSync(newFile, newDate, newDate);
          });

          const result = yield* runExtract(inputDir, outputDir, { from: "2024-03-01" });

          expect(result.conversations).toHaveLength(1);
          expect(result.conversations[0]!.uuid).toBe("new");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("--to filters out conversations after the date", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          const oldFile = path.join(inputDir, "old.jsonl");
          const newFile = path.join(inputDir, "new.jsonl");

          yield* writeJsonl(fs, oldFile, [
            userMsg("Old conversation that should pass the date range filter check"),
            assistantMsg("Old assistant response long enough to pass the content filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          yield* writeJsonl(fs, newFile, [
            userMsg("New conversation that should be filtered out by date range"),
            assistantMsg("New assistant response long enough to pass the content filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          const oldDate = new Date("2024-01-01");
          const newDate = new Date("2024-06-01");
          yield* Effect.sync(() => {
            utimesSync(oldFile, oldDate, oldDate);
            utimesSync(newFile, newDate, newDate);
          });

          const result = yield* runExtract(inputDir, outputDir, { to: "2024-03-01" });

          expect(result.conversations).toHaveLength(1);
          expect(result.conversations[0]!.uuid).toBe("old");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("--from and --to together select a date range", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          const earlyFile = path.join(inputDir, "early.jsonl");
          const midFile = path.join(inputDir, "mid.jsonl");
          const lateFile = path.join(inputDir, "late.jsonl");

          for (const file of [earlyFile, midFile, lateFile]) {
            const label = path.basename(file).replace(".jsonl", "");
            yield* writeJsonl(fs, file, [
              userMsg(`${label} conversation message long enough to pass filter check`),
              assistantMsg(`${label} assistant response long enough to pass content filter`),
              { type: "padding", message: { content: "x".repeat(500) } },
            ]);
          }

          yield* Effect.sync(() => {
            utimesSync(earlyFile, new Date("2024-01-01"), new Date("2024-01-01"));
            utimesSync(midFile, new Date("2024-06-01"), new Date("2024-06-01"));
            utimesSync(lateFile, new Date("2024-12-01"), new Date("2024-12-01"));
          });

          const result = yield* runExtract(inputDir, outputDir, {
            from: "2024-03-01",
            to: "2024-09-01",
          });

          expect(result.conversations).toHaveLength(1);
          expect(result.conversations[0]!.uuid).toBe("mid");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("output", () => {
    it.live("sorts conversations newest-first", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          const oldFile = path.join(inputDir, "old.jsonl");
          const newFile = path.join(inputDir, "new.jsonl");

          yield* writeJsonl(fs, oldFile, [
            userMsg("Old conversation user message that is long enough to pass filter"),
            assistantMsg("Old conversation assistant message long enough to pass filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          yield* writeJsonl(fs, newFile, [
            userMsg("New conversation user message that is long enough to pass filter"),
            assistantMsg("New conversation assistant message long enough to pass filter"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          // Set explicit mtimes instead of relying on sleep
          yield* Effect.sync(() => {
            utimesSync(oldFile, new Date("2024-01-01"), new Date("2024-01-01"));
            utimesSync(newFile, new Date("2024-06-01"), new Date("2024-06-01"));
          });

          const result = yield* runExtract(inputDir, outputDir);

          expect(result.conversations).toHaveLength(2);
          // Newest first
          expect(result.conversations[0]!.uuid).toBe("new");
          expect(result.conversations[1]!.uuid).toBe("old");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("formats output as [USER]: / [ASSISTANT]:", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          yield* writeJsonl(fs, `${inputDir}/conv1.jsonl`, [
            userMsg("User says something interesting and long enough to pass"),
            assistantMsg("Assistant replies with something equally interesting and long"),
            { type: "padding", message: { content: "x".repeat(500) } },
          ]);

          yield* runExtract(inputDir, outputDir);

          const outFiles = yield* fs.readDirectory(outputDir);
          const txtFiles = outFiles.filter((f) => f.endsWith(".txt"));
          expect(txtFiles).toHaveLength(1);

          const content = yield* fs.readFileString(`${outputDir}/${txtFiles[0]}`);
          expect(content).toContain("[USER]: User says something");
          expect(content).toContain("[ASSISTANT]: Assistant replies");
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("creates batch manifests", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          // Create 4 conversations with explicit mtimes
          for (let i = 0; i < 4; i++) {
            const file = path.join(inputDir, `conv${i}.jsonl`);
            yield* writeJsonl(fs, file, [
              userMsg(`User message number ${i} that is long enough to pass the filter`),
              assistantMsg(`Assistant message number ${i} that is long enough to pass filter`),
              { type: "padding", message: { content: "x".repeat(500) } },
            ]);
            const date = new Date(`2024-0${i + 1}-01`);
            utimesSync(file, date, date);
          }

          const result = yield* runExtract(inputDir, outputDir, { batches: 2 });

          expect(result.batchPaths).toHaveLength(2);

          // Each batch manifest lists file paths
          const batch0 = yield* fs.readFileString(result.batchPaths[0]!);
          expect(batch0.trim().split("\n").length).toBe(2);
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.live("0 conversations produces empty batchPaths", () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const inputDir = `${dir}/input`;
          const outputDir = `${dir}/output`;
          yield* fs.makeDirectory(inputDir, { recursive: true });

          // No jsonl files at all
          const result = yield* runExtract(inputDir, outputDir);

          expect(result.conversations).toHaveLength(0);
          expect(result.writtenPaths).toHaveLength(0);
          expect(result.batchPaths).toHaveLength(0);
        }),
      ).pipe(Effect.provide(TestLayer)),
    );
  });
});
