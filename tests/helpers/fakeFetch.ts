import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fetch } from "@typesafe-ai/sdk";

export interface RecordedCall {
  url: string;
  init?: RequestInit | undefined;
  body?: unknown;
}

export interface FixtureResponse {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

export interface FakeFetch {
  fetch: Fetch;
  calls: RecordedCall[];
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as unknown;
}

const toPath = (input: string): string => {
  try {
    return new URL(input).pathname;
  } catch {
    return input;
  }
};

/** Route by URL path. A queued array is consumed in order; a single fixture is reused. */
export function fakeFetch(routes: Record<string, FixtureResponse | FixtureResponse[]>): FakeFetch {
  const calls: RecordedCall[] = [];
  const queues = new Map(
    Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]] as const),
  );
  const fetch: Fetch = async (input, init) => {
    const path = toPath(input);
    let parsedBody: unknown;
    if (init?.body) {
      try {
        parsedBody = JSON.parse(String(init.body));
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url: input, init, body: parsedBody });
    const q = queues.get(path);
    const fx = q && (q.length > 1 ? q.shift() : q[0]);
    if (!fx) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(fx.body), {
      status: fx.status ?? 200,
      headers: { "content-type": "application/json", ...fx.headers },
    });
  };
  return { fetch, calls };
}
