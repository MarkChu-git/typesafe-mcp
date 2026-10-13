// Deterministic generator for the incident-logs workspace and gold.json.
// Run: bun run evals/tasks/incident-logs/generate.ts
//
// Keyword search cannot separate the answer from the noise, so the entries have to be read.
// - The cause has no keyword of its own. The scheduled job is called analytics-nightly, and the pool
//   shortage is worded three ways ("pool saturated", "pool at capacity", "waiting for pool connection").
//   Its statement lines say "still running" and never mention checkout or timeouts.
// - Checkout hangs appear as 504, 499 or "acquire connection timed out", so only some of them say "timed out".
// - Decoys carry the keywords on purpose: search-provider timeouts, checkout 4xx errors, "timeout=30s" in
//   scheduler config, a checkout deploy notice, an orders export download and a pool config line.
// - Most checkout requests are ordinary and fast, so a grep for "checkout" mostly returns normal traffic.
// The criteria that the gold entries meet are stated in task.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Level = 30 | 40 | 50;
type Svc = "api" | "worker" | "scheduler";

interface Fields {
  msg: string;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  err?: { type: string; message: string };
}

/** One line before its id is assigned. `time` is the UTC time of day, HH:MM:SS.mmm. */
interface Plan extends Fields {
  time: string;
  level?: Level;
  svc?: Svc;
}

interface Entry extends Fields {
  at: number;
  level: Level;
  svc: Svc;
  gold: boolean;
  reqId?: string;
}

const DAY = "2026-10-11";
const SEED = 20_261_011;
const BACKGROUND_LINES = 200;
const HEALTH_CHECKS = 25;
const MAX_BYTES = 64 * 1024;
const WINDOW_START = Date.parse(`${DAY}T21:15:00.000Z`);
const WINDOW_END = Date.parse(`${DAY}T22:30:00.000Z`);
const INCIDENT_START = Date.parse(`${DAY}T21:38:30.000Z`);
const INCIDENT_END = Date.parse(`${DAY}T22:07:00.000Z`);

const INCIDENT_NOTE = `# Checkout incident, 2026-10-11

What shoppers saw: on the web checkout, the pay button kept spinning for a long time, and then the page showed a generic error. Many shoppers pressed pay again, and some gave up. Shoppers could still browse products during the same period.

Time window: about 21:40 to 22:10 UTC on 2026-10-11. Checkout behaved normally again after 22:10.

The API log for that night is logs/api-2026-10-11.jsonl. It covers 21:15 to 22:30 UTC, one JSON object per line. logs/FIELDS.md describes the fields.

Open question: why did checkout requests stop getting through?

Written by the on-call engineer on duty, 2026-10-12.
`;

const FIELDS_NOTE = `# Fields in api-2026-10-11.jsonl

Each line is one JSON object, and the lines are in time order. A field that does not apply is left out of the line rather than set to null.

| Field | Meaning |
| --- | --- |
| id | Entry id, unique in the file: e0001, e0002, and so on. |
| time | UTC timestamp in ISO 8601 format. |
| level | 30 for info, 40 for warn, 50 for error. |
| svc | The process that wrote the line. api serves HTTP, worker runs background work, and scheduler starts and stops scheduled jobs. |
| method, route | HTTP method and route pattern. Present on request lines and on some lines about one route. |
| reqId | Id of the request. Present only on lines about a single request. |
| status | HTTP status sent to the client. 499 means the client closed the connection before a response was sent. |
| durationMs | Milliseconds from the start of the request until the response was sent or the connection closed. |
| err | Type and message of the error, on lines that report one. |
| msg | What happened, in words. |
`;

const POOL_TIMEOUT = { type: "PoolAcquireTimeoutError", message: "no free connection in pool after 5000ms" };
const GATEWAY_TIMEOUT = { type: "GatewayTimeoutError", message: "order write did not respond within 30000ms" };
const SEARCH_TIMEOUT = { type: "UpstreamTimeoutError", message: "search-provider: no response in 8000ms" };

/** Checkout request that waited for a database connection and gave up. */
const acquireTimeout = (time: string, route: string, durationMs: number): Plan => ({
  time,
  level: 50,
  method: "POST",
  route,
  status: 503,
  durationMs,
  msg: "acquire connection timed out after 5000ms",
  err: POOL_TIMEOUT,
});

/** Checkout request that ran past its 30 second deadline. */
const gatewayTimeout = (time: string, route: string, durationMs: number): Plan => ({
  time,
  level: 50,
  method: "POST",
  route,
  status: 504,
  durationMs,
  msg: "upstream wait exceeded 30000ms",
  err: GATEWAY_TIMEOUT,
});

/** Checkout request that the client gave up on. */
const clientAbort = (time: string, route: string, durationMs: number): Plan => ({
  time,
  level: 40,
  method: "POST",
  route,
  status: 499,
  durationMs,
  msg: "request aborted by client",
});

/** Checkout request that failed fast with a 4xx response. */
const rejected = (time: string, route: string, status: number, durationMs: number, msg: string): Plan => ({
  time,
  level: 40,
  method: "POST",
  route,
  status,
  durationMs,
  msg,
});

const searchTimeout = (time: string, durationMs: number): Plan => ({
  time,
  level: 50,
  method: "GET",
  route: "/v1/search",
  status: 504,
  durationMs,
  msg: "search provider did not answer within 8000ms",
  err: SEARCH_TIMEOUT,
});

/** Entries that meet a criterion in task.ts: the job, pool exhaustion, retry bursts and checkout hangs. */
const GOLD: Plan[] = [
  { time: "21:38:02.117", svc: "scheduler", level: 30, msg: "job analytics-nightly started (range=last 30 days)" },
  { time: "21:38:09.540", svc: "worker", level: 40, msg: "analytics-nightly holds 18 of 20 pool connections" },
  {
    time: "21:40:10.233",
    svc: "worker",
    level: 40,
    msg: "statement still running after 120000ms (job=analytics-nightly, stmt=orders_rollup)",
  },
  {
    time: "21:42:10.871",
    svc: "worker",
    level: 40,
    msg: "statement still running after 240000ms (job=analytics-nightly, stmt=orders_rollup)",
  },
  {
    time: "21:49:10.402",
    svc: "worker",
    level: 40,
    msg: "statement still running after 660000ms (job=analytics-nightly, stmt=orders_rollup)",
  },
  {
    time: "22:07:13.450",
    svc: "scheduler",
    level: 40,
    msg: "job analytics-nightly stopped by operator (SIGTERM), connections released",
  },
  { time: "21:40:41.902", level: 40, msg: "pool saturated: 20/20 in use, 14 waiting" },
  { time: "21:44:02.118", level: 40, msg: "pool at capacity, 22 requests queued" },
  {
    time: "21:46:12.640",
    level: 40,
    method: "GET",
    route: "/v1/orders/history",
    msg: "waiting for pool connection, queue=9, oldest wait 2944ms",
  },
  { time: "21:49:03.377", level: 40, msg: "pool saturated: 20/20 in use, 19 waiting" },
  {
    time: "21:53:30.205",
    level: 40,
    method: "GET",
    route: "/v1/cart",
    msg: "waiting for pool connection, queue=12, oldest wait 4120ms",
  },
  { time: "21:50:15.060", level: 40, route: "/v1/checkout/pay", msg: "retry burst: 14 client retries in the last 60s" },
  { time: "21:58:20.744", level: 40, route: "/v1/checkout/pay", msg: "retry burst: 21 client retries in the last 60s" },
  acquireTimeout("21:41:03.012", "/v1/checkout/quote", 5012),
  gatewayTimeout("21:41:33.027", "/v1/checkout/pay", 30004),
  clientAbort("21:43:17.605", "/v1/checkout/pay", 29871),
  acquireTimeout("21:44:50.318", "/v1/checkout/address", 5009),
  acquireTimeout("21:46:31.214", "/v1/checkout/quote", 5003),
  gatewayTimeout("21:48:02.559", "/v1/checkout/pay", 30002),
  clientAbort("21:50:40.880", "/v1/checkout/pay", 29944),
  gatewayTimeout("21:51:40.936", "/v1/checkout/pay", 30001),
  clientAbort("21:53:08.402", "/v1/checkout/quote", 29812),
  gatewayTimeout("21:55:21.770", "/v1/checkout/pay", 30005),
  clientAbort("21:58:44.109", "/v1/checkout/pay", 27110),
  gatewayTimeout("21:59:57.333", "/v1/checkout/pay", 30003),
  acquireTimeout("22:02:12.650", "/v1/checkout/quote", 5004),
  gatewayTimeout("22:04:39.218", "/v1/checkout/pay", 30001),
];

/** Entries that look related on a keyword search but do not meet any criterion. */
const DECOYS: Plan[] = [
  searchTimeout("21:20:41.317", 8006),
  searchTimeout("21:22:03.850", 8011),
  searchTimeout("21:23:55.104", 8003),
  searchTimeout("21:25:18.476", 8019),
  searchTimeout("21:26:40.932", 8008),
  searchTimeout("21:28:12.011", 8013),
  searchTimeout("21:29:37.568", 8004),
  rejected("21:31:09.418", "/v1/checkout/coupon", 422, 41, "coupon code not valid for this cart"),
  rejected("21:33:54.220", "/v1/checkout/address", 422, 58, "address failed validation: postcode not found"),
  rejected("21:35:27.781", "/v1/checkout/pay", 402, 512, "payment declined by issuer (insufficient_funds)"),
  rejected("21:42:06.390", "/v1/checkout/pay", 402, 688, "payment declined by issuer (card_expired)"),
  rejected("21:48:33.905", "/v1/checkout/address", 422, 47, "address failed validation: unit number required"),
  rejected("21:55:50.126", "/v1/checkout/coupon", 422, 36, "coupon code expired"),
  rejected("22:00:19.744", "/v1/checkout/pay", 402, 640, "payment declined by issuer (do_not_honor)"),
  rejected("22:09:40.512", "/v1/checkout/address", 422, 52, "address failed validation: postcode not found"),
  rejected("22:14:02.851", "/v1/checkout/coupon", 422, 39, "coupon code not valid for this cart"),
  rejected("22:19:18.270", "/v1/checkout/pay", 402, 455, "payment declined by issuer (insufficient_funds)"),
  {
    time: "21:21:58.640",
    level: 30,
    msg: "deploy notice: api build 2026.10.11-2 rolled out to 4 of 4 pods",
  },
  { time: "21:22:05.318", level: 30, msg: "db pool configured: max=20, acquire timeout=5000ms" },
  {
    time: "21:25:00.410",
    svc: "scheduler",
    level: 30,
    msg: "job reports-digest scheduled, next run 22:30 (timeout=30s, retries=2)",
  },
  { time: "21:31:00.072", svc: "scheduler", level: 30, msg: "job cache-warm scheduled, next run 21:55 (timeout=30s)" },
  { time: "21:45:00.227", svc: "worker", level: 30, msg: "payment provider status check: latency normal, p95 212ms" },
  {
    time: "21:47:30.012",
    svc: "worker",
    level: 30,
    msg: "deploy notice: checkout widget build 1841 published to CDN (no server change)",
  },
  { time: "21:53:12.640", method: "GET", route: "/v1/orders/export", status: 200, durationMs: 212, msg: "request completed" },
  {
    time: "21:59:00.598",
    svc: "scheduler",
    level: 30,
    msg: "job invoice-sync scheduled, next run 23:00 (timeout=30s, retries=2)",
  },
  { time: "21:59:30.661", svc: "worker", level: 30, msg: "payment provider status check: latency normal, p95 219ms" },
  { time: "22:14:37.902", method: "GET", route: "/v1/orders/export", status: 200, durationMs: 340, msg: "request completed" },
  {
    time: "22:21:07.512",
    method: "GET",
    route: "/v1/reports/monthly",
    status: 200,
    durationMs: 14210,
    msg: "request completed",
  },
  {
    time: "22:26:55.084",
    method: "GET",
    route: "/v1/reports/monthly",
    status: 200,
    durationMs: 9870,
    msg: "request completed",
  },
];

const BACKGROUND_ROUTES = [
  ["GET", "/v1/products"],
  ["GET", "/v1/products"],
  ["GET", "/v1/products"],
  ["GET", "/v1/products/:id"],
  ["GET", "/v1/products/:id"],
  ["GET", "/v1/categories"],
  ["GET", "/v1/cart"],
  ["GET", "/v1/cart"],
  ["POST", "/v1/cart/items"],
  ["GET", "/v1/orders"],
  ["GET", "/v1/account/profile"],
  ["POST", "/v1/shipping/rates"],
  ["GET", "/v1/search"],
] as const;

const CHECKOUT_ROUTES = [
  "/v1/checkout/quote",
  "/v1/checkout/quote",
  "/v1/checkout/address",
  "/v1/checkout/pay",
  "/v1/checkout/pay",
] as const;

/** Successful checkout requests that finished quickly, per part of the window. */
const CHECKOUT_OK_WINDOWS = [
  { from: WINDOW_START, to: INCIDENT_START, count: 14 },
  { from: INCIDENT_START, to: INCIDENT_END, count: 8 },
  { from: INCIDENT_END, to: WINDOW_END, count: 24 },
];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 23);

const idFor = (index: number): string => `e${String(index + 1).padStart(4, "0")}`;

function toLine(id: string, e: Entry): string {
  const out: Record<string, unknown> = { id, time: new Date(e.at).toISOString(), level: e.level, svc: e.svc };
  if (e.method !== undefined) out.method = e.method;
  if (e.route !== undefined) out.route = e.route;
  if (e.reqId !== undefined) out.reqId = e.reqId;
  if (e.status !== undefined) out.status = e.status;
  if (e.durationMs !== undefined) out.durationMs = e.durationMs;
  out.msg = e.msg;
  if (e.err !== undefined) out.err = e.err;
  return JSON.stringify(out);
}

export function generate(): { files: Record<string, string>; gold: { ids: string[] } } {
  const rng = mulberry32(SEED);
  const pick = <T>(choices: readonly T[]): T => {
    const choice = choices[Math.floor(rng() * choices.length)];
    if (choice === undefined) throw new Error("pick from empty list");
    return choice;
  };
  const between = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
  const usedReqIds = new Set<string>();
  const newReqId = (): string => {
    for (;;) {
      const hex = Math.floor(rng() * 0x10000).toString(16).padStart(4, "0");
      const id = `req-${hex}`;
      if (!usedReqIds.has(id)) {
        usedReqIds.add(id);
        return id;
      }
    }
  };

  const entries: Entry[] = [];
  const emit = (plan: Plan, gold: boolean): void => {
    const { time, level = 30, svc = "api", ...fields } = plan;
    entries.push({ ...fields, at: Date.parse(`${DAY}T${time}Z`), level, svc, gold });
  };

  for (const plan of GOLD) emit(plan, true);
  for (const plan of DECOYS) emit(plan, false);

  for (let k = 0; k < HEALTH_CHECKS; k++) {
    emit(
      {
        time: clock(WINDOW_START + k * 180_000 + between(0, 900)),
        method: "GET",
        route: "/healthz",
        status: 200,
        durationMs: between(1, 6),
        msg: "health check ok",
      },
      false,
    );
  }

  for (const { from, to, count } of CHECKOUT_OK_WINDOWS) {
    for (let i = 0; i < count; i++) {
      const route = pick(CHECKOUT_ROUTES);
      const durationMs = route.endsWith("/pay") ? between(380, 820) : between(90, 420);
      emit(
        {
          time: clock(from + Math.floor(rng() * (to - from))),
          method: "POST",
          route,
          status: 200,
          durationMs,
          msg: "request completed",
        },
        false,
      );
    }
  }

  for (let i = 0; i < BACKGROUND_LINES; i++) {
    const [method, route] = pick(BACKGROUND_ROUTES);
    const missing = route === "/v1/products/:id" && rng() < 0.2;
    emit(
      {
        time: clock(WINDOW_START + Math.floor(rng() * (WINDOW_END - WINDOW_START))),
        method,
        route,
        status: missing ? 404 : 200,
        durationMs: between(12, 380),
        msg: missing ? "product not found" : "request completed",
      },
      false,
    );
  }

  for (const entry of entries) {
    if (entry.method !== undefined) entry.reqId = newReqId();
  }

  const ordered = entries
    .map((entry, seq) => ({ entry, seq }))
    .toSorted((a, b) => a.entry.at - b.entry.at || a.seq - b.seq)
    .map(({ entry }) => entry);
  const log =`${ordered.map((entry, index) => toLine(idFor(index), entry)).join("\n")}\n`;
  const goldIds = ordered.flatMap((entry, index) => (entry.gold ? [idFor(index)] : []));

  if (ordered.length < 300 || ordered.length > 360) throw new Error(`${ordered.length} log lines`);
  if (goldIds.length !== GOLD.length) throw new Error("gold ids do not match the planted entries");
  if (goldIds.length < 22 || goldIds.length > 30) throw new Error(`${goldIds.length} gold ids`);
  if (new TextEncoder().encode(log).length >= MAX_BYTES) throw new Error("log is 64 KB or larger");

  return {
    files: {
      "INCIDENT.md": INCIDENT_NOTE,
      "logs/FIELDS.md": FIELDS_NOTE,
      "logs/api-2026-10-11.jsonl": log,
    },
    gold: { ids: goldIds },
  };
}

if (import.meta.main) {
  const { files, gold } = generate();
  const root = join(import.meta.dir, "workspace");
  rmSync(root, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  writeFileSync(join(import.meta.dir, "gold.json"), `${JSON.stringify(gold, null, 2)}\n`);
  console.log(`${Object.keys(files).length} files, ${gold.ids.length} gold ids`);
}
