import { Effect } from "effect";
import { Digest } from "effect/crypto";
import type { SkillFile } from "../services/GitHub.js";

/**
 * SHA-256 of files sorted by relative POSIX path (JS code-unit order).
 * Each record is UTF-8(path), NUL, ASCII(byte length), NUL, then raw content.
 * Length framing preserves file boundaries even for binary content containing NULs.
 * Metadata and empty directories do not participate.
 */
export const hashFiles = Effect.fn("skills.hashFiles")(function* (files: ReadonlyArray<SkillFile>) {
  const digest = yield* Digest.Digest;
  const encoder = new TextEncoder();
  const chunks: Array<Uint8Array> = [];
  for (const file of files.toSorted((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  })) {
    chunks.push(encoder.encode(`${file.path}\0${file.content.length}\0`), file.content);
  }
  const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return `sha256:${yield* digest.digestHex(Digest.sha256, bytes)}`;
});
