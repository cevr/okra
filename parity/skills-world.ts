// Offline GitHub and skills.sh world for skills parity: one loopback fake
// that answers the REST contents, trees and blobs endpoints, raw file reads
// and the search API, plus a fake `gh` program over the same fake. Every
// name, URL, token and byte here is synthetic.
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Node = string | { link: string } | { submodule: true };
export type Files = Record<string, Node>;
export type Repo = { refs: Record<string, Files>; private?: boolean; truncateAbove?: number };
export type SearchHit = {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
};

// The token the fixture's private repos require. Not a real credential.
export const fixtureToken = "fixture-token-0000";
const ghToken = "fixture-gh-token-0000";

export type World = {
  origin: string;
  bin: string;
  repos: Map<string, Repo>;
  search: Map<string, SearchHit[]>;
  // Requests that carried a credential to a place it must not reach.
  leaks: string[];
  stop: () => void;
};

const sha = (text: string) => createHash("sha1").update(text).digest("hex");
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const unhex = (text: string) => Buffer.from(text, "hex").toString("utf8");

type Entry = { path: string; type: "blob" | "tree" | "commit"; mode: string; sha: string };

// entries is every node of a ref as GitHub's tree lists it, directories
// included, with paths relative to the root.
function entries(files: Files, ref: string): Entry[] {
  const out = new Map<string, Entry>();
  for (const [path, node] of Object.entries(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!out.has(dir))
        out.set(dir, { path: dir, type: "tree", mode: "040000", sha: `t${hex(`${ref}\0${dir}`)}` });
    }
    if (typeof node === "string")
      out.set(path, { path, type: "blob", mode: "100644", sha: sha(node) });
    else if ("link" in node)
      out.set(path, { path, type: "blob", mode: "120000", sha: sha(node.link) });
    else out.set(path, { path, type: "commit", mode: "160000", sha: sha(`submodule:${path}`) });
  }
  return [...out.values()].sort((a, b) => byPath(a.path, b.path));
}

function byPath(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function nodeType(node: Files[string]): string {
  if (typeof node === "string") return "file";
  if ("link" in node) return "symlink";
  return "submodule";
}

function entryType(e: { type: string; mode: string }): string {
  if (e.type === "tree") return "dir";
  if (e.type === "commit") return "submodule";
  if (e.mode === "120000") return "symlink";
  return "file";
}

function blobText(files: Files, wanted: string): string | undefined {
  for (const node of Object.values(files)) {
    if (typeof node === "string" && sha(node) === wanted) return node;
    if (typeof node === "object" && "link" in node && sha(node.link) === wanted) return node.link;
  }
  return undefined;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const notFound = () => json({ message: "Not Found" }, 404);

export async function build(dir: string): Promise<World> {
  const repos = new Map<string, Repo>();
  const search = new Map<string, SearchHit[]>();
  const leaks: string[] = [];

  function api(request: Request, rest: string, url: URL): Response {
    const m = rest.match(/^repos\/([^/]+)\/([^/]+)\/(contents|git\/trees|git\/blobs)(?:\/(.*))?$/);
    if (!m) return notFound();
    const repo = repos.get(`${m[1]}/${m[2]}`);
    const auth = request.headers.get("authorization");
    if (!repo || (repo.private && auth !== `token ${fixtureToken}` && auth !== `token ${ghToken}`))
      return notFound();
    const tail = decodeURIComponent(m[4] ?? "");
    if (m[3] === "git/trees") return trees(repo, tail, url);
    if (m[3] === "git/blobs") {
      for (const files of Object.values(repo.refs)) {
        const text = blobText(files, tail);
        if (text !== undefined) return new Response(text);
      }
      return notFound();
    }
    return contents(repo, tail, url, request.headers.get("accept") ?? "");
  }

  function trees(repo: Repo, tail: string, url: URL): Response {
    let ref = tail;
    let base = "";
    if (tail.startsWith("t") && /^t[0-9a-f]+$/.test(tail)) {
      const [r, d] = unhex(tail.slice(1)).split("\0");
      ref = r ?? "";
      base = d ?? "";
    }
    const files = repo.refs[ref];
    if (!files) return notFound();
    const all = entries(files, ref);
    const within = all.filter((e) => base === "" || e.path.startsWith(`${base}/`));
    const relative = within.map((e) => ({
      ...e,
      path: base === "" ? e.path : e.path.slice(base.length + 1),
    }));
    const recursive = url.searchParams.get("recursive") === "1";
    const listed = recursive ? relative : relative.filter((e) => !e.path.includes("/"));
    const truncated =
      recursive && repo.truncateAbove !== undefined && listed.length > repo.truncateAbove;
    return json({
      sha: tail,
      tree: truncated ? listed.slice(0, repo.truncateAbove) : listed,
      truncated,
    });
  }

  function contents(repo: Repo, tail: string, url: URL, accept: string): Response {
    const ref = url.searchParams.get("ref") ?? "main";
    const files = repo.refs[ref];
    if (!files) return notFound();
    const node = files[tail];
    if (node !== undefined) {
      if (typeof node === "string" && accept.includes("raw")) return new Response(node);
      return json({
        name: tail.split("/").at(-1),
        path: tail,
        type: nodeType(node),
      });
    }
    const children = entries(files, ref).filter((e) => {
      if (tail === "") return !e.path.includes("/");
      return e.path.startsWith(`${tail}/`) && !e.path.slice(tail.length + 1).includes("/");
    });
    if (children.length === 0) return notFound();
    return json(
      children.map((e) => ({
        name: e.path.split("/").at(-1),
        path: e.path,
        type: entryType(e),
      })),
    );
  }

  function raw(request: Request, rest: string): Response {
    const m = rest.match(/^([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/);
    if (!m) return new Response("404: Not Found", { status: 404 });
    const repo = repos.get(`${m[1]}/${m[2]}`);
    if (!repo || (repo.private && request.headers.get("authorization") !== `token ${fixtureToken}`))
      return new Response("404: Not Found", { status: 404 });
    const node = repo.refs[m[3]!]?.[decodeURIComponent(m[4]!)];
    if (typeof node === "string") return new Response(node);
    if (node && "link" in node) return new Response(node.link);
    return new Response("404: Not Found", { status: 404 });
  }

  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path.startsWith("/search/")) {
        if (request.headers.has("authorization")) leaks.push(`credential sent to search: ${path}`);
        if (path !== "/search/api/search") return notFound();
        const q = url.searchParams.get("q") ?? "";
        if (q === "broken") return new Response("{", { status: 200 });
        const skills = search.get(q) ?? [];
        return json({ query: q, skills, count: skills.length });
      }
      if (path.startsWith("/api/")) return api(request, path.slice(5), url);
      if (path.startsWith("/raw/")) return raw(request, path.slice(5));
      return notFound();
    },
  });
  const origin = server.url.origin;

  // The fake gh answers --version, auth status and `api -H <accept> <endpoint>`
  // from the fake, with its own fixture token. FAKE_GH=absent makes it a
  // program that fails like a missing one; FAKE_GH=unauthed fails auth.
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  const gh = `#!${process.execPath}
const args = process.argv.slice(2);
const mode = process.env.FAKE_GH ?? "unauthed";
if (mode === "absent") process.exit(127);
if (args[0] === "--version") { console.log("gh version 0.0.0-fixture"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  if (mode === "authed") process.exit(0);
  console.error("You are not logged into any GitHub hosts.");
  process.exit(1);
}
if (args[0] === "api" && args[1] === "-H" && args.length === 4) {
  const accept = args[2].replace(/^Accept: /, "");
  const response = await fetch(${JSON.stringify(origin)} + "/api/" + args[3], { headers: { accept, authorization: "token ${ghToken}" } });
  const body = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) { process.stderr.write("gh: Not Found (HTTP " + response.status + ")\\n"); process.exit(1); }
  process.stdout.write(body);
  process.exit(0);
}
process.stderr.write("fake gh: unsupported " + JSON.stringify(args) + "\\n");
process.exit(2);
`;
  await writeFile(join(bin, "gh"), gh);
  await chmod(join(bin, "gh"), 0o755);
  return { origin, bin, repos, search, leaks, stop: () => server.stop(true) };
}

const skill = (name: string, description: string, body = "Body.\n") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;

// seed fills a world with the fixture repos and search answers; sessions
// change them through `before` steps.
export function seed(world: World) {
  world.repos.clear();
  world.search.clear();
  world.repos.set("acme/tools", {
    refs: {
      main: {
        "README.md": "# tools\n",
        "skills/alpha/SKILL.md": skill("alpha", "First skill"),
        "skills/alpha/refs/notes.md": "notes\n",
        "skills/beta/SKILL.md": skill(
          "Beta Tool",
          "Second skill with a longer description that goes on and on past eighty columns of text",
        ),
        "skills/beta/run.sh": "#!/bin/sh\necho beta\n",
        "skills/gamma/SKILL.md": "no front matter\n",
      },
      v1: {
        "skills/alpha/SKILL.md": skill("alpha", "First skill, v1"),
      },
    },
  });
  world.repos.set("acme/twin", {
    refs: { main: { "skills/alpha/SKILL.md": skill("Alpha Twin", "Same folder name") } },
  });
  world.repos.set("acme/single", {
    refs: { main: { "SKILL.md": skill("single", "A root skill"), "extra/data.txt": "data\n" } },
  });
  world.repos.set("acme/links", {
    refs: {
      main: {
        "shared/common.md": "shared text\n",
        "skills/linked/SKILL.md": skill("linked", "Uses a link"),
        "skills/linked/common.md": { link: "../../shared/common.md" },
        "skills/escape/SKILL.md": skill("escape", "Escapes"),
        "skills/escape/out.md": { link: "../../../outside.md" },
        "skills/cycle/SKILL.md": skill("cycle", "Cycles"),
        "skills/cycle/a": { link: "b" },
        "skills/cycle/b": { link: "a" },
        "skills/sub/SKILL.md": skill("sub", "Has a submodule"),
        "skills/sub/vendor": { submodule: true },
      },
    },
  });
  world.repos.set("acme/private", {
    private: true,
    refs: { main: { "skills/secret/SKILL.md": skill("secret", "Private skill") } },
  });
  world.repos.set("acme/big", {
    truncateAbove: 4,
    refs: {
      main: {
        "docs/a.md": "a\n",
        "docs/b.md": "b\n",
        "skills/one/SKILL.md": skill("one", "One"),
        "skills/two/SKILL.md": skill("two", "Two"),
        "skills/two/x.md": "x\n",
      },
    },
  });
  world.repos.set("acme/nested", {
    refs: {
      main: {
        "pkg/skills/deep/SKILL.md": skill("deep", "Nested"),
        ".agents/skills/deep/SKILL.md": skill("deep", "Agent copy"),
        "other/thing/SKILL.md": skill("thing", "Elsewhere"),
      },
    },
  });
  world.search.set("widget", [
    {
      id: "acme/tools/alpha",
      skillId: "alpha",
      name: "alpha",
      installs: 1234567,
      source: "acme/tools",
    },
    {
      id: "acme/single/single",
      skillId: "single",
      name: "single",
      installs: 12,
      source: "acme/single",
    },
  ]);
  world.search.set("alpha", [
    { id: "acme/tools/alpha", skillId: "alpha", name: "alpha", installs: 5, source: "acme/tools" },
  ]);
  world.search.set("odd", [
    { id: "x", skillId: "x", name: "x", installs: 1, source: "not a repo" },
  ]);
}

export const fixtureSkill = skill;
