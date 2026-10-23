/** Image formats Jev reads, told apart by their first bytes as the API does. */
export type ImageFormat = "png" | "jpeg";

/** An image file Jev can take, read whole. */
export interface ImageFile {
  format: ImageFormat;
  width: number;
  height: number;
  bytes: Uint8Array;
}

/**
 * TypeSafe's limits for one image (docs: Images → Limits). The API rejects an image outside them and never resizes it.
 * Its pixel limits, 78,400 to 2,458,624, are the areas of the smallest and largest squares, so the sides cover them.
 */
export const MIN_SIDE = 280;
export const MAX_SIDE = 1568;
/** The API's limit for one image file. */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export const FORMAT_NAMES: Record<ImageFormat, string> = { png: "PNG", jpeg: "JPEG" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);

/** The format the file's first bytes announce; undefined for anything else. */
export function imageFormat(head: Uint8Array): ImageFormat | undefined {
  if (startsWith(head, PNG_SIGNATURE)) return "png";
  if (startsWith(head, JPEG_SIGNATURE)) return "jpeg";
  return undefined;
}

const uint32 = (bytes: Uint8Array, at: number): number =>
  (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0;
const uint16 = (bytes: Uint8Array, at: number): number => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const chunkType = (bytes: Uint8Array, at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));

interface Size {
  width: number;
  height: number;
  /** An animated PNG: its `acTL` chunk comes before the image data. */
  animated: boolean;
}

/** Size from the IHDR chunk, which must come first; chunks are walked up to the image data for `acTL`. */
function pngSize(bytes: Uint8Array): Size | undefined {
  if (bytes.length < 24 || chunkType(bytes, 12) !== "IHDR") return undefined;
  let animated = false;
  for (let at = 8; at + 8 <= bytes.length; ) {
    const type = chunkType(bytes, at + 4);
    if (type === "IDAT" || type === "IEND") break;
    if (type === "acTL") animated = true;
    at += 12 + uint32(bytes, at);
  }
  return { width: uint32(bytes, 16), height: uint32(bytes, 20), animated };
}

/** Start-of-frame markers, which carry the size: C0–CF but C4 (Huffman tables), C8 and CC (arithmetic coding). */
const isStartOfFrame = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

/** Size from the first start-of-frame segment, walking the segments before the scan data. */
function jpegSize(bytes: Uint8Array): Size | undefined {
  for (let at = 2; at + 4 <= bytes.length; ) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0;
    // Fill bytes, and markers with no segment after them (TEM, RST0–7).
    if (marker === 0xff) at += 1;
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) at += 2;
    else if (marker === 0xd9 || marker === 0xda) return undefined;
    else if (isStartOfFrame(marker)) {
      if (at + 9 > bytes.length) return undefined;
      return { width: uint16(bytes, at + 7), height: uint16(bytes, at + 5), animated: false };
    } else at += 2 + uint16(bytes, at + 2);
  }
  return undefined;
}

/**
 * The image Jev would get, or why the API would refuse it, worded for the agent. Checked here so that a
 * screenshot too large to send costs no request, and the reason says what to change.
 */
export function readImage(format: ImageFormat, bytes: Uint8Array): ImageFile | { skipped: string } {
  const name = FORMAT_NAMES[format];
  const size = format === "png" ? pngSize(bytes) : jpegSize(bytes);
  if (size === undefined) return { skipped: `${name} without a readable size` };
  const { width, height } = size;
  if (size.animated) return { skipped: `animated ${name}; Jev takes still images only` };
  const dims = `${width}×${height} px ${name}`;
  if (width > MAX_SIDE || height > MAX_SIDE) return { skipped: `${dims}; Jev takes at most ${MAX_SIDE} px a side, so scale it down first` };
  if (width < MIN_SIDE || height < MIN_SIDE) return { skipped: `${dims}; Jev takes at least ${MIN_SIDE} px a side` };
  return { format, width, height, bytes };
}
