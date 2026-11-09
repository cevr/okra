import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import { Config, Effect, Layer, Option, Schema, Stream, Context, Path } from "effect";
import { SkillsError } from "../errors.js";
import { DEFAULT_REF, REQUEST_TIMEOUT, SKILL_DIR_PREFIXES } from "../lib/constants.js";

const GH_NON_INTERACTIVE_ENV = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" };

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

const withTimeout =
  (label: string) =>
  <A, R>(effect: Effect.Effect<A, SkillsError, R>): Effect.Effect<A, SkillsError, R> =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration: REQUEST_TIMEOUT,
        orElse: () => Effect.fail(fetchError(label, `timed out after ${REQUEST_TIMEOUT}`)),
      }),
    );

const readBytes = <E, R>(
  response: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
  label: string,
): Effect.Effect<Uint8Array, SkillsError, R> =>
  response.pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((ok) => ok.arrayBuffer),
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.mapError((cause) => fetchError(label, cause)),
    withTimeout(label),
  );

type FetchTree = (
  owner: string,
  repo: string,
  ref: string,
  recursive: boolean,
) => ReturnType<GitHubShape["listTree"]>;

const makeListTree =
  (fetchTree: FetchTree): GitHubShape["listTree"] =>
  (owner, repo, ref) =>
    fetchTree(owner, repo, ref, true);

const parentDir = (path: string): string => {
  const index = path.lastIndexOf("/");
  if (index === -1) return "";
  return path.slice(0, index);
};

const joinRepoPath = (dir: string, path: string): string => {
  if (dir) return `${dir}/${path}`;
  return path;
};

interface TreeIndex {
  readonly lookup: (path: string) => Effect.Effect<GitHubTreeEntry | undefined, SkillsError>;
  readonly listDir: (path: string) => Effect.Effect<ReadonlyArray<GitHubTreeEntry>, SkillsError>;
}

const makeTreeIndex = (
  fetchTree: FetchTree,
  owner: string,
  repo: string,
  ref: string,
): TreeIndex => {
  const entries = new Map<string, GitHubTreeEntry>([
    ["", { path: "", type: "tree", mode: "040000", sha: ref }],
  ]);
  const children = new Map<string, Array<GitHubTreeEntry>>();

  const record = (dir: string, tree: ReadonlyArray<GitHubTreeEntry>, recursive: boolean) => {
    const listed = new Map<string, Array<GitHubTreeEntry>>([[dir, []]]);
    const absolute = tree.map((entry) => ({ ...entry, path: joinRepoPath(dir, entry.path) }));
    for (const entry of absolute) {
      entries.set(entry.path, entry);
      if (recursive && entry.type === "tree" && !listed.has(entry.path)) listed.set(entry.path, []);
    }
    for (const entry of absolute) {
      const parent = parentDir(entry.path);
      const siblings = listed.get(parent) ?? [];
      siblings.push(entry);
      listed.set(parent, siblings);
    }
    for (const [path, siblings] of listed) children.set(path, siblings);
  };

  const load = Effect.fn("GitHub.loadTree")(function* (dir: string, sha: string) {
    const deep = yield* fetchTree(owner, repo, sha, true);
    if (!deep.truncated) return record(dir, deep.tree, true);
    const shallow = yield* fetchTree(owner, repo, sha, false);
    if (shallow.truncated)
      return yield* fetchError(`github:${owner}/${repo}/${dir}`, "Repository subtree is truncated");
    record(dir, shallow.tree, false);
  });

  const listDir = Effect.fn("GitHub.listDir")(function* (
    path: string,
  ): Effect.fn.Return<ReadonlyArray<GitHubTreeEntry>, SkillsError> {
    const known = children.get(path);
    if (known) return known;
    const entry = yield* lookup(path);
    if (entry?.type !== "tree") return [];
    yield* load(path, entry.sha);
    return children.get(path) ?? [];
  });

  const lookup = Effect.fn("GitHub.lookupPath")(function* (
    path: string,
  ): Effect.fn.Return<GitHubTreeEntry | undefined, SkillsError> {
    const known = entries.get(path);
    if (known) return known;
    const parent = parentDir(path);
    if (children.has(parent)) return undefined;
    yield* listDir(parent);
    return entries.get(path);
  });

  return { lookup, listDir };
};

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

const discoverFromListing = Effect.fn("GitHub.discoverFromListing")(function* (
  listContents: GitHubShape["listContents"],
  owner: string,
  repo: string,
  ref?: string,
) {
  for (const prefix of SKILL_DIR_PREFIXES) {
    const skills = yield* findSkillsInPrefix(listContents, owner, repo, prefix, ref);
    if (skills.length > 0) return skills;
  }

  const rootEntries = yield* listContents(owner, repo, "", ref).pipe(
    Effect.catchTag("@cvr/okra/skills/SkillsError", () =>
      Effect.succeed([] as ReadonlyArray<GitHubContentEntry>),
    ),
  );

  const rootDirs = rootEntries.filter((entry) => entry.type === "dir");
  if (rootDirs.length > 0) {
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

  if (rootEntries.some((entry) => entry.name === "SKILL.md")) {
    return [{ dirName: repo, skillMdPath: "SKILL.md", skillDir: "" }];
  }

  return [] as ReadonlyArray<SkillEntry>;
});

export const makeDiscoverSkills = (
  listContents: GitHubShape["listContents"],
  listTree: GitHubShape["listTree"],
): GitHubShape["discoverSkills"] =>
  Effect.fn("GitHub.discoverSkills")(function* (owner: string, repo: string, ref?: string) {
    const resolvedRef = ref ?? DEFAULT_REF;

    const treeResult = yield* listTree(owner, repo, resolvedRef).pipe(Effect.option);

    if (treeResult._tag === "Some" && !treeResult.value.truncated) {
      return discoverFromTree(treeResult.value.tree);
    }

    return yield* discoverFromListing(listContents, owner, repo, ref);
  });

const makeFetchSkillDir = (
  fetchTree: FetchTree,
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
    const index = makeTreeIndex(fetchTree, owner, repo, ref);
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
        const entry = yield* index.lookup(prefix);
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
      const entry = yield* index.lookup(repoPath);
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
      for (const child of yield* index.listDir(entry.path)) {
        yield* walk(child.path, path.join(installPath, path.basename(child.path)), nextAncestors);
      }
    });
    let normalizedDir = path.normalize(dirPath);
    if (normalizedDir === ".") normalizedDir = "";
    yield* walk(normalizedDir, "", new Set());
    return yield* Effect.forEach(
      files,
      (file) =>
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

      const exec = Effect.fn("GitHubCli.exec")(function* (
        args: ReadonlyArray<string>,
        label: string,
      ) {
        const proc = yield* spawner
          .spawn(
            ChildProcess.make("gh", [...args], {
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
              env: GH_NON_INTERACTIVE_ENV,
              extendEnv: true,
            }),
          )
          .pipe(Effect.mapError((cause) => fetchError(label, cause)));

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

      const run = (args: ReadonlyArray<string>) => {
        const label = `gh:${args.join(" ")}`;
        return exec(args, label).pipe(withTimeout(label));
      };

      const isInstalled = spawner
        .spawn(
          ChildProcess.make("gh", ["--version"], {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            env: GH_NON_INTERACTIVE_ENV,
            extendEnv: true,
          }),
        )
        .pipe(
          Effect.flatMap((proc) => proc.exitCode),
          Effect.map((exitCode) => exitCode === 0),
          Effect.orElseSucceed(() => false),
          Effect.scoped,
          Effect.timeoutOrElse({ duration: REQUEST_TIMEOUT, orElse: () => Effect.succeed(false) }),
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
      const fetchSkillDirImpl = makeFetchSkillDir(fetchTree, fetchBlob, fetchRaw);

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
        const label = `github:${owner}/${repo}/${path}`;
        return yield* jsonClient.execute(request).pipe(
          Effect.flatMap(decodeContents),
          Effect.mapError((cause) => fetchError(label, cause)),
          withTimeout(label),
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
        const label = `github:${owner}/${repo}/${path}`;
        return yield* readBytes(client.execute(request), label).pipe(
          Effect.withSpan("GitHubHttp.fetchRaw", { attributes: { owner, repo, path, ref } }),
        );
      });

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
        const label = `github:${owner}/${repo}/tree/${ref}`;
        return yield* jsonClient.execute(request).pipe(
          Effect.flatMap(decodeTreeHttp),
          Effect.mapError((cause) => fetchError(label, cause)),
          withTimeout(label),
          Effect.withSpan("GitHubHttp.listTree", { attributes: { owner, repo, ref } }),
        );
      });

      const hasExplicitToken = Effect.succeed(Option.isSome(token));

      const fetchBlob: FetchBlob = Effect.fn("GitHubHttp.fetchBlob")(
        function* (owner, repo, sha, path) {
          const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`;
          const request = withAuth(
            HttpClientRequest.get(url).pipe(
              HttpClientRequest.setHeader("Accept", "application/vnd.github.raw"),
              HttpClientRequest.setHeader("User-Agent", "@cvr/skills"),
            ),
          );
          return yield* readBytes(client.execute(request), `github:${owner}/${repo}/${path}`);
        },
      );

      const listTree = makeListTree(fetchTree);
      const discoverSkills = makeDiscoverSkills(listContents, listTree);
      const fetchSkillDirImpl = makeFetchSkillDir(fetchTree, fetchBlob, fetchRaw);

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
