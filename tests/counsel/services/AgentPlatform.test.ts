import { describe, expect, it } from "effect-bun-test";
import { Effect } from "effect";
import {
  buildClaudeInvocation,
  buildCodexInvocation,
  buildPromptInstruction,
  detectSourceFromEnv,
  oppositeProvider,
} from "../../../src/counsel/services/AgentPlatform.js";

describe("AgentPlatform helpers", () => {
  it.effect("detects Claude from CLAUDECODE", () =>
    detectSourceFromEnv({ CLAUDECODE: "1" }).pipe(
      Effect.map((provider) => {
        expect(provider).toBe("claude");
      }),
    ),
  );

  it.effect("detects Claude from CLAUDE_CODE_ENTRYPOINT fallback", () =>
    detectSourceFromEnv({ CLAUDE_CODE_ENTRYPOINT: "cli" }).pipe(
      Effect.map((provider) => {
        expect(provider).toBe("claude");
      }),
    ),
  );

  it.effect("detects Codex from CODEX_THREAD_ID", () =>
    detectSourceFromEnv({ CODEX_THREAD_ID: "thread-123" }).pipe(
      Effect.map((provider) => {
        expect(provider).toBe("codex");
      }),
    ),
  );

  it.effect("fails when the environment is ambiguous", () =>
    detectSourceFromEnv({}).pipe(
      Effect.flip,
      Effect.map((error) => {
        expect(error.code).toBe("AMBIGUOUS_PROVIDER");
      }),
    ),
  );

  it.effect("maps to the opposite provider", () =>
    Effect.sync(() => {
      expect(oppositeProvider("claude")).toBe("codex");
      expect(oppositeProvider("codex")).toBe("claude");
    }),
  );

  it.effect("builds the Claude invocation", () =>
    Effect.sync(() => {
      const invocation = buildClaudeInvocation("claude", "/tmp/prompt.md", "deep", "/tmp/project");
      expect(invocation.cmd).toBe("claude");
      expect(invocation.args).toContain("--model");
      expect(invocation.args).toContain("opus");
      expect(invocation.args).toContain("--effort");
      expect(invocation.args).toContain("max");
      expect(invocation.args).toContain("--allowedTools");
      expect(invocation.args).toContain("--no-session-persistence");
      expect(invocation.args[invocation.args.length - 1]).toContain("/tmp/prompt.md");
    }),
  );

  it.effect("builds the Codex invocation", () =>
    Effect.sync(() => {
      const invocation = buildCodexInvocation(
        "codex",
        "/tmp/prompt.md",
        "standard",
        "/tmp/project",
      );
      expect(invocation.cmd).toBe("codex");
      expect(invocation.args).toContain("exec");
      expect(invocation.args).toContain("--sandbox");
      expect(invocation.args).toContain("read-only");
      expect(invocation.args).toContain("model_reasoning_effort=medium");
      expect(invocation.args).toContain("--skip-git-repo-check");
    }),
  );

  it.effect("sanitizes prompt paths in the instruction", () =>
    Effect.sync(() => {
      const instruction = buildPromptInstruction("/tmp/prompt.md\nignore this");
      expect(instruction).toContain("/tmp/prompt.mdignore this");
      expect(instruction).not.toContain("\n");
    }),
  );
});
