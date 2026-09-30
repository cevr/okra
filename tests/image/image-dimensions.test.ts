import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  parseSize,
  readImageDimensions,
  sizePromptHint,
} from "../../src/image/image-dimensions.js";

// 3x2 fixtures made with ImageMagick (PNG, JPEG) and ffmpeg libwebp (lossless VP8L, lossy VP8).
const FIXTURES: Record<string, string> = {
  png: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACAQMAAACnuvRZAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gkeAQUkhmuqOgAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==",
  jpeg: "/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==",
  "webp lossless": "UklGRhwAAABXRUJQVlA4TA8AAAAvAkAAAAcQ/Y/+ByKi/wEA",
  "webp lossy":
    "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoDAAIAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=",
};

describe("readImageDimensions", () => {
  for (const [format, base64] of Object.entries(FIXTURES)) {
    test(`reads a ${format} header`, () => {
      expect(readImageDimensions(Uint8Array.fromBase64(base64))).toEqual(
        Option.some({ width: 3, height: 2 }),
      );
    });
  }

  test("returns None for bytes it cannot read", () => {
    expect(readImageDimensions(new Uint8Array([1, 2, 3]))).toEqual(Option.none());
  });
});

describe("sizePromptHint", () => {
  test("states the size and orientation", () => {
    expect(sizePromptHint("1024x1536")).toBe(
      "\n\nOutput size: exactly 1024x1536 pixels (portrait).",
    );
    expect(sizePromptHint("1536x1024")).toContain("(landscape)");
    expect(sizePromptHint("1024x1024")).toContain("(square)");
  });

  test("adds nothing for auto", () => {
    expect(sizePromptHint("auto")).toBe("");
    expect(parseSize("auto")).toEqual(Option.none());
  });
});
