import { Option, Schema } from "effect";

// --- Codex --json JSONL extraction ---

const CodexAgentMessageItem = Schema.Struct({
  type: Schema.Literal("agent_message"),
  text: Schema.String,
});

const CodexItemCompletedEvent = Schema.Struct({
  type: Schema.Literal("item.completed"),
  item: CodexAgentMessageItem,
});

const decodeCodexItemCompleted = Schema.decodeUnknownOption(CodexItemCompletedEvent);

/** Extract the last agent message text from codex `--json` JSONL output. */
export const extractCodexMessage = (jsonl: string): Option.Option<string> => {
  if (jsonl.length === 0) return Option.none();

  const events = Bun.JSONL.parse(jsonl) as ReadonlyArray<unknown>;

  let lastMessage: Option.Option<string> = Option.none();
  for (const event of events) {
    const decoded = decodeCodexItemCompleted(event);
    if (Option.isSome(decoded)) {
      lastMessage = Option.some(decoded.value.item.text);
    }
  }

  return lastMessage;
};

// --- Claude --output-format stream-json extraction ---

const ClaudeResultEvent = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.Literal("success"),
  result: Schema.String,
});

const decodeClaudeResult = Schema.decodeUnknownOption(ClaudeResultEvent);

/** Extract the result text from claude `--output-format stream-json` JSONL output. */
export const extractClaudeMessage = (jsonl: string): Option.Option<string> => {
  if (jsonl.length === 0) return Option.none();

  const events = Bun.JSONL.parse(jsonl) as ReadonlyArray<unknown>;

  for (const event of events) {
    const decoded = decodeClaudeResult(event);
    if (Option.isSome(decoded)) {
      return Option.some(decoded.value.result);
    }
  }

  return Option.none();
};
