import { ConfigProvider, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { GitHubHttp } from "../../../src/skills/services/GitHub.js";

export const skillMd = "---\nname: domain\ndescription: test\n---\n";
export const binary = new Uint8Array([0, 0xff, 0x89, 0x50]);

export const repoResponse = (links: Record<string, string> = {}, truncate = false) => {
  const blobs = new Map<string, Uint8Array>();
  const entries = new Map<
    string,
    { path: string; type: "blob" | "tree" | "commit"; mode: string; sha: string }
  >();
  const files: Record<string, string | Uint8Array> = {
    "packages/domain/skills/domain/SKILL.md": skillMd,
    "packages/domain/skills/domain/references/guide.md": "guide",
    "packages/domain/skills/domain/references/nested/data.bin": binary,
    ".agents/skills/domain/SKILL.md": "../../../packages/domain/skills/domain/SKILL.md",
    ".agents/skills/domain/references": "../../../packages/domain/skills/domain/references",
    ...links,
  };
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      entries.set(parent, { path: parent, type: "tree", mode: "040000", sha: parent });
    }
    let mode = "100644";
    if (path.startsWith(".agents/") || path in links) mode = "120000";
    entries.set(path, { path, type: "blob", mode, sha: path });
    let bytes = content;
    if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
    blobs.set(path, bytes);
  }
  entries.set("submodules", {
    path: "submodules",
    type: "tree",
    mode: "040000",
    sha: "submodules",
  });
  entries.set("submodules/vendor", {
    path: "submodules/vendor",
    type: "commit",
    mode: "160000",
    sha: "vendor",
  });
  return (requestUrl: string): Response => {
    const url = new URL(requestUrl);
    let response: Response;
    if (url.hostname === "raw.githubusercontent.com") {
      const repoPath = url.pathname.split("/").slice(4).join("/");
      const bytes = blobs.get(repoPath);
      response = new Response("missing file", { status: 404 });
      if (bytes) response = new Response(new Uint8Array(bytes));
    } else if (url.pathname.includes("/git/trees/")) {
      let tree = [...entries.values()];
      let truncated = false;
      if (truncate && url.searchParams.has("recursive")) {
        tree = [];
        truncated = true;
      } else if (truncate) {
        let prefix = decodeURIComponent(url.pathname.split("/git/trees/")[1] ?? "");
        if (prefix === "main") prefix = "";
        if (prefix) prefix += "/";
        tree = tree
          .filter(
            (entry) =>
              entry.path.startsWith(prefix) && !entry.path.slice(prefix.length).includes("/"),
          )
          .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length) }));
      }
      response = Response.json({ tree, truncated });
    } else if (url.pathname.includes("/git/blobs/")) {
      const sha = decodeURIComponent(url.pathname.split("/git/blobs/")[1] ?? "");
      const bytes = blobs.get(sha);
      response = new Response("missing blob", { status: 404 });
      if (bytes) response = new Response(new Uint8Array(bytes));
    } else {
      const path = decodeURIComponent(url.pathname.split("/contents/")[1] ?? "");
      const bytes = blobs.get(path);
      if (bytes) {
        response = new Response(new Uint8Array(bytes));
      } else if (path === ".agents/skills/domain") {
        response = Response.json([
          { name: "SKILL.md", path: `${path}/SKILL.md`, type: "file" },
          { name: "references", path: `${path}/references`, type: "symlink" },
        ]);
      } else {
        response = new Response("unexpected request", { status: 404 });
      }
    }
    return response;
  };
};

export const repoLayer = (links: Record<string, string> = {}, truncate = false) => {
  const respond = repoResponse(links, truncate);
  const client = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, respond(request.url))),
  );
  return GitHubHttp.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  );
};
