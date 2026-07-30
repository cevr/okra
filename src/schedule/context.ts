import { Effect, Option, Schema, Stream } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import type { TaskContext } from "./services/Store.js";

const PrJson = Schema.Struct({
  number: Schema.optional(Schema.Finite),
  url: Schema.optional(Schema.String),
});
const decodePrJson = Schema.decodeUnknownEffect(Schema.fromJsonString(PrJson));

const exec = Effect.fn("captureContext.exec")(
  function* (args: Array<string>, cwd: string) {
    const spawner = yield* ChildProcessSpawner;
    const command = ChildProcess.make(args[0] ?? "", args.slice(1), {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });

    const handle = yield* spawner.spawn(command);
    const code = yield* handle.exitCode;
    if (code !== 0) return Option.none<string>();
    const text = yield* Stream.mkString(Stream.decodeText(handle.stdout));
    const out = text.trim();
    if (out.length === 0) return Option.none<string>();
    return Option.some(out);
  },
  Effect.scoped,
  Effect.orElseSucceed(() => Option.none<string>()),
);

/** Applies `f` only when the input is present, keeping `undefined` end-to-end. */
const mapDefined = <A, B>(value: A | undefined, f: (a: A) => B | undefined): B | undefined => {
  if (value === undefined) return undefined;
  return f(value);
};

const parseRepoName = (remoteUrl: string): string | undefined => {
  const match = remoteUrl.match(/[:/]([^/]+?)(?:\.git)?$/);
  if (match === null) return undefined;
  return match[1];
};

const ISSUE_BRANCH_PATTERN = /(?:^|[/-])(\d{2,})(?:[/-]|$)/;

const parseIssueNumber = (branch: string): number | undefined => {
  const match = branch.match(ISSUE_BRANCH_PATTERN);
  if (match === null || match[1] === undefined) return undefined;
  const n = parseInt(match[1], 10);
  if (n <= 0) return undefined;
  return n;
};

export const captureContext = Effect.fn("captureContext")(function* (cwd: string) {
  const [branchOpt, remoteOpt, commitOpt, defaultBranchOpt, prJsonOpt] = yield* Effect.all(
    [
      exec(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd),
      exec(["git", "remote", "get-url", "origin"], cwd),
      exec(["git", "rev-parse", "--short", "HEAD"], cwd),
      exec(["git", "rev-parse", "--abbrev-ref", "origin/HEAD"], cwd).pipe(
        Effect.map(Option.map((s) => s.replace(/^origin\//, ""))),
      ),
      exec(["gh", "pr", "view", "--json", "number,url"], cwd),
    ],
    { concurrency: "unbounded" },
  );

  const gitBranch = Option.getOrUndefined(branchOpt);
  const gitRemoteUrl = Option.getOrUndefined(remoteOpt);
  const gitRepo = mapDefined(gitRemoteUrl, parseRepoName);
  const gitCommit = Option.getOrUndefined(commitOpt);
  const gitDefaultBranch = Option.getOrUndefined(defaultBranchOpt);
  const issueNumber = mapDefined(gitBranch, parseIssueNumber);

  let prNumber: number | undefined;
  let prUrl: string | undefined;
  if (Option.isSome(prJsonOpt)) {
    const parsed = yield* decodePrJson(prJsonOpt.value).pipe(Effect.option);
    if (Option.isSome(parsed)) {
      prNumber = parsed.value.number;
      prUrl = parsed.value.url;
    }
  }

  const hasAny =
    gitBranch !== undefined ||
    gitRemoteUrl !== undefined ||
    prNumber !== undefined ||
    gitCommit !== undefined;

  if (!hasAny) return undefined;

  return {
    gitBranch,
    gitRemoteUrl,
    gitRepo,
    gitCommit,
    gitDefaultBranch,
    prNumber,
    prUrl,
    issueNumber,
  } satisfies TaskContext;
});

/** Renders "base (detail)" when a detail is present, or just "base" when it is not. */
const withParenthetical = (base: string, detail: string | undefined): string => {
  if (detail === undefined) return base;
  return `${base} (${detail})`;
};

export const buildPromptWithContext = (
  prompt: string,
  cwd: string,
  context: TaskContext | undefined,
): string => {
  if (context === undefined) return prompt;

  const lines: Array<string> = [];

  if (context.gitRepo !== undefined) {
    lines.push(`Repository: ${withParenthetical(context.gitRepo, context.gitRemoteUrl)}`);
  }
  if (context.gitBranch !== undefined) lines.push(`Branch: ${context.gitBranch}`);
  if (context.gitDefaultBranch !== undefined)
    lines.push(`Default branch: ${context.gitDefaultBranch}`);
  if (context.gitCommit !== undefined) lines.push(`HEAD: ${context.gitCommit}`);
  if (context.prNumber !== undefined) {
    lines.push(`PR: ${withParenthetical(`#${String(context.prNumber)}`, context.prUrl)}`);
  }
  if (context.issueNumber !== undefined) lines.push(`Issue: #${String(context.issueNumber)}`);
  lines.push(`Working directory: ${cwd}`);

  return `<context>\n${lines.join("\n")}\n</context>\n\n${prompt}`;
};
