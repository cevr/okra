import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { extractCodexMessage, extractClaudeMessage } from "../../src/shared/agent-output.js";

describe("extractCodexMessage", () => {
  test("extracts agent message from complete JSONL", () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello world"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":50}}',
    ].join("\n");

    expect(extractCodexMessage(jsonl)).toEqual(Option.some("Hello world"));
  });

  test("returns last agent message when multiple exist", () => {
    const jsonl = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"First"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls","aggregated_output":"","exit_code":0,"status":"completed"}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Second"}}',
    ].join("\n");

    expect(extractCodexMessage(jsonl)).toEqual(Option.some("Second"));
  });

  test("returns none for empty input", () => {
    expect(extractCodexMessage("")).toEqual(Option.none());
  });

  test("returns none when no agent messages exist", () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"ls","aggregated_output":"","exit_code":0,"status":"completed"}}',
    ].join("\n");

    expect(extractCodexMessage(jsonl)).toEqual(Option.none());
  });

  test("ignores item.started events", () => {
    const jsonl = [
      '{"type":"item.started","item":{"id":"item_0","type":"agent_message","text":""}}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Final answer"}}',
    ].join("\n");

    expect(extractCodexMessage(jsonl)).toEqual(Option.some("Final answer"));
  });

  test("handles truncated JSONL gracefully", () => {
    const jsonl = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Partial result"}}',
      '{"type":"item.started","item":{"id":"item_1","type":"command_exec',
    ].join("\n");

    expect(extractCodexMessage(jsonl)).toEqual(Option.some("Partial result"));
  });

  test("handles non-matching event shapes", () => {
    const jsonl = [
      '{"type":"error","message":"something broke"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"thinking..."}}',
      "42",
      '"just a string"',
    ].join("\n");

    expect(extractCodexMessage(jsonl)).toEqual(Option.none());
  });
});

describe("extractClaudeMessage", () => {
  test("extracts result from success event", () => {
    const jsonl = [
      '{"type":"system","subtype":"init","session_id":"abc"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"2"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"2","session_id":"abc"}',
    ].join("\n");

    expect(extractClaudeMessage(jsonl)).toEqual(Option.some("2"));
  });

  test("returns none for empty input", () => {
    expect(extractClaudeMessage("")).toEqual(Option.none());
  });

  test("returns none when no result event exists", () => {
    const jsonl = [
      '{"type":"system","subtype":"init","session_id":"abc"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
    ].join("\n");

    expect(extractClaudeMessage(jsonl)).toEqual(Option.none());
  });

  test("ignores error results", () => {
    const jsonl = [
      '{"type":"result","subtype":"error","is_error":true,"result":"something failed"}',
    ].join("\n");

    expect(extractClaudeMessage(jsonl)).toEqual(Option.none());
  });

  test("handles truncated JSONL gracefully", () => {
    const jsonl = [
      '{"type":"result","subtype":"success","is_error":false,"result":"partial answer"}',
      '{"type":"rate_limit',
    ].join("\n");

    expect(extractClaudeMessage(jsonl)).toEqual(Option.some("partial answer"));
  });
});
