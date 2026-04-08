import { describe, expect, test } from "effect-bun-test";
import { parseSource } from "../../../src/skills/lib/source.js";

describe("parseSource", () => {
  test("owner/repo → GitHubRepo", () => {
    const result = parseSource("vercel-labs/agent-skills");
    expect(result).toEqual({
      _tag: "GitHubRepo",
      owner: "vercel-labs",
      repo: "agent-skills",
      ref: undefined,
      subpath: undefined,
    });
  });

  test("owner/repo#ref → GitHubRepo with ref", () => {
    const result = parseSource("vercel-labs/agent-skills#v2");
    expect(result).toEqual({
      _tag: "GitHubRepo",
      owner: "vercel-labs",
      repo: "agent-skills",
      ref: "v2",
      subpath: undefined,
    });
  });

  test("owner/repo@skill → GitHubRepoWithSkill", () => {
    const result = parseSource("vercel-labs/agent-skills@vercel-react-best-practices");
    expect(result).toEqual({
      _tag: "GitHubRepoWithSkill",
      owner: "vercel-labs",
      repo: "agent-skills",
      skillFilter: "vercel-react-best-practices",
    });
  });

  test("GitHub URL → GitHubRepo", () => {
    const result = parseSource("https://github.com/vercel-labs/agent-skills");
    expect(result).toEqual({
      _tag: "GitHubRepo",
      owner: "vercel-labs",
      repo: "agent-skills",
    });
  });

  test("GitHub URL with tree/ref/path → GitHubRepo", () => {
    const result = parseSource(
      "https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices",
    );
    expect(result).toEqual({
      _tag: "GitHubRepo",
      owner: "vercel-labs",
      repo: "agent-skills",
      ref: "main",
      subpath: "skills/react-best-practices",
    });
  });

  test("plain text → SearchQuery", () => {
    const result = parseSource("react best practices");
    expect(result).toEqual({
      _tag: "SearchQuery",
      query: "react best practices",
    });
  });

  test("single word → SearchQuery", () => {
    const result = parseSource("testing");
    expect(result).toEqual({
      _tag: "SearchQuery",
      query: "testing",
    });
  });

  test(". → LocalPath", () => {
    const result = parseSource(".");
    expect(result).toEqual({ _tag: "LocalPath", path: "." });
  });

  test("./skills → LocalPath", () => {
    const result = parseSource("./skills");
    expect(result).toEqual({ _tag: "LocalPath", path: "./skills" });
  });

  test("/absolute/path → LocalPath", () => {
    const result = parseSource("/absolute/path");
    expect(result).toEqual({ _tag: "LocalPath", path: "/absolute/path" });
  });

  test("~/path → LocalPath", () => {
    const result = parseSource("~/projects/my-skill");
    expect(result).toEqual({ _tag: "LocalPath", path: "~/projects/my-skill" });
  });

  // B3: ref/subpath parsing
  test("owner/repo#ref/subpath → ref stops at /", () => {
    const result = parseSource("owner/repo#main/skills/foo");
    expect(result).toEqual({
      _tag: "GitHubRepo",
      owner: "owner",
      repo: "repo",
      ref: "main",
      subpath: "skills/foo",
    });
  });

  test("owner/repo#v2.0 → ref with dots, no subpath", () => {
    const result = parseSource("owner/repo#v2.0");
    expect(result).toEqual({
      _tag: "GitHubRepo",
      owner: "owner",
      repo: "repo",
      ref: "v2.0",
      subpath: undefined,
    });
  });

  test("owner/repo/subpath → no ref, just subpath", () => {
    const result = parseSource("owner/repo/skills/react");
    expect(result).toEqual({
      _tag: "GitHubRepo",
      owner: "owner",
      repo: "repo",
      ref: undefined,
      subpath: "skills/react",
    });
  });
});
