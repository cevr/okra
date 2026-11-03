import { Effect } from "effect";
import { Digest } from "effect/crypto";
import type { SkillFile } from "../services/GitHub.js";

const byPathCodeUnits = (a: SkillFile, b: SkillFile): number => {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
};

export const hashFiles = Effect.fn("skills.hashFiles")(function* (files: ReadonlyArray<SkillFile>) {
  const digest = yield* Digest.Digest;
  const encoder = new TextEncoder();
  const lengthFramedRecords: Array<Uint8Array> = [];
  for (const file of files.toSorted(byPathCodeUnits)) {
    lengthFramedRecords.push(
      encoder.encode(`${file.path}\0${file.content.length}\0`),
      file.content,
    );
  }
  const bytes = new Uint8Array(
    lengthFramedRecords.reduce((length, chunk) => length + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of lengthFramedRecords) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return `sha256:${yield* digest.digestHex(Digest.sha256, bytes)}`;
});
