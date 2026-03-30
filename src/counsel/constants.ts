export const DEFAULT_OUTPUT_DIR = "/tmp/counsel";
export const DEFAULT_TIMEOUT_SECONDS = 3600;
export const KILL_GRACE_PERIOD_MS = 15_000;
export const CLAUDE_READ_ONLY_TOOLS = "Read,Glob,Grep,WebFetch,WebSearch";

export const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";

export const cwdBucket = (cwd: string): string => {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter((s) => s.length > 0);
  const tail = segments
    .slice(-2)
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter((s) => s.length > 0);
  const hash = new Bun.CryptoHasher("sha256").update(normalized).digest("hex").slice(0, 8);
  return tail.length > 0 ? `${tail.join("-")}-${hash}` : hash;
};

export const sanitizePath = (path: string): string =>
  Array.from(path)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 0x09 || code > 0x1f;
    })
    .join("");
