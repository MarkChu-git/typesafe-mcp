import { zstdDecompressSync } from "node:zlib";

/**
 * The JSON a request to a fake API carried. SDK 0.7.0 zstd-compresses bodies of 1 KiB or more and says so
 * in `Content-Encoding`, so fakes read bodies through this rather than as strings.
 */
export async function sentJson(init: RequestInit | undefined): Promise<unknown> {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  let text: string;
  if (typeof body === "string") {
    text = body;
  } else if (body instanceof Uint8Array) {
    const zstd = new Headers(init?.headers).get("content-encoding") === "zstd";
    text = new TextDecoder().decode(zstd ? zstdDecompressSync(body) : body);
  } else {
    throw new Error(`unexpected request body ${Object.prototype.toString.call(body)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
