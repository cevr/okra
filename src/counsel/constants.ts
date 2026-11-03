import { Effect } from "effect";
import { Digest } from "effect/crypto";

export const DEFAULT_OUTPUT_DIR = "/tmp/counsel";
export const DEFAULT_TIMEOUT_SECONDS = 3600;
export const KILL_GRACE_PERIOD_MS = 15_000;
export const CLAUDE_READ_ONLY_TOOLS = "Read,Glob,Grep,WebFetch,WebSearch";

const resolveVersion = (): string => {
  if (typeof __VERSION__ !== "undefined") return __VERSION__;
  return "0.0.0-dev";
};

export const VERSION = resolveVersion();

export const makeCwdBucket = Effect.gen(function* () {
  const digest = yield* Digest.Digest;
  return Effect.fn("counsel.cwdBucket")(function* (cwd: string) {
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
    const hash = (yield* digest.digestHex(
      Digest.sha256,
      new TextEncoder().encode(normalized),
    )).slice(0, 8);
    if (tail.length > 0) return `${tail.join("-")}-${hash}`;
    return hash;
  });
});

export const sanitizePath = (path: string): string =>
  Array.from(path)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 0x09 || code > 0x1f;
    })
    .join("");
