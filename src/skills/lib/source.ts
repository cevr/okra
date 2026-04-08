// @effect-diagnostics effect/strictBooleanExpressions:off
export interface GitHubRepo {
  readonly _tag: "GitHubRepo";
  readonly owner: string;
  readonly repo: string;
  readonly ref?: string;
  readonly subpath?: string;
}

export interface GitHubRepoWithSkill {
  readonly _tag: "GitHubRepoWithSkill";
  readonly owner: string;
  readonly repo: string;
  readonly skillFilter: string;
}

export interface LocalPath {
  readonly _tag: "LocalPath";
  readonly path: string;
}

export interface SearchQuery {
  readonly _tag: "SearchQuery";
  readonly query: string;
}

export type ParsedSource = GitHubRepo | GitHubRepoWithSkill | LocalPath | SearchQuery;

const repoWithSkillRe = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)@(.+)$/;
// B3: Removed / from ref group so #ref/subpath parses correctly
const repoRe = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:#([a-zA-Z0-9_.+-]+))?(?:\/(.+))?$/;
const githubUrlRe = /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?(.*)$/;

export const parseSource = (input: string): ParsedSource => {
  if (input.startsWith(".") || input.startsWith("/") || input.startsWith("~")) {
    return { _tag: "LocalPath", path: input };
  }

  const skillMatch = input.match(repoWithSkillRe);
  if (skillMatch) {
    return {
      _tag: "GitHubRepoWithSkill",
      owner: skillMatch[1] ?? "",
      repo: skillMatch[2] ?? "",
      skillFilter: skillMatch[3] ?? "",
    };
  }

  const urlMatch = input.match(githubUrlRe);
  if (urlMatch) {
    const rest = urlMatch[3] ?? "";
    const treeBlobMatch = rest.match(/^(?:tree|blob)\/([^/]+)(?:\/(.+))?$/);
    if (treeBlobMatch) {
      return {
        _tag: "GitHubRepo",
        owner: urlMatch[1] ?? "",
        repo: urlMatch[2] ?? "",
        ref: treeBlobMatch[1],
        subpath: treeBlobMatch[2],
      };
    }
    return {
      _tag: "GitHubRepo",
      owner: urlMatch[1] ?? "",
      repo: urlMatch[2] ?? "",
    };
  }

  const repoMatch = input.match(repoRe);
  if (repoMatch) {
    return {
      _tag: "GitHubRepo",
      owner: repoMatch[1] ?? "",
      repo: repoMatch[2] ?? "",
      ref: repoMatch[3],
      subpath: repoMatch[4],
    };
  }

  return { _tag: "SearchQuery", query: input };
};
