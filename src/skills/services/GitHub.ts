import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import { Config, Effect, Layer, Option, Schema, Stream, Context, Path } from "effect";
import { SkillsError } from "../errors.js";
import { DEFAULT_REF, SKILL_DIR_PREFIXES } from "../lib/constants.js";

const GitHubContentEntrySchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  type: Schema.Literals(["file", "dir", "symlink", "submodule"]),
});

const GitHubContentsArraySchema = Schema.Array(GitHubContentEntrySchema);

type GitHubContentEntry = typeof GitHubContentEntrySchema.Type;

const GitHubTreeEntrySchema = Schema.Struct({
  path: Schema.String,
  type: Schema.Literals(["blob", "tree", "commit"]),
  sha: Schema.String,
  mode: Schema.String,
});

type GitHubTreeEntry = typeof GitHubTreeEntrySchema.Type;

type FetchBlob = (
  owner: string,
  repo: string,
  sha: string,
  path: string,
) => Effect.Effect<Uint8Array, SkillsError>;

const GitHubTreeResponseSchema = Schema.Struct({
  tree: Schema.Array(GitHubTreeEntrySchema),
  truncated: Schema.Boolean,
});

const decodeContents = HttpClientResponse.schemaBodyJson(GitHubContentsArraySchema);
const decodeContentsJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(GitHubContentsArraySchema),
);
const decodeTreeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(GitHubTreeResponseSchema));
const githubToken = Config.option(Config.String("GITHUB_TOKEN"));

export interface SkillFile {
  readonly path: string;
  readonly content: Uint8Array;
}

export interface SkillEntry {
  readonly dirName: string;
  readonly skillMdPath: string;
  readonly skillDir: string;
}

// E3: All effectful GitHub operations live in the service
export interface GitHubShape {
  readonly listContents: (
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ) => Effect.Effect<ReadonlyArray<GitHubContentEntry>, SkillsError>;
  readonly fetchRaw: (
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ) => Effect.Effect<Uint8Array, SkillsError>;
  readonly listTree: (
    owner: string,
    repo: string,
    ref: string,
  ) => Effect.Effect<
    {
      tree: ReadonlyArray<GitHubTreeEntry>;
      truncated: boolean;
    },
    SkillsError
  >;
  readonly discoverSkills: (
    owner: string,
    repo: string,
    ref?: string,
  ) => Effect.Effect<ReadonlyArray<SkillEntry>, SkillsError>;
  readonly fetchSkillDir: (
    owner: string,
    repo: string,
    dirPath: string,
    ref?: string,
  ) => Effect.Effect<ReadonlyArray<SkillFile>, SkillsError>;
}

interface GitHubCliShape extends GitHubShape {
  readonly run: (args: ReadonlyArray<string>) => Effect.Effect<Uint8Array, SkillsError>;
  readonly isAvailable: Effect.Effect<boolean, never>;
}

interface GitHubHttpShape extends GitHubShape {
  readonly hasExplicitToken: Effect.Effect<boolean, never>;
}

const causeSuffix = (cause?: unknown): string => {
  if (cause) return ` (${String(cause)})`;
  return "";
};

const fetchError = (url: string, cause?: unknown) =>
  SkillsError.make({
    message: `Failed to fetch: ${url}${causeSuffix(cause)}`,
    code: "FETCH_FAILED",
  });

const encodeRepoPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

// The contents API takes the repo root when no sub-path is given.
const pathSegment = (path: string): string => {
  if (path) return `/${encodeRepoPath(path)}`;
  return "";
};

const refQuery = (ref?: string): string => {
  if (ref) return `?ref=${encodeURIComponent(ref)}`;
  return "";
};

const contentsEndpoint = (owner: string, repo: string, path: string, ref?: string) =>
  `repos/${owner}/${repo}/contents${pathSegment(path)}${refQuery(ref)}`;

const treeEndpoint = (owner: string, repo: string, ref: string, recursive: boolean) => {
  const endpoint = `repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}`;
  if (recursive) return `${endpoint}?recursive=1`;
  return endpoint;
};

// GitHub caps recursive trees. Rebuild a complete tree from non-recursive
// subtree requests so discovery and link resolution never use a partial index.
const makeListTree = (
  fetchTree: (
    owner: string,
    repo: string,
    ref: string,
    recursive: boolean,
  ) => ReturnType<GitHubShape["listTree"]>,
): GitHubShape["listTree"] =>
  Effect.fn("GitHub.listTree")(function* (owner, repo, ref) {
    const result = yield* fetchTree(owner, repo, ref, true);
    if (!result.truncated) return result;
    const tree: Array<GitHubTreeEntry> = [];
    const walk = Effect.fn("GitHub.listSubtree")(function* (
      treeRef: string,
      prefix: string,
    ): Effect.fn.Return<void, SkillsError> {
      const subtree = yield* fetchTree(owner, repo, treeRef, false);
      if (subtree.truncated)
        return yield* fetchError(
          `github:${owner}/${repo}/${prefix}`,
          "Repository subtree is truncated",
        );
      for (const entry of subtree.tree) {
        const fullPath = `${prefix}${entry.path}`;
        tree.push({ ...entry, path: fullPath });
        if (entry.type === "tree") yield* walk(entry.sha, `${fullPath}/`);
      }
    });
    yield* walk(ref, "");
    return { tree, truncated: false };
  });

const skillEntryRank = (entry: SkillEntry): number => {
  const segments = entry.skillDir.split("/");
  const first = segments[0] ?? "";
  const second = segments[1] ?? "";
  if (first === "skills" || first === "skill") return 0;
  if (first === ".agents" && (second === "skills" || second === "skill")) return 1;
  return 2;
};

const skillPrefixRank = (entry: SkillEntry): number => {
  const segments = entry.skillDir.split("/");
  const index = SKILL_DIR_PREFIXES.findIndex((prefix) => segments.includes(prefix));
  if (index === -1) return SKILL_DIR_PREFIXES.length;
  return index;
};

const isPreferredSkillEntry = (candidate: SkillEntry, current: SkillEntry): boolean => {
  const prefixDifference = skillPrefixRank(candidate) - skillPrefixRank(current);
  if (prefixDifference !== 0) return prefixDifference < 0;

  const rankDifference = skillEntryRank(candidate) - skillEntryRank(current);
  if (rankDifference !== 0) return rankDifference < 0;

  const depthDifference = candidate.skillDir.split("/").length - current.skillDir.split("/").length;
  if (depthDifference !== 0) return depthDifference < 0;

  return candidate.skillDir < current.skillDir;
};

const dedupeSkillEntries = (
  entries: ReadonlyArray<SkillEntry>,
  symlinkPaths: ReadonlySet<string>,
): ReadonlyArray<SkillEntry> => {
  const usesSymlink = (entry: SkillEntry): boolean => {
    const parts = entry.skillMdPath.split("/");
    return parts.some((_, i) => symlinkPaths.has(parts.slice(0, i + 1).join("/")));
  };
  const byName = new Map<string, SkillEntry>();
  for (const entry of entries) {
    const current = byName.get(entry.dirName);
    if (
      !current ||
      (usesSymlink(current) && !usesSymlink(entry)) ||
      (usesSymlink(current) === usesSymlink(entry) && isPreferredSkillEntry(entry, current))
    ) {
      byName.set(entry.dirName, entry);
    }
  }
  return [...byName.values()];
};

// Prefer real copies before applying the established prefix/depth ranking.
/** @internal exported for testing */
export const discoverFromTree = (
  tree: ReadonlyArray<{ path: string; type: "blob" | "tree" | "commit"; mode?: string }>,
): ReadonlyArray<SkillEntry> => {
  const symlinkPaths = new Set(tree.filter((e) => e.mode === "120000").map((e) => e.path));
  const candidates = tree
    .filter((e) => e.type === "blob" && e.path.endsWith("/SKILL.md"))
    .map((entry) => {
      const skillDir = entry.path.slice(0, -"/SKILL.md".length);
      const dirName = skillDir.split("/").at(-1) ?? "unknown";
      return { dirName, skillMdPath: entry.path, skillDir };
    });
  const entries = dedupeSkillEntries(candidates, symlinkPaths);

  if (entries.length === 0) {
    if (tree.some((e) => e.type === "blob" && e.path === "SKILL.md")) {
      return [{ dirName: "", skillMdPath: "SKILL.md", skillDir: "" }];
    }
    return [];
  }

  for (const prefix of SKILL_DIR_PREFIXES) {
    const names = new Set(
      candidates
        .filter((entry) => entry.skillDir.split("/").includes(prefix))
        .map((entry) => entry.dirName),
    );
    if (names.size > 0) return entries.filter((entry) => names.has(entry.dirName));
  }
  return entries;
};

// Check if a directory listing contains skill subdirectories (dirs with SKILL.md)
const findSkillsInPrefix = (
  listContents: GitHubShape["listContents"],
  owner: string,
  repo: string,
  prefixPath: string,
  ref?: string,
): Effect.Effect<ReadonlyArray<SkillEntry>, SkillsError> =>
  Effect.gen(function* () {
    const entries = yield* listContents(owner, repo, prefixPath, ref).pipe(
      Effect.catchTag("@cvr/okra/skills/SkillsError", () =>
        Effect.succeed([] as ReadonlyArray<GitHubContentEntry>),
      ),
    );
    const dirs = entries.filter((entry) => entry.type === "dir");

    const results = yield* Effect.forEach(
      dirs,
      (dir) =>
        listContents(owner, repo, dir.path, ref).pipe(
          Effect.catchTag("@cvr/okra/skills/SkillsError", () =>
            Effect.succeed([] as ReadonlyArray<GitHubContentEntry>),
          ),
          Effect.map((children): ReadonlyArray<SkillEntry> => {
            if (children.some((child) => child.name === "SKILL.md")) {
              return [
                {
                  dirName: dir.name,
                  skillMdPath: `${dir.path}/SKILL.md`,
                  skillDir: dir.path,
                },
              ];
            }
            return [];
          }),
        ),
      { concurrency: "unbounded" },
    );

    return results.flat();
  });

// B6: Build discovery from N+1 listing (fallback when tree is truncated)
const discoverFromListing = Effect.fn("GitHub.discoverFromListing")(function* (
  listContents: GitHubShape["listContents"],
  owner: string,
  repo: string,
  ref?: string,
) {
  // 1. Check skills/ and skill/ at repo root
  for (const prefix of SKILL_DIR_PREFIXES) {
    const skills = yield* findSkillsInPrefix(listContents, owner, repo, prefix, ref);
    if (skills.length > 0) return skills;
  }

  // 2. Check root-level children for SKILL.md or nested skills/skill/ subdirs
  const rootEntries = yield* listContents(owner, repo, "", ref).pipe(
    Effect.catchTag("@cvr/okra/skills/SkillsError", () =>
      Effect.succeed([] as ReadonlyArray<GitHubContentEntry>),
    ),
  );

  const rootDirs = rootEntries.filter((entry) => entry.type === "dir");
  if (rootDirs.length > 0) {
    // Check each root dir for direct SKILL.md
    const directResults = yield* Effect.forEach(
      rootDirs,
      (dir) =>
        listContents(owner, repo, dir.path, ref).pipe(
          Effect.catchTag("@cvr/okra/skills/SkillsError", () =>
            Effect.succeed([] as ReadonlyArray<GitHubContentEntry>),
          ),
          Effect.map(
            (
              children,
            ): { dir: GitHubContentEntry; children: ReadonlyArray<GitHubContentEntry> } => ({
              dir,
              children,
            }),
          ),
        ),
      { concurrency: "unbounded" },
    );

    const directSkills: Array<SkillEntry> = [];
    for (const { dir, children } of directResults) {
      if (children.some((child) => child.name === "SKILL.md")) {
        directSkills.push({
          dirName: dir.name,
          skillMdPath: `${dir.path}/SKILL.md`,
          skillDir: dir.path,
        });
      }
    }
    if (directSkills.length > 0) return directSkills;

    // 3. Recurse up to 2 levels deep: look for skills/ or skill/ inside root dirs and their children
    //    Covers: plugins/skills/X, plugins/railway/skills/X, etc.
    const searchQueue: Array<{ path: string; children: ReadonlyArray<GitHubContentEntry> }> =
      directResults.map(({ dir, children }) => ({ path: dir.path, children }));

    for (let depth = 0; depth < 2; depth++) {
      const nextQueue: typeof searchQueue = [];
      for (const { children } of searchQueue) {
        for (const prefix of SKILL_DIR_PREFIXES) {
          const prefixChild = children.find((c) => c.name === prefix && c.type === "dir");
          if (!prefixChild) continue;
          const skills = yield* findSkillsInPrefix(
            listContents,
            owner,
            repo,
            prefixChild.path,
            ref,
          );
          if (skills.length > 0) return skills;
        }
        // Queue subdirs for next depth level
        if (depth < 1) {
          const subdirs = children.filter(
            (c) => c.type === "dir" && !(SKILL_DIR_PREFIXES as readonly string[]).includes(c.name),
          );
          for (const sub of subdirs) {
            const subChildren = yield* listContents(owner, repo, sub.path, ref).pipe(
              Effect.catchTag("@cvr/okra/skills/SkillsError", () =>
                Effect.succeed([] as ReadonlyArray<GitHubContentEntry>),
              ),
            );
            nextQueue.push({ path: sub.path, children: subChildren });
          }
        }
      }
      searchQueue.length = 0;
      searchQueue.push(...nextQueue);
    }
  }

  // 4. Check root SKILL.md (repo itself is a single skill)
  if (rootEntries.some((entry) => entry.name === "SKILL.md")) {
    return [{ dirName: repo, skillMdPath: "SKILL.md", skillDir: "" }];
  }

  return [] as ReadonlyArray<SkillEntry>;
});

// Shared implementation for discoverSkills using tree API with listing fallback
/** @internal exported for testing */
export const makeDiscoverSkills = (
  listContents: GitHubShape["listContents"],
  listTree: GitHubShape["listTree"],
): GitHubShape["discoverSkills"] =>
  Effect.fn("GitHub.discoverSkills")(function* (owner: string, repo: string, ref?: string) {
    const resolvedRef = ref ?? DEFAULT_REF;

    // P3: Try tree API first (single call)
    const treeResult = yield* listTree(owner, repo, resolvedRef).pipe(Effect.option);

    if (treeResult._tag === "Some" && !treeResult.value.truncated) {
      return discoverFromTree(treeResult.value.tree);
    }

    // Fallback to N+1 listing
    return yield* discoverFromListing(listContents, owner, repo, ref);
  });

// Resolve from git objects, not Contents listings: GitHub can dereference file
// symlinks there and report them as ordinary files. Blob SHAs retain link text.
const makeFetchSkillDir = (
  listTree: GitHubShape["listTree"],
  fetchBlob: FetchBlob,
  fetchRaw: GitHubShape["fetchRaw"],
): GitHubShape["fetchSkillDir"] =>
  Effect.fn("GitHub.fetchSkillDir")(function* (
    owner: string,
    repo: string,
    dirPath: string,
    ref = DEFAULT_REF,
  ) {
    const path = yield* Path.Path;
    const result = yield* listTree(owner, repo, ref);
    if (result.truncated) {
      return yield* fetchError(
        `github:${owner}/${repo}/${dirPath}`,
        "Repository tree is truncated",
      );
    }
    const entries = new Map(result.tree.map((entry) => [entry.path, entry]));
    const root: GitHubTreeEntry = { path: "", type: "tree", mode: "040000", sha: "" };
    entries.set("", root);
    const children = new Map<string, Array<GitHubTreeEntry>>();
    for (const entry of result.tree) {
      let parent = path.dirname(entry.path);
      if (parent === ".") parent = "";
      const siblings = children.get(parent) ?? [];
      siblings.push(entry);
      children.set(parent, siblings);
    }
    const invalidLink = (link: string, reason: string) =>
      SkillsError.make({ code: "INVALID_SYMLINK", message: `Invalid symlink ${link}: ${reason}` });

    const resolve = Effect.fn("GitHub.resolveSkillPath")(function* (
      repoPath: string,
      links: ReadonlySet<string> = new Set(),
      origin?: string,
    ): Effect.fn.Return<GitHubTreeEntry, SkillsError> {
      const parts = repoPath.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join("/");
        const entry = entries.get(prefix);
        if (entry?.mode !== "120000") continue;
        const link = origin ?? prefix;
        if (links.has(prefix)) return yield* invalidLink(link, "cycle detected");
        const target = new TextDecoder().decode(yield* fetchBlob(owner, repo, entry.sha, prefix));
        const normalized = path.normalize(path.join(path.dirname(prefix), target));
        if (
          !target ||
          path.isAbsolute(target) ||
          normalized === ".." ||
          normalized.startsWith("../")
        ) {
          return yield* invalidLink(link, `target escapes the repository: ${target}`);
        }
        let resolvedPath = path.join(normalized, ...parts.slice(i));
        if (resolvedPath === ".") resolvedPath = "";
        return yield* resolve(resolvedPath, new Set([...links, prefix]), link);
      }
      const entry = entries.get(repoPath);
      if (!entry) {
        if (origin)
          return yield* invalidLink(origin, `target missing from repository tree: ${repoPath}`);
        return yield* fetchError(
          `github:${owner}/${repo}/${repoPath}`,
          "Path missing from repository tree",
        );
      }
      if (origin && entry.type === "commit") {
        return yield* invalidLink(
          origin,
          `target is a submodule, outside this repository tree: ${repoPath}`,
        );
      }
      return entry;
    });

    const files: Array<{ path: string; repoPath: string }> = [];
    const walk = Effect.fn("GitHub.walkSkillTree")(function* (
      repoPath: string,
      installPath: string,
      ancestors: ReadonlySet<string>,
    ): Effect.fn.Return<void, SkillsError> {
      const entry = yield* resolve(repoPath);
      if (entry.type === "commit") return;
      if (entry.type === "blob") {
        files.push({ path: installPath, repoPath: entry.path });
        return;
      }
      if (ancestors.has(entry.path))
        return yield* invalidLink(repoPath, "directory cycle detected");
      const nextAncestors = new Set([...ancestors, entry.path]);
      for (const child of children.get(entry.path) ?? []) {
        yield* walk(child.path, path.join(installPath, path.basename(child.path)), nextAncestors);
      }
    });
    let normalizedDir = path.normalize(dirPath);
    if (normalizedDir === ".") normalizedDir = "";
    yield* walk(normalizedDir, "", new Set());
    return yield* Effect.forEach(
      files,
      (file) =>
        // Only resolved regular paths reach raw downloads; link text uses git blobs.
        fetchRaw(owner, repo, file.repoPath, ref).pipe(
          Effect.map((content) => ({ path: file.path, content })),
        ),
      { concurrency: 5 },
    );
  }, Effect.provide(Path.layer));

export class GitHubCli extends Context.Service<GitHubCli, GitHubCliShape>()(
  "@cvr/okra/skills/services/GitHub/GitHubCli",
) {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;

      const run = Effect.fn("GitHubCli.run")(function* (args: ReadonlyArray<string>) {
        const label = `gh:${args.join(" ")}`;
        const proc = yield* spawner
          .spawn(
            ChildProcess.make("gh", [...args], {
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
            }),
          )
          .pipe(Effect.mapError((cause) => fetchError(label, cause)));

        // Both streams must be drained while the child runs, otherwise it blocks
        // once a pipe buffer fills.
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            Stream.mkUint8Array(proc.stdout),
            Stream.mkString(Stream.decodeText(proc.stderr)),
            proc.exitCode,
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.mapError((cause) => fetchError(label, cause)));

        if (exitCode !== 0) {
          return yield* fetchError(label, stderr.trim() || `gh exited with code ${exitCode}`);
        }

        return stdout;
      }, Effect.scoped);

      const isInstalled = spawner
        .spawn(
          ChildProcess.make("gh", ["--version"], {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          }),
        )
        .pipe(
          Effect.flatMap((proc) => proc.exitCode),
          Effect.map((exitCode) => exitCode === 0),
          Effect.orElseSucceed(() => false),
          Effect.scoped,
        );

      const isAvailable = Effect.gen(function* () {
        if (!(yield* isInstalled)) return false;

        return yield* run(["auth", "status"]).pipe(
          Effect.as(true),
          Effect.catchTag("@cvr/okra/skills/SkillsError", () => Effect.succeed(false)),
        );
      });

      const listContents = Effect.fn("GitHubCli.listContents")(function* (
        owner: string,
        repo: string,
        path: string,
        ref?: string,
      ) {
        const endpoint = contentsEndpoint(owner, repo, path, ref);
        const output = yield* run([
          "api",
          "-H",
          "Accept: application/vnd.github.v3+json",
          endpoint,
        ]);
        return yield* decodeContentsJson(new TextDecoder().decode(output)).pipe(
          Effect.mapError((cause) => fetchError(`github:${owner}/${repo}/${path}`, cause)),
          Effect.withSpan("GitHubCli.listContents", { attributes: { owner, repo, path, ref } }),
        );
      });

      const fetchRaw = Effect.fn("GitHubCli.fetchRaw")(function* (
        owner: string,
        repo: string,
        path: string,
        ref = DEFAULT_REF,
      ) {
        const endpoint = contentsEndpoint(owner, repo, path, ref);
        return yield* run(["api", "-H", "Accept: application/vnd.github.raw", endpoint]).pipe(
          Effect.mapError((cause) => fetchError(`github:${owner}/${repo}/${path}`, cause)),
          Effect.withSpan("GitHubCli.fetchRaw", { attributes: { owner, repo, path, ref } }),
        );
      });

      // P3: Tree API via gh CLI
      const fetchTree = Effect.fn("GitHubCli.fetchTree")(function* (
        owner: string,
        repo: string,
        ref: string,
        recursive: boolean,
      ) {
        const endpoint = treeEndpoint(owner, repo, ref, recursive);
        const output = yield* run([
          "api",
          "-H",
          "Accept: application/vnd.github.v3+json",
          endpoint,
        ]);
        return yield* decodeTreeJson(new TextDecoder().decode(output)).pipe(
          Effect.mapError((cause) => fetchError(`github:${owner}/${repo}/tree/${ref}`, cause)),
          Effect.withSpan("GitHubCli.listTree", { attributes: { owner, repo, ref } }),
        );
      });

      const fetchBlob: FetchBlob = (owner, repo, sha) =>
        run([
          "api",
          "-H",
          "Accept: application/vnd.github.raw",
          `repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`,
        ]);

      const listTree = makeListTree(fetchTree);
      const discoverSkills = makeDiscoverSkills(listContents, listTree);
      const fetchSkillDirImpl = makeFetchSkillDir(listTree, fetchBlob, fetchRaw);

      return GitHubCli.of({
        run,
        isAvailable,
        listContents,
        fetchRaw,
        listTree,
        discoverSkills,
        fetchSkillDir: fetchSkillDirImpl,
      });
    }),
  );
}

export class GitHubHttp extends Context.Service<GitHubHttp, GitHubHttpShape>()(
  "@cvr/okra/skills/services/GitHub/GitHubHttp",
) {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const jsonClient = client.pipe(HttpClient.filterStatusOk);

      // E5: Resolve token eagerly in layer setup, not per-request
      const token = yield* githubToken;

      const withAuth = (request: HttpClientRequest.HttpClientRequest) =>
        Option.match(token, {
          onNone: () => request,
          onSome: (value) =>
            HttpClientRequest.setHeader("Authorization", `token ${value}`)(request),
        });

      const listContents = Effect.fn("GitHubHttp.listContents")(function* (
        owner: string,
        repo: string,
        path: string,
        ref?: string,
      ) {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoPath(path)}${refQuery(ref)}`;
        const request = withAuth(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeader("Accept", "application/vnd.github.v3+json"),
            HttpClientRequest.setHeader("User-Agent", "@cvr/skills"),
          ),
        );
        return yield* jsonClient.execute(request).pipe(
          Effect.flatMap(decodeContents),
          Effect.mapError((cause) => fetchError(`github:${owner}/${repo}/${path}`, cause)),
          Effect.withSpan("GitHubHttp.listContents", { attributes: { owner, repo, path, ref } }),
        );
      });

      const fetchRaw = Effect.fn("GitHubHttp.fetchRaw")(function* (
        owner: string,
        repo: string,
        path: string,
        ref = DEFAULT_REF,
      ) {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
        const request = withAuth(
          HttpClientRequest.get(url).pipe(HttpClientRequest.setHeader("User-Agent", "@cvr/skills")),
        );
        const response = yield* client.execute(request).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.mapError((cause) => fetchError(`github:${owner}/${repo}/${path}`, cause)),
        );
        return yield* response.arrayBuffer.pipe(
          Effect.map((buffer) => new Uint8Array(buffer)),
          Effect.mapError((cause) => fetchError(`github:${owner}/${repo}/${path}`, cause)),
          Effect.withSpan("GitHubHttp.fetchRaw", { attributes: { owner, repo, path, ref } }),
        );
      });

      // P3: Tree API via HTTP
      const decodeTreeHttp = HttpClientResponse.schemaBodyJson(GitHubTreeResponseSchema);

      const fetchTree = Effect.fn("GitHubHttp.fetchTree")(function* (
        owner: string,
        repo: string,
        ref: string,
        recursive: boolean,
      ) {
        const url = `https://api.github.com/${treeEndpoint(owner, repo, ref, recursive)}`;
        const request = withAuth(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeader("Accept", "application/vnd.github.v3+json"),
            HttpClientRequest.setHeader("User-Agent", "@cvr/skills"),
          ),
        );
        return yield* jsonClient.execute(request).pipe(
          Effect.flatMap(decodeTreeHttp),
          Effect.mapError((cause) => fetchError(`github:${owner}/${repo}/tree/${ref}`, cause)),
          Effect.withSpan("GitHubHttp.listTree", { attributes: { owner, repo, ref } }),
        );
      });

      // E5: Token already resolved eagerly
      const hasExplicitToken = Effect.succeed(Option.isSome(token));

      const fetchBlob: FetchBlob = Effect.fn("GitHubHttp.fetchBlob")(
        function* (owner, repo, sha, path) {
          const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`;
          const response = yield* client
            .execute(
              withAuth(
                HttpClientRequest.get(url).pipe(
                  HttpClientRequest.setHeader("Accept", "application/vnd.github.raw"),
                  HttpClientRequest.setHeader("User-Agent", "@cvr/skills"),
                ),
              ),
            )
            .pipe(
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.mapError((cause) => fetchError(`github:${owner}/${repo}/${path}`, cause)),
            );
          return yield* response.arrayBuffer.pipe(
            Effect.map((buffer) => new Uint8Array(buffer)),
            Effect.mapError((cause) => fetchError(`github:${owner}/${repo}/${path}`, cause)),
          );
        },
      );

      const listTree = makeListTree(fetchTree);
      const discoverSkills = makeDiscoverSkills(listContents, listTree);
      const fetchSkillDirImpl = makeFetchSkillDir(listTree, fetchBlob, fetchRaw);

      return GitHubHttp.of({
        hasExplicitToken,
        listContents,
        fetchRaw,
        listTree,
        discoverSkills,
        fetchSkillDir: fetchSkillDirImpl,
      });
    }),
  );
}

export class GitHub extends Context.Service<GitHub, GitHubShape>()(
  "@cvr/okra/skills/services/GitHub",
) {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const cli = yield* GitHubCli;
      const http = yield* GitHubHttp;

      const resolveTransport = yield* Effect.cached(
        Effect.gen(function* () {
          const hasExplicitToken = yield* http.hasExplicitToken;
          const ghAvailable = yield* cli.isAvailable;
          // An explicit token means the caller chose HTTP auth; otherwise prefer the gh CLI.
          if (!hasExplicitToken && ghAvailable) {
            return { transport: cli as GitHubShape, label: "gh" };
          }
          return { transport: http as GitHubShape, label: "http" };
        }),
      );

      const delegate = <A>(
        op: (t: GitHubShape) => Effect.Effect<A, SkillsError>,
        spanName: string,
        attrs: Record<string, unknown>,
      ): Effect.Effect<A, SkillsError> =>
        resolveTransport.pipe(
          Effect.flatMap(({ transport, label }) =>
            op(transport).pipe(
              Effect.withSpan(spanName, { attributes: { ...attrs, transport: label } }),
            ),
          ),
        );

      return GitHub.of({
        listContents: (owner, repo, path, ref) =>
          delegate((t) => t.listContents(owner, repo, path, ref), "GitHub.listContents", {
            owner,
            repo,
            path,
            ref,
          }),
        fetchRaw: (owner, repo, path, ref) =>
          delegate((t) => t.fetchRaw(owner, repo, path, ref), "GitHub.fetchRaw", {
            owner,
            repo,
            path,
            ref,
          }),
        listTree: (owner, repo, ref) =>
          delegate((t) => t.listTree(owner, repo, ref), "GitHub.listTree", { owner, repo, ref }),
        discoverSkills: (owner, repo, ref) =>
          delegate((t) => t.discoverSkills(owner, repo, ref), "GitHub.discoverSkills", {
            owner,
            repo,
            ref,
          }),
        fetchSkillDir: (owner, repo, dirPath, ref) =>
          delegate((t) => t.fetchSkillDir(owner, repo, dirPath, ref), "GitHub.fetchSkillDir", {
            owner,
            repo,
            dirPath,
            ref,
          }),
      });
    }),
  ).pipe(Layer.provideMerge(GitHubCli.layer), Layer.provideMerge(GitHubHttp.layer));

  static readonly layerTest = (implementation: GitHubShape) => Layer.succeed(this, implementation);
}
