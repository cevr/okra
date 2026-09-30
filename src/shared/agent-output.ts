import { Option, Schema } from "effect";

/**
 * What an agent run produced. Exit codes are not enough: a codex usage limit ends in `turn.failed`
 * and a claude API error in an `is_error` result, both with exit code 0.
 */
export type AgentOutcome =
  | { readonly _tag: "Answered"; readonly text: string }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Silent" };

const answered = (text: string): AgentOutcome => ({ _tag: "Answered", text });
const failed = (message: string): AgentOutcome => ({ _tag: "Failed", message });
const silent: AgentOutcome = { _tag: "Silent" };

const parseEvents = (jsonl: string): ReadonlyArray<unknown> => {
  if (jsonl.length === 0) return [];
  return Bun.JSONL.parse(jsonl) as ReadonlyArray<unknown>;
};

// --- Codex --json JSONL ---

const CodexItemCompletedEvent = Schema.Struct({
  type: Schema.Literal("item.completed"),
  item: Schema.Struct({
    type: Schema.Literal("agent_message"),
    text: Schema.String,
  }),
});
const decodeCodexItemCompleted = Schema.decodeUnknownOption(CodexItemCompletedEvent);

// Top-level `error` events are not terminal (codex also emits them for retries), and
// `item.completed` items of type `error` are warnings; only `turn.failed` ends the run.
const CodexTurnFailedEvent = Schema.Struct({
  type: Schema.Literal("turn.failed"),
  error: Schema.Struct({ message: Schema.String }),
});
const decodeCodexTurnFailed = Schema.decodeUnknownOption(CodexTurnFailedEvent);

/** The outcome of a codex `--json` run: its last agent message, or the `turn.failed` reason. */
export const readCodexOutcome = (jsonl: string): AgentOutcome => {
  let outcome: AgentOutcome = silent;
  for (const event of parseEvents(jsonl)) {
    const failure = decodeCodexTurnFailed(event);
    if (Option.isSome(failure)) return failed(failure.value.error.message);
    const message = decodeCodexItemCompleted(event);
    if (Option.isSome(message)) outcome = answered(message.value.item.text);
  }
  return outcome;
};

// --- Claude --output-format stream-json ---

const ClaudeResultEvent = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  is_error: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.String),
});
const decodeClaudeResult = Schema.decodeUnknownOption(ClaudeResultEvent);

const ClaudeInitEvent = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  model: Schema.String,
});
const decodeClaudeInit = Schema.decodeUnknownOption(ClaudeInitEvent);

/** The concrete model a claude stream-json run reports in its `init` event, e.g. `claude-opus-5-5`. */
export const readClaudeModel = (jsonl: string): Option.Option<string> => {
  for (const event of parseEvents(jsonl)) {
    const decoded = decodeClaudeInit(event);
    if (Option.isSome(decoded)) return Option.some(decoded.value.model);
  }
  return Option.none();
};

/**
 * The outcome of a claude stream-json run, from its `result` event. An API error (overload, usage
 * limit) still reports `subtype: "success"` but sets `is_error` and puts the error in `result`.
 */
export const readClaudeOutcome = (jsonl: string): AgentOutcome => {
  for (const event of parseEvents(jsonl)) {
    const decoded = decodeClaudeResult(event);
    if (Option.isNone(decoded)) continue;
    const { subtype, is_error: isError, result } = decoded.value;
    if (isError === true || subtype !== "success") return failed(result ?? subtype);
    return answered(result ?? "");
  }
  return silent;
};
