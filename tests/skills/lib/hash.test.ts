import { expect, it } from "effect-bun-test";
import { Effect } from "effect";
import { BunCrypto } from "@effect/platform-bun";
import { hashFiles } from "../../../src/skills/lib/hash.js";

it.effect("keeps the documented hash stable across enumeration order and binary content", () =>
  Effect.gen(function* () {
    // Independently hashed with Python hashlib over the documented byte stream:
    // b'SKILL.md\x003\x00a\x00bassets/\xc3\xa9.bin\x003\x00\xff\x00\xfe'
    const files = [
      { path: "assets/é.bin", content: new Uint8Array([0xff, 0, 0xfe]) },
      { path: "SKILL.md", content: new Uint8Array([0x61, 0, 0x62]) },
    ];
    const expected = "sha256:da4227441e5ffb2ddbc0727d09ac1ef487b20c1e38f4972f342826c1cf45cf76";
    expect(yield* hashFiles(files)).toBe(expected);
    expect(yield* hashFiles(files.toReversed())).toBe(expected);
  }).pipe(Effect.provide(BunCrypto.layerDigest)),
);

// Recorded on main at 976dd241cd853efb3b624f67a44e31637c9c481b with Effect 4.0.0.
it.effect("preserves the pre-4.1 skills lock hash for UTF-8 text and raw binary bytes", () =>
  Effect.gen(function* () {
    const files = [
      { path: "SKILL.md", content: new TextEncoder().encode("# Compatibility\ncafé 🌿\n") },
      { path: "assets/raw.bin", content: new Uint8Array([0, 255, 128, 195, 40, 0, 10]) },
    ];
    const expected = "sha256:7f48689a155ac1627bf955865a7b5703bbd3b92590e358117576986e31e332c3";
    expect(yield* hashFiles(files)).toBe(expected);
    expect(yield* hashFiles(files.toReversed())).toBe(expected);
  }).pipe(Effect.provide(BunCrypto.layerDigest)),
);
