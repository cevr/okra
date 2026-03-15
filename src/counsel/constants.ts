export const DEFAULT_OUTPUT_DIR = "/tmp/counsel";
export const DEFAULT_TIMEOUT_SECONDS = 900;
export const KILL_GRACE_PERIOD_MS = 15_000;
export const CLAUDE_READ_ONLY_TOOLS = "Read,Glob,Grep,WebFetch,WebSearch";

export const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";

export const sanitizePath = (path: string): string =>
  Array.from(path)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 0x09 || code > 0x1f;
    })
    .join("");
