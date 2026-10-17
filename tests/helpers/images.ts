import { crc32, deflateSync } from "node:zlib";

const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];
const uint32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = Uint8Array.from([...ascii(type), ...data]);
  return Uint8Array.from([...uint32(data.length), ...typed, ...uint32(crc32(typed))]);
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** A valid PNG filled with one color; `animated` adds the `acTL` chunk that makes it an animated PNG. */
export function png(width: number, height: number, options: { rgb?: readonly [number, number, number]; animated?: boolean } = {}): Uint8Array {
  const rgb = options.rgb ?? [255, 255, 255];
  const stride = 1 + width * 3;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set(rgb, y * stride + 1 + x * 3);
  }
  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Uint8Array.from([...uint32(width), ...uint32(height), 8, 2, 0, 0, 0])),
    ...(options.animated ? [chunk("acTL", Uint8Array.from([...uint32(1), ...uint32(0)]))] : []),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** JPEG segments up to the scan, enough to carry a size; the server never decodes the pixels. */
export function jpeg(width: number, height: number, options: { progressive?: boolean } = {}): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const huffman = [0xff, 0xc4, 0x00, 0x03, 0x00];
  const frame = [0xff, options.progressive ? 0xc2 : 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff];
  const components = [0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const scan = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...huffman, ...frame, ...components, ...scan, 0x00, 0xff, 0xd9]);
}
