import { describe, expect, test } from "bun:test";
import { readClaudeOutcome, readCodexOutcome } from "../../src/shared/agent-output.js";

describe("readCodexOutcome", () => {
  test("answers with the agent message from complete JSONL", () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello world"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":50}}',
    ].join("\n");

    expect(readCodexOutcome(jsonl)).toEqual({ _tag: "Answered", text: "Hello world" });
  });

  test("answers with the last agent message when multiple exist", () => {
    const jsonl = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"First"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls","aggregated_output":"","exit_code":0,"status":"completed"}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Second"}}',
    ].join("\n");

    expect(readCodexOutcome(jsonl)).toEqual({ _tag: "Answered", text: "Second" });
  });

  test("fails with the turn.failed reason on a usage limit", () => {
    const limit =
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 28th, 2026 8:28 PM.";
    const jsonl = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I will read the prompt."}}',
      `{"type":"error","message":"${limit}"}`,
      `{"type":"turn.failed","error":{"message":"${limit}"}}`,
    ].join("\n");

    expect(readCodexOutcome(jsonl)).toEqual({ _tag: "Failed", message: limit });
  });

  test("treats warnings and top-level error events as non-terminal", () => {
    const jsonl = [
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Codex is ignoring 2 unrecognized configuration settings."}}',
      '{"type":"error","message":"stream disconnected; retrying"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Final answer"}}',
    ].join("\n");

    expect(readCodexOutcome(jsonl)).toEqual({ _tag: "Answered", text: "Final answer" });
  });

  test("is silent for empty input or no agent message", () => {
    expect(readCodexOutcome("")).toEqual({ _tag: "Silent" });
    const jsonl = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"thinking..."}}',
      "42",
      '"just a string"',
    ].join("\n");
    expect(readCodexOutcome(jsonl)).toEqual({ _tag: "Silent" });
  });

  test("ignores item.started events", () => {
    const jsonl = [
      '{"type":"item.started","item":{"id":"item_0","type":"agent_message","text":""}}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Final answer"}}',
    ].join("\n");

    expect(readCodexOutcome(jsonl)).toEqual({ _tag: "Answered", text: "Final answer" });
  });

  test("handles truncated JSONL gracefully", () => {
    const jsonl = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Partial result"}}',
      '{"type":"item.started","item":{"id":"item_1","type":"command_exec',
    ].join("\n");

    expect(readCodexOutcome(jsonl)).toEqual({ _tag: "Answered", text: "Partial result" });
  });
});

describe("readClaudeOutcome", () => {
  test("answers with the result of a success event", () => {
    const jsonl = [
      '{"type":"system","subtype":"init","session_id":"abc"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"2"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"2","session_id":"abc"}',
    ].join("\n");

    expect(readClaudeOutcome(jsonl)).toEqual({ _tag: "Answered", text: "2" });
  });

  test("fails on an API error that still reports subtype success", () => {
    const jsonl =
      '{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","api_error_status":529,"result":"API Error: 529 Overloaded."}';

    expect(readClaudeOutcome(jsonl)).toEqual({
      _tag: "Failed",
      message: "API Error: 529 Overloaded.",
    });
  });

  test("fails on an error subtype, using the subtype when there is no result", () => {
    expect(
      readClaudeOutcome('{"type":"result","subtype":"error","is_error":true,"result":"boom"}'),
    ).toEqual({ _tag: "Failed", message: "boom" });
    expect(readClaudeOutcome('{"type":"result","subtype":"error_max_turns"}')).toEqual({
      _tag: "Failed",
      message: "error_max_turns",
    });
  });

  test("is silent for empty input or no result event", () => {
    expect(readClaudeOutcome("")).toEqual({ _tag: "Silent" });
    const jsonl = [
      '{"type":"system","subtype":"init","session_id":"abc"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
    ].join("\n");
    expect(readClaudeOutcome(jsonl)).toEqual({ _tag: "Silent" });
  });

  test("handles truncated JSONL gracefully", () => {
    const jsonl = [
      '{"type":"result","subtype":"success","is_error":false,"result":"partial answer"}',
      '{"type":"rate_limit',
    ].join("\n");

    expect(readClaudeOutcome(jsonl)).toEqual({ _tag: "Answered", text: "partial answer" });
  });
});
