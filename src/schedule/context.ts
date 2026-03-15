import { Effect, Option, Schema } from "effect";
import type { TaskContext } from "./services/Store.js";

const PrJson = Schema.Struct({
  number: Schema.optional(Schema.Number),
  url: Schema.optional(Schema.String),
});
const decodePrJson = Schema.decodeUnknownEffect(Schema.fromJsonString(PrJson));

const exec = (args: Array<string>, cwd: string): Effect.Effect<Option.Option<string>> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "ignore" });
      const code = await proc.exited;
      if (code !== 0) throw new Error(`exit ${code}`);
      const out = (await new Response(proc.stdout).text()).trim();
      return out.length > 0 ? Option.some(out) : Option.none();
    },
    catch: (): Option.Option<string> => Option.none(),
  }).pipe(Effect.catch(() => Effect.succeed(Option.none<string>())));

const parseRepoName = (remoteUrl: string): string | undefined => {
  const match = remoteUrl.match(/[:/]([^/]+?)(?:\.git)?$/);
  return match !== null ? match[1] : undefined;
};

const ISSUE_BRANCH_PATTERN = /(?:^|[/-])(\d{2,})(?:[/-]|$)/;

const parseIssueNumber = (branch: string): number | undefined => {
  const match = branch.match(ISSUE_BRANCH_PATTERN);
  if (match === null || match[1] === undefined) return undefined;
  const n = parseInt(match[1], 10);
  return n > 0 ? n : undefined;
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
  const gitRepo = gitRemoteUrl !== undefined ? parseRepoName(gitRemoteUrl) : undefined;
  const gitCommit = Option.getOrUndefined(commitOpt);
  const gitDefaultBranch = Option.getOrUndefined(defaultBranchOpt);
  const issueNumber = gitBranch !== undefined ? parseIssueNumber(gitBranch) : undefined;

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

export const buildPromptWithContext = (
  prompt: string,
  cwd: string,
  context: TaskContext | undefined,
): string => {
  if (context === undefined) return prompt;

  const lines: Array<string> = [];

  if (context.gitRepo !== undefined) {
    const repoLine =
      context.gitRemoteUrl !== undefined
        ? `${context.gitRepo} (${context.gitRemoteUrl})`
        : context.gitRepo;
    lines.push(`Repository: ${repoLine}`);
  }
  if (context.gitBranch !== undefined) lines.push(`Branch: ${context.gitBranch}`);
  if (context.gitDefaultBranch !== undefined)
    lines.push(`Default branch: ${context.gitDefaultBranch}`);
  if (context.gitCommit !== undefined) lines.push(`HEAD: ${context.gitCommit}`);
  if (context.prNumber !== undefined) {
    const prLine =
      context.prUrl !== undefined
        ? `#${String(context.prNumber)} (${context.prUrl})`
        : `#${String(context.prNumber)}`;
    lines.push(`PR: ${prLine}`);
  }
  if (context.issueNumber !== undefined) lines.push(`Issue: #${String(context.issueNumber)}`);
  lines.push(`Working directory: ${cwd}`);

  return `<context>\n${lines.join("\n")}\n</context>\n\n${prompt}`;
};
