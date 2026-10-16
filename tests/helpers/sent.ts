import { zstdDecompressSync } from "node:zlib";

/** What a request to a fake API carried: its JSON, the file parts of a multipart body by name, and its headers. */
export interface SentRequest {
  json: unknown;
  parts: Record<string, Uint8Array>;
  headers: Headers;
}

/** The body as sent, before any compression. */
async function bodyBytes(init: RequestInit | undefined, headers: Headers): Promise<Uint8Array | undefined> {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  let bytes: Uint8Array;
  if (body instanceof Uint8Array) bytes = body;
  else if (body instanceof Blob) bytes = new Uint8Array(await body.arrayBuffer());
  else throw new Error(`unexpected request body ${Object.prototype.toString.call(body)}`);
  return headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes) : bytes;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/**
 * Reads a request the SDK sent. SDK 0.7.0 zstd-compresses bodies of 1 KiB or more (saying so in
 * `Content-Encoding`) and sends a request with images as multipart form data, its JSON in the `request`
 * part and each image in a part of its own.
 */
export async function sentRequest(init: RequestInit | undefined): Promise<SentRequest> {
  const headers = new Headers(init?.headers);
  const bytes = await bodyBytes(init, headers);
  if (bytes === undefined) return { json: undefined, parts: {}, headers };
  const type = headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) return { json: parseJson(new TextDecoder().decode(bytes)), parts: {}, headers };
  const form = await new Response(bytes, { headers: { "content-type": type } }).formData();
  let json: unknown;
  const parts: Record<string, Uint8Array> = {};
  for (const [name, value] of form) {
    // eslint-disable-next-line no-await-in-loop -- a handful of parts, read in order
    const data = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(await value.arrayBuffer());
    if (name === "request") json = parseJson(new TextDecoder().decode(data));
    else parts[name] = data;
  }
  return { json, parts, headers };
}

/** The JSON a request carried, as `sentRequest` reads it. */
export const sentJson = async (init: RequestInit | undefined): Promise<unknown> => (await sentRequest(init)).json;
