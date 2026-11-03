import { Option } from "effect";

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const pngDimensions = (bytes: Uint8Array, view: DataView): Option.Option<ImageDimensions> => {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return Option.none();
  return Option.some({ width: view.getUint32(16), height: view.getUint32(20) });
};

const isStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

const jpegDimensions = (bytes: Uint8Array, view: DataView): Option.Option<ImageDimensions> => {
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return Option.none();
    const marker = bytes[offset + 1] ?? 0;
    if (isStartOfFrame(marker)) {
      return Option.some({ width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) });
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return Option.none();
};

const uint24 = (view: DataView, offset: number): number =>
  view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);

const webpDimensions = (bytes: Uint8Array, view: DataView): Option.Option<ImageDimensions> => {
  if (bytes.length < 30 || ascii(bytes, 8, 4) !== "WEBP") return Option.none();
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    return Option.some({ width: 1 + uint24(view, 24), height: 1 + uint24(view, 27) });
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return Option.some({ width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) });
  }
  if (chunk === "VP8 ") {
    return Option.some({
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    });
  }
  return Option.none();
};

export const readImageDimensions = (bytes: Uint8Array): Option.Option<ImageDimensions> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 8 && ascii(bytes, 1, 3) === "PNG") return pngDimensions(bytes, view);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return jpegDimensions(bytes, view);
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF") return webpDimensions(bytes, view);
  return Option.none();
};

export const parseSize = (size: string): Option.Option<ImageDimensions> => {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (match === null) return Option.none();
  return Option.some({ width: Number(match[1]), height: Number(match[2]) });
};

const orientation = ({ width, height }: ImageDimensions): string => {
  if (width > height) return "landscape";
  if (width < height) return "portrait";
  return "square";
};

export const sizePromptHint = (size: string): string =>
  Option.match(parseSize(size), {
    onNone: () => "",
    onSome: (dimensions) => `\n\nOutput size: exactly ${size} pixels (${orientation(dimensions)}).`,
  });
