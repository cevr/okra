// Offline registry world for repo parity: local bare git remotes, fixed
// tarballs and one loopback fake that answers npm, PyPI and crates.io
// documents. Every name, URL and byte here is synthetic.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const fixedEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: "/nonexistent/parity-home",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

function sh(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, env: fixedEnv, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

export const forges = ["github.com", "gitlab.com", "codeberg.org", "bitbucket.org", "git.sr.ht"];

// Each remote: forge path, tags on the first commit, tags on the second.
const remotes: Array<{ path: string; first: string[]; second: string[] }> = [
  { path: "github.com/acme/widget.git", first: ["v1.0.0"], second: [] },
  { path: "github.com/acme/gizmo.git", first: [], second: ["v0.1.0"] },
  { path: "github.com/acme/left-pad.git", first: [], second: ["v1.1.0"] },
  { path: "gitlab.com/acme/requests-lite.git", first: [], second: ["v2.0.0"] },
  { path: "codeberg.org/acme/serde-lite.git", first: [], second: ["v0.2.0"] },
  { path: "git.sr.ht/~acme/tiny", first: [], second: ["v3.0.0"] },
];

async function remote(world: string, spec: (typeof remotes)[number]) {
  const work = join(world, "work", spec.path);
  await mkdir(work, { recursive: true });
  sh("git", ["init", "-q", "-b", "main"], work);
  await writeFile(join(work, "README.md"), `# ${spec.path}\n`);
  sh("git", ["add", "README.md"], work);
  sh("git", ["commit", "-qm", "first"], work);
  for (const tag of spec.first) sh("git", ["tag", tag], work);
  await mkdir(join(work, "src"));
  await writeFile(
    join(work, "src/index.js"),
    `export const name = ${JSON.stringify(spec.path)};\n`,
  );
  sh("git", ["add", "src/index.js"], work);
  sh("git", ["commit", "-qm", "second"], work);
  for (const tag of spec.second) sh("git", ["tag", tag], work);
  sh("git", ["clone", "-q", "--bare", work, join(world, "remotes", spec.path)], world);
}

// advance adds a commit to a remote, so an update has something to fetch.
export async function advance(world: string, path: string) {
  const work = join(world, "work", path);
  await writeFile(join(work, "CHANGELOG.md"), "- third\n");
  sh("git", ["add", "CHANGELOG.md"], work);
  sh("git", ["commit", "-qm", "third"], work);
  sh("git", ["push", "-q", join(world, "remotes", path), "main"], work);
}

async function tarball(world: string, name: string, files: Record<string, string>) {
  const dir = join(world, "tar", name);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(dir, "package", file, ".."), { recursive: true });
    await writeFile(join(dir, "package", file), text);
  }
  const out = join(world, "tar", `${name}.tgz`);
  sh(
    "tar",
    [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-czf",
      out,
      "-C",
      dir,
      "package",
    ],
    world,
  );
  return readFile(out);
}

export type World = {
  dir: string;
  origin: string;
  stop: () => void;
  gitEnv: Record<string, string>;
};

export async function build(dir: string): Promise<World> {
  await mkdir(join(dir, "remotes"), { recursive: true });
  for (const r of remotes) await remote(dir, r);
  const blobs = new Map<string, Uint8Array>();
  blobs.set(
    "/npm/left-pad/-/left-pad-1.0.0.tgz",
    await tarball(dir, "left-pad-1.0.0", {
      "index.js": "module.exports = 1;\n",
      "package.json": '{"name":"left-pad","version":"1.0.0"}\n',
    }),
  );
  blobs.set(
    "/npm/@scope/kit/-/kit-1.0.0.tgz",
    await tarball(dir, "kit-1.0.0", { "lib/kit.js": "export {};\n", README: "kit\n" }),
  );
  blobs.set(
    "/npm/@scope/kit/-/kit-2.0.0.tgz",
    await tarball(dir, "kit-2.0.0", { "lib/kit.js": "export const two = 2;\n" }),
  );
  blobs.set(
    "/npm/broken-tar/-/broken-tar-1.0.0.tgz",
    new TextEncoder().encode("this is not a gzip stream\n"),
  );
  blobs.set(
    "/files/sdistpkg-1.0.tar.gz",
    await tarball(dir, "sdistpkg-1.0", { "setup.py": "# fixture\n", "sdistpkg/__init__.py": "" }),
  );
  blobs.set(
    "/files/sdistpkg-1.1.tar.gz",
    await tarball(dir, "sdistpkg-1.1", { "setup.py": "# fixture 1.1\n" }),
  );
  blobs.set(
    "/static/serde-lite-0.1.0.crate",
    await tarball(dir, "serde-lite-0.1.0", {
      "Cargo.toml": '[package]\nname = "serde-lite"\n',
      "src/lib.rs": "\n",
    }),
  );
  const npm = (
    name: string,
    versions: string[],
    tags: Record<string, string>,
    extra: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      name,
      versions: Object.fromEntries(
        versions.map((v) => [
          v,
          {
            version: v,
            dist: {
              tarball: `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${v}.tgz`,
              shasum: "0",
            },
          },
        ]),
      ),
      "dist-tags": tags,
      ...extra,
    });
  const docs = new Map<string, string>([
    [
      "/npm/left-pad",
      npm(
        "left-pad",
        ["1.0.0", "1.1.0"],
        { latest: "1.1.0", beta: "1.0.0" },
        { repository: { type: "git", url: "git+https://github.com/acme/left-pad.git" } },
      ),
    ],
    [
      "/npm/@scope/kit",
      npm(
        "@scope/kit",
        ["1.0.0", "2.0.0"],
        { latest: "2.0.0" },
        { repository: "https://example.invalid/not-a-forge" },
      ),
    ],
    ["/npm/noversion", npm("noversion", ["1.0.0"], { next: "1.0.0" })],
    ["/npm/gone-tarball", npm("gone-tarball", ["1.0.0"], { latest: "1.0.0" })],
    ["/npm/broken-tar", npm("broken-tar", ["1.0.0"], { latest: "1.0.0" })],
    [
      "/npm/tiny",
      npm("tiny", ["3.0.0"], { latest: "3.0.0" }, { repository: "https://git.sr.ht/~acme/tiny" }),
    ],
    [
      "/npm/shorthand",
      npm("shorthand", ["1.1.0"], { latest: "1.1.0" }, { repository: "github:acme/left-pad" }),
    ],
    ["/npm/badjson", "{not json"],
    [
      "/npm/badshape",
      JSON.stringify({ versions: { "1.0.0": { dist: {} } }, "dist-tags": { latest: "1.0.0" } }),
    ],
    [
      "/pypi/pypi/requests-lite/json",
      JSON.stringify({
        info: {
          version: "2.0.0",
          project_urls: {
            Homepage: "https://example.invalid",
            Source: "https://gitlab.com/acme/requests-lite",
          },
        },
        urls: [],
      }),
    ],
    [
      "/pypi/pypi/sdistpkg/json",
      JSON.stringify({
        info: { version: "1.1", home_page: "https://example.invalid/sdistpkg" },
        urls: [
          {
            packagetype: "bdist_wheel",
            url: "https://files.pythonhosted.org/sdistpkg-1.1-py3-none-any.whl",
          },
          { packagetype: "sdist", url: "https://files.pythonhosted.org/sdistpkg-1.1.tar.gz" },
        ],
      }),
    ],
    [
      "/pypi/pypi/sdistpkg/1.0/json",
      JSON.stringify({
        info: { version: "1.0" },
        urls: [{ packagetype: "sdist", url: "https://files.pythonhosted.org/sdistpkg-1.0.tar.gz" }],
      }),
    ],
    [
      "/pypi/pypi/wheelonly/json",
      JSON.stringify({
        info: { version: "0.1", project_urls: { Docs: "https://example.invalid" } },
        urls: [{ packagetype: "bdist_wheel", url: "https://files.pythonhosted.org/w.whl" }],
      }),
    ],
    [
      "/pypi/pypi/nullhome/json",
      JSON.stringify({ info: { version: "0.1", home_page: null }, urls: [] }),
    ],
    [
      "/crates/api/v1/crates/serde-lite",
      JSON.stringify({
        crate: { homepage: "https://codeberg.org/acme/serde-lite" },
        versions: [
          { num: "0.2.0", dl_path: "/api/v1/crates/serde-lite/0.2.0/download" },
          { num: "0.1.0", dl_path: "/api/v1/crates/serde-lite/0.1.0/download" },
        ],
      }),
    ],
  ]);
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const path = decodeURIComponent(new URL(request.url).pathname);
      if (
        path.startsWith("/crates/api/v1/crates/") &&
        !path.endsWith("/download") &&
        request.headers.get("user-agent") !== "repo-cli/1.0.0"
      )
        return new Response("user agent required", { status: 403 });
      const doc = docs.get(path);
      if (doc !== undefined)
        return new Response(doc, { headers: { "content-type": "application/json" } });
      const blob = blobs.get(path);
      if (blob !== undefined)
        return new Response(blob as Uint8Array<ArrayBuffer>, {
          headers: { "content-type": "application/octet-stream" },
        });
      const download = path.match(/^\/crates\/api\/v1\/crates\/([^/]+)\/([^/]+)\/download$/);
      if (download)
        return Response.redirect(
          `${server.url.origin}/static/${download[1]}-${download[2]}.crate`,
          302,
        );
      return new Response("not found", { status: 404 });
    },
  });
  const gitEnv: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: String(forges.length),
  };
  forges.forEach((forge, i) => {
    gitEnv[`GIT_CONFIG_KEY_${i}`] = `url.file://${join(dir, "remotes", forge)}/.insteadOf`;
    gitEnv[`GIT_CONFIG_VALUE_${i}`] = `https://${forge}/`;
  });
  return { dir, origin: server.url.origin, stop: () => server.stop(true), gitEnv };
}
