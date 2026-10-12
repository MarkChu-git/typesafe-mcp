import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Fetch } from "@typesafe-ai/sdk";
import { resetClient } from "../src/client.ts";
import { MAX_UNSURE_BYTES, MAX_UNSURE_TOTAL_BYTES } from "../src/filters.ts";
import { META_KEY } from "../src/result.ts";
import { fakeFetch, loadFixture } from "./helpers/fakeFetch.ts";
import { clientWithRoots, inProcessClient } from "./helpers/mcp.ts";

const textOf = (result: { content?: Array<{ type: string; text?: string }> }): string => {
  const block = result.content?.[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") return "";
  return block.text;
};

const mixed = {
  state: { ticket: "Help! My payouts have been failing for 3 days." },
  questions: {
    urgent: { type: "noul", question: "Does `ticket` convey urgency?" },
    dept: {
      type: "choice",
      question: "Which team should handle `ticket`?",
      options: { billing: null, technical: null, sales: null },
    },
    anger: {
      type: "score",
      question: "How frustrated is the customer?",
      levels: ["Calm", "Frustrated", "Very angry"],
    },
  },
};

async function callAsk(args: Record<string, unknown>) {
  const ff = fakeFetch({ "/v1/systemone": { body: loadFixture("ask.mixed3.json") } });
  const { client, close } = await inProcessClient({ fetch: ff.fetch, env: { TYPESAFE_API_KEY: "test-key" } });
  try {
    const result = await client.callTool({ name: "jev_ask", arguments: args });
    return { result, calls: ff.calls };
  } finally {
    await close();
  }
}

describe("jev_ask", () => {
  afterEach(() => {
    resetClient();
  });

  test("mixed batch of 3 → one fetch, one concise answer per question", async () => {
    const { result: r, calls } = await callAsk(mixed);
    expect(r.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(r.structuredContent).toEqual({
      answers: {
        urgent: { answer: true, certainty: 0.9, decision: "act" },
        dept: { answer: "billing", certainty: 0.81, decision: "act" },
        anger: { answer: 1.05, certainty: 0.92, decision: "act" },
      },
    });
    // Hosts that read the text block see the same JSON.
    expect(JSON.parse(textOf(r))).toEqual(r.structuredContent);
    const sent = calls[0]?.body as { questions: Record<string, { type: string }> };
    expect(new Set(Object.keys(sent.questions))).toEqual(new Set(["anger", "dept", "urgent"]));
    expect(sent.questions["urgent"]?.type).toBe("noul");
    expect(sent.questions["dept"]?.type).toBe("choice");
    expect(sent.questions["anger"]?.type).toBe("score");
  });

  test("model, usage and thresholds go to _meta, not to the agent-visible result", async () => {
    const { result: r } = await callAsk(mixed);
    expect(r._meta?.[META_KEY]).toEqual({
      model: "jev-1.13.0",
      usage: { input_tokens: 340, output_tokens: 72 },
      thresholds: { act_above: 0.8, review_above: 0.5 },
    });
    expect(textOf(r)).not.toContain("usage");
    expect(textOf(r)).not.toContain("jev-1.13.0");
  });

  test("detailed adds the probabilities behind each answer", async () => {
    const { result: r } = await callAsk({ ...mixed, detailed: true });
    const sc = r.structuredContent as { answers: Record<string, Record<string, unknown>> };
    expect(sc.answers["urgent"]).toEqual({ answer: true, certainty: 0.9, decision: "act", probability: 0.95 });
    expect(sc.answers["dept"]?.["probabilities"]).toEqual({ billing: 0.88, technical: 0.12, sales: 0 });
    expect(sc.answers["anger"]?.["probabilities"]).toEqual({ "0": 0, "1": 0.95, "2": 0.05 });
  });

  test("custom thresholds change the decision", async () => {
    const { result: r } = await callAsk({ ...mixed, act_above: 0.95, review_above: 0.85 });
    const sc = r.structuredContent as { answers: Record<string, { decision: string }> };
    expect(sc.answers["urgent"]?.decision).toBe("review");
    expect(sc.answers["dept"]?.decision).toBe("abstain");
    expect(r._meta?.[META_KEY]).toMatchObject({ thresholds: { act_above: 0.95, review_above: 0.85 } });
  });

  test("empty questions → rejected without a fetch", async () => {
    const { result: r, calls } = await callAsk({ state: "Help!", questions: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("at least one question");
    expect(calls).toHaveLength(0);
  });

  test("a choice question without options names the missing field", async () => {
    const { result: r, calls } = await callAsk({
      state: "Help!",
      questions: { dept: { type: "choice", question: "Which team?" } },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("options");
    expect(textOf(r)).toContain("required when type is choice");
    expect(calls).toHaveLength(0);
  });
});

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A project root with two tickets, for `files` calls. */
function ticketsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ask-files-"));
  roots.push(root);
  mkdirSync(join(root, "tickets"));
  writeFileSync(join(root, "tickets", "a.md"), "Payouts failing for 3 days");
  writeFileSync(join(root, "tickets", "b.md"), "Please update my email");
  return root;
}

/** Answers every request with check.yes095.json, except 422 for files named in `reject`. */
function fileFetch(reject: readonly string[] = []) {
  const bodies: { state: { file: string; content: string; context?: unknown } }[] = [];
  const fixture = JSON.stringify(loadFixture("check.yes095.json"));
  const fetch: Fetch = async (_input, init) => {
    if (typeof init?.body !== "string") throw new Error("fileFetch expects a JSON string body");
    const body = JSON.parse(init.body) as (typeof bodies)[number];
    bodies.push(body);
    if (reject.includes(body.state.file)) {
      return new Response(JSON.stringify(loadFixture("error.422.json")), { status: 422 });
    }
    return new Response(fixture, { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, bodies };
}

const urgent = { q: { type: "noul", question: "Is this ticket urgent?" } };

/** A project root with `n` one-line tickets at the top level. */
function manyTickets(n: number): string {
  const root = mkdtempSync(join(tmpdir(), "ask-many-"));
  roots.push(root);
  for (let i = 0; i < n; i += 1) writeFileSync(join(root, `t${String(i).padStart(2, "0")}.md`), `ticket ${i}`);
  return root;
}

describe("jev_ask with files", () => {
  afterEach(() => {
    resetClient();
  });

  test("asks every matching file the same questions, one Jev request each", async () => {
    const root = ticketsRoot();
    const ff = fileFetch();
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_FILES_ROOT: root },
    });
    try {
      const r = await client.callTool({
        name: "jev_ask",
        arguments: { files: "tickets/*.md", context: "Urgent means money is stuck.", questions: urgent },
      });
      expect(r.isError).toBeFalsy();
      const answer = { answer: true, certainty: 0.9, decision: "act" };
      expect(r.structuredContent).toEqual({ files: { "tickets/a.md": { q: answer }, "tickets/b.md": { q: answer } } });
      expect(ff.bodies.map((b) => b.state).toSorted((x, y) => x.file.localeCompare(y.file))).toEqual([
        { file: "tickets/a.md", content: "Payouts failing for 3 days", context: "Urgent means money is stuck." },
        { file: "tickets/b.md", content: "Please update my email", context: "Urgent means money is stuck." },
      ]);
      expect(r._meta?.[META_KEY]).toMatchObject({ usage: { input_tokens: 614, output_tokens: 40 } });
    } finally {
      await close();
    }
  });

  test("a file Jev rejects is reported in errors; the others still answer", async () => {
    const root = ticketsRoot();
    const ff = fileFetch(["tickets/b.md"]);
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_FILES_ROOT: root },
    });
    try {
      const r = await client.callTool({ name: "jev_ask", arguments: { files: ["tickets/*.md"], questions: urgent } });
      const sc = r.structuredContent as { files: Record<string, unknown>; errors: Record<string, string> };
      expect(Object.keys(sc.files)).toEqual(["tickets/a.md"]);
      expect(sc.errors["tickets/b.md"]).toStartWith("INVALID_REQUEST");
    } finally {
      await close();
    }
  });

  test("reads under the client's MCP roots when TYPESAFE_FILES_ROOT is unset", async () => {
    const root = ticketsRoot();
    const ff = fileFetch();
    const { client, close, rootRequests } = await clientWithRoots({ fetch: ff.fetch, env: { TYPESAFE_API_KEY: "test-key" } }, [root]);
    try {
      const r = await client.callTool({ name: "jev_ask", arguments: { files: "tickets/a.md", questions: urgent } });
      expect(r.isError).toBeFalsy();
      expect(Object.keys((r.structuredContent as { files: object }).files)).toEqual(["tickets/a.md"]);
      expect(rootRequests()).toBe(1);
    } finally {
      await close();
    }
  });

  test("TYPESAFE_FILES_ROOT wins, and the client's roots are not requested", async () => {
    const root = ticketsRoot();
    const elsewhere = ticketsRoot();
    writeFileSync(join(elsewhere, "tickets", "a.md"), "from the client root");
    const ff = fileFetch();
    const { client, close, rootRequests } = await clientWithRoots(
      { fetch: ff.fetch, env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_FILES_ROOT: root } },
      [elsewhere],
    );
    try {
      const r = await client.callTool({ name: "jev_ask", arguments: { files: "tickets/a.md", questions: urgent } });
      expect(r.isError).toBeFalsy();
      expect(ff.bodies.map((b) => b.state.content)).toEqual(["Payouts failing for 3 days"]);
      expect(rootRequests()).toBe(0);
    } finally {
      await close();
    }
  });

  test("a TYPESAFE_FILES_ROOT that does not exist is a CONFIG error", async () => {
    const ff = fileFetch();
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_FILES_ROOT: join(tmpdir(), "typesafe-mcp-no-such-dir") },
    });
    try {
      const r = await client.callTool({ name: "jev_ask", arguments: { files: "*.md", questions: urgent } });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toStartWith("CONFIG");
      expect(textOf(r)).toContain("does not exist");
      expect(ff.bodies).toHaveLength(0);
    } finally {
      await close();
    }
  });

  test("without MCP roots or TYPESAFE_FILES_ROOT, files reads under the server's working directory", async () => {
    const root = ticketsRoot();
    const ff = fileFetch();
    const { client, close } = await inProcessClient({ fetch: ff.fetch, env: { TYPESAFE_API_KEY: "test-key" }, cwd: root });
    try {
      const r = await client.callTool({ name: "jev_ask", arguments: { files: "tickets/a.md", questions: urgent } });
      expect(r.isError).toBeFalsy();
      expect(ff.bodies.map((b) => b.state.content)).toEqual(["Payouts failing for 3 days"]);
    } finally {
      await close();
    }
  });

  test("started in the home directory without MCP roots or TYPESAFE_FILES_ROOT, files is a CONFIG error and nothing is sent", async () => {
    const ff = fileFetch();
    const { client, close } = await inProcessClient({
      fetch: ff.fetch,
      env: { TYPESAFE_API_KEY: "test-key" },
      cwd: homedir(),
    });
    try {
      const r = await client.callTool({ name: "jev_ask", arguments: { files: "*.md", questions: urgent } });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toStartWith("CONFIG");
      expect(textOf(r)).toContain("TYPESAFE_FILES_ROOT");
      expect(ff.bodies).toHaveLength(0);
    } finally {
      await close();
    }
  });

  test("a rejected key ends the batch as AUTH without sending the remaining files", async () => {
    const root = manyTickets(20);
    let sent = 0;
    const fetch: Fetch = async () => {
      sent += 1;
      return new Response(JSON.stringify(loadFixture("error.401.json")), { status: 401 });
    };
    const { client, close } = await inProcessClient({ fetch, env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_FILES_ROOT: root } });
    try {
      const r = await client.callTool({ name: "jev_ask", arguments: { files: "*.md", questions: urgent } });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toStartWith("AUTH");
      // The first 8 requests are in flight together; none starts after the first rejection lands.
      expect(sent).toBeLessThanOrEqual(8);
    } finally {
      await close();
    }
  });

  test("cancelling the call stops sending files to Jev", async () => {
    const root = manyTickets(20);
    const fixture = JSON.stringify(loadFixture("check.yes095.json"));
    let sent = 0;
    const fetch: Fetch = async () => {
      sent += 1;
      await Bun.sleep(20);
      return new Response(fixture, { status: 200, headers: { "content-type": "application/json" } });
    };
    const { client, close } = await clientWithRoots(
      { fetch, env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_FILES_ROOT: root } },
      [],
    );
    try {
      const controller = new AbortController();
      const call = client.callTool(
        { name: "jev_ask", arguments: { files: "*.md", questions: urgent } },
        { signal: controller.signal },
      );
      await Bun.sleep(10);
      controller.abort();
      await call.catch(() => undefined);
      // Without cancellation all 20 requests would have gone out by now (3 rounds of up to 8 × 20 ms).
      await Bun.sleep(300);
      expect(sent).toBeLessThan(20);
    } finally {
      await close();
    }
  });

  test("state and files are mutually exclusive", async () => {
    const { result: r, calls } = await callAsk({ state: "Help!", files: "*.md", questions: urgent });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("exactly one of state or files");
    expect(calls).toHaveLength(0);
  });
});

type Sent = { state: { file: string; content: unknown; context?: unknown }; questions: Record<string, { type: string }> };

/** The number after `x=` in the content, else .95 when it says URGENT and .05 when it does not. */
function levelIn(content: string): number {
  const marked = /x=([\d.]+)/.exec(content)?.[1];
  if (marked !== undefined) return Number(marked);
  return content.includes("URGENT") ? 0.95 : 0.05;
}

function answerFor(type: string, x: number): unknown {
  if (type === "noul") return { type, noul: x };
  if (type === "score") {
    return { type, score: 2 * x, legend: { 0: "calm", 1: "upset", 2: "furious" }, probabilities: { 0: 0, 1: 0, 2: 1 }, confidence: 0.9 };
  }
  return { type, choice: x >= 0.5 ? "high" : "low", probabilities: { high: x, low: 1 - x }, confidence: 0.9 };
}

/**
 * Decides each answer from the request itself, since with several requests in flight their order is
 * not fixed. noul → x, score → 2x, choice → high from .5 up. `reject` makes Jev answer 422.
 */
function judgingFetch(options: { reject?: (content: string) => boolean; delayMs?: number; waitFor?: number } = {}) {
  const bodies: Sent[] = [];
  let inFlight = 0;
  let peak = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const fetch: Fetch = async (_input, init) => {
    if (typeof init?.body !== "string") throw new Error("judgingFetch expects a JSON string body");
    const body = JSON.parse(init.body) as Sent;
    bodies.push(body);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      if (options.waitFor !== undefined) {
        // Hold requests until that many are in flight, so the peak does not depend on timing.
        if (inFlight >= options.waitFor) open();
        const giveUp = setTimeout(open, 2_000);
        await gate;
        clearTimeout(giveUp);
      }
      if (options.delayMs) await Bun.sleep(options.delayMs);
      const content = typeof body.state.content === "string" ? body.state.content : JSON.stringify(body.state.content);
      if (options.reject?.(content)) {
        return new Response(JSON.stringify(loadFixture("error.422.json")), { status: 422 });
      }
      const x = levelIn(content);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, answerFor(q.type, x)]));
      const reply = { model: "jev-1.13.0", answers, usage: { input_tokens: 10, output_tokens: 2 } };
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    } finally {
      inFlight -= 1;
    }
  };
  return { fetch, bodies, peak: () => peak };
}

type FilesResult = {
  files?: Record<string, Record<string, { answer: unknown; certainty: number; decision: string }>>;
  total?: number;
  matched?: number;
  counts?: Record<string, Record<string, number>>;
  unsure?: Record<string, string>;
  more_unsure?: number;
  errors?: Record<string, string>;
  more_errors?: number;
};

/** A project root holding `files` (path → text). */
function projectWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ask-records-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

async function callWithFiles(
  files: Record<string, string>,
  args: Record<string, unknown>,
  fetchOptions?: Parameters<typeof judgingFetch>[0],
) {
  const judge = judgingFetch(fetchOptions);
  const root = projectWith(files);
  const { client, close } = await inProcessClient({
    fetch: judge.fetch,
    env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_FILES_ROOT: root },
  });
  try {
    const result = await client.callTool({ name: "jev_ask", arguments: args });
    return { result, judge, sc: result.structuredContent as FilesResult };
  } finally {
    await close();
  }
}

const urgentQ = { type: "noul", question: "Is this urgent?" };
const angerQ = { type: "score", question: "How angry is this?", levels: ["calm", "upset", "furious"] };
const teamQ = { type: "choice", question: "Which tier fits this?", options: { high: null, low: null } };

/** What one noul answer looks like at certainty .9. */
const acts = (answer: boolean) => ({ urgent: { answer, certainty: 0.9, decision: "act" } });

const logFile = { "logs/app.log": "URGENT disk full\n\nall fine\r\nURGENT db down\n" };
const scoresFile = { "scores.txt": "a x=0.2\nb x=0.9\nc x=0.5\nd x=0.7" };

describe("jev_ask with items, where, top and counts", () => {
  afterEach(() => {
    resetClient();
  });

  test("items: lines asks about each non-blank line, keyed path:N, with the file name and the context", async () => {
    const { result, judge, sc } = await callWithFiles(logFile, {
      files: "logs/*.log",
      items: "lines",
      context: "Urgent means data loss.",
      questions: { urgent: urgentQ },
    });
    expect(result.isError).toBeFalsy();
    expect(sc).toEqual({
      files: { "logs/app.log:1": acts(true), "logs/app.log:3": acts(false), "logs/app.log:4": acts(true) },
    });
    // Requests arrive in no fixed order.
    const states = judge.bodies.map((b) => b.state);
    expect(states.map((state) => String(state.content)).toSorted()).toEqual(["URGENT db down", "URGENT disk full", "all fine"]);
    expect(states.every((state) => state.file === "logs/app.log" && state.context === "Urgent means data loss.")).toBe(true);
  });

  test("where returns only the matching records, with how many were answered and how many matched", async () => {
    const { judge, sc } = await callWithFiles(logFile, {
      files: "logs/*.log",
      items: "lines",
      where: { urgent: true },
      questions: { urgent: urgentQ },
    });
    expect(Object.keys(sc.files ?? {})).toEqual(["logs/app.log:1", "logs/app.log:4"]);
    expect(sc.total).toBe(3);
    expect(sc.matched).toBe(2);
    expect(sc.errors).toBeUndefined();
    expect(judge.bodies).toHaveLength(3);
  });

  test("where works on whole files too, keyed by path", async () => {
    const { sc } = await callWithFiles(
      { "tickets/a.md": "URGENT payouts failing", "tickets/b.md": "Please update my email" },
      { files: "tickets/*.md", where: { urgent: { is: true, decision: "act" } }, questions: { urgent: urgentQ } },
    );
    expect(Object.keys(sc.files ?? {})).toEqual(["tickets/a.md"]);
    expect(sc).toMatchObject({ total: 2, matched: 1 });
  });

  test("top keeps the k best in rank order, by a noul's p(yes) or a weighted sum", async () => {
    const byUrgent = await callWithFiles(scoresFile, {
      files: "scores.txt",
      items: "lines",
      top: { by: "urgent", k: 2 },
      questions: { urgent: urgentQ },
    });
    expect(Object.keys(byUrgent.sc.files ?? {})).toEqual(["scores.txt:2", "scores.txt:4"]);
    expect(byUrgent.sc.total).toBe(4);
    expect(byUrgent.sc.matched).toBeUndefined();

    // urgent is x and anger is 2x, so the sum x - 2x ranks the lowest x first.
    const weighted = await callWithFiles(scoresFile, {
      files: "scores.txt",
      items: "lines",
      top: { by: { urgent: 1, anger: -1 }, k: 3 },
      questions: { urgent: urgentQ, anger: angerQ },
    });
    expect(Object.keys(weighted.sc.files ?? {})).toEqual(["scores.txt:1", "scores.txt:3", "scores.txt:4"]);
  });

  test("top ranks what where lets through", async () => {
    const { sc } = await callWithFiles(scoresFile, {
      files: "scores.txt",
      items: "lines",
      where: { anger: { min: 1 } },
      top: { by: "urgent", k: 2 },
      questions: { urgent: urgentQ, anger: angerQ },
    });
    expect(Object.keys(sc.files ?? {})).toEqual(["scores.txt:2", "scores.txt:4"]);
    expect(sc).toMatchObject({ total: 4, matched: 3 });
  });

  test("counts alone return the tallies and no records", async () => {
    const { result, sc } = await callWithFiles(scoresFile, {
      files: "scores.txt",
      items: "lines",
      counts: true,
      questions: { urgent: urgentQ, team: teamQ, anger: angerQ },
    });
    expect(sc).toEqual({
      total: 4,
      counts: {
        urgent: { true: 3, false: 1 },
        team: { high: 3, low: 1 },
        anger: { "0": 1, "1": 2, "2": 1 },
      },
    });
    expect(Object.keys(JSON.parse(textOf(result)) as object)).toEqual(["total", "counts"]);
  });

  test("with where, counts add the tallies over every record and the matching records stay", async () => {
    const { sc } = await callWithFiles(scoresFile, {
      files: "scores.txt",
      items: "lines",
      where: { urgent: false },
      counts: true,
      questions: { urgent: urgentQ },
    });
    expect(Object.keys(sc.files ?? {})).toEqual(["scores.txt:1"]);
    expect(sc).toMatchObject({ total: 4, matched: 1, counts: { urgent: { true: 3, false: 1 } } });
  });

  test("more records than the limit fail before any request", async () => {
    const lines = Array.from({ length: 501 }, (_, i) => `line ${i}`).join("\n");
    const { result, judge } = await callWithFiles({ "big.log": lines }, { files: "big.log", items: "lines", questions: { urgent: urgentQ } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toStartWith("VALIDATION: big.log give 501 records; the limit is 500 per call, so narrow the pattern");
    expect(judge.bodies).toHaveLength(0);
  });

  test("exactly the limit is answered", async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const { result, judge, sc } = await callWithFiles({ "big.log": lines }, { files: "big.log", items: "lines", counts: true, questions: { urgent: urgentQ } });
    expect(result.isError).toBeFalsy();
    expect(judge.bodies).toHaveLength(500);
    expect(sc).toEqual({ total: 500, counts: { urgent: { false: 500 } } });
  }, 30_000);

  test("a 200 KB file is skipped as a whole but read in lines mode", async () => {
    const text = Array.from({ length: 4 }, () => "x".repeat(50 * 1024)).join("\n");
    const kb = Math.ceil(Buffer.byteLength(text) / 1024);
    const whole = await callWithFiles({ "data/big.txt": text }, { files: "data/*.txt", questions: { urgent: urgentQ } });
    expect(whole.result.isError).toBeFalsy();
    expect(whole.sc).toEqual({ files: {}, errors: { "data/big.txt": `${kb} KB is over the 64 KB limit` } });
    expect(whole.judge.bodies).toHaveLength(0);

    const split = await callWithFiles({ "data/big.txt": text }, { files: "data/*.txt", items: "lines", questions: { urgent: urgentQ } });
    expect(Object.keys(split.sc.files ?? {})).toEqual(["data/big.txt:1", "data/big.txt:2", "data/big.txt:3", "data/big.txt:4"]);
    expect(split.sc.errors).toBeUndefined();
  });

  test("a file over 1 MB is skipped in every mode", async () => {
    const { sc, judge } = await callWithFiles(
      { "huge.log": "x\n".repeat(600 * 1024) },
      { files: "huge.log", items: "lines", questions: { urgent: urgentQ } },
    );
    expect(sc).toEqual({ files: {}, errors: { "huge.log": "1200 KB is over the 1024 KB limit" } });
    expect(judge.bodies).toHaveLength(0);
  });

  test("items, where, top and counts without files are a validation error", async () => {
    for (const extra of [{ items: "lines" }, { where: { q: true } }, { top: { by: "q", k: 1 } }, { counts: true }]) {
      // eslint-disable-next-line no-await-in-loop -- four cases, one after the other
      const { result: r, calls } = await callAsk({ state: "Help!", questions: urgent, ...extra });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("items, where, top and counts are only used with files");
      expect(calls).toHaveLength(0);
    }
  });

  test("a where or top that does not fit the questions fails before any request", async () => {
    const questions = { urgent: urgentQ, team: teamQ, anger: angerQ };
    const cases: [Record<string, unknown>, string][] = [
      [{ where: { nope: true } }, "where.nope: unknown question id"],
      [{ where: { team: true } }, "where.team: a choice question takes an option label"],
      [{ where: { urgent: { min: 1 } } }, "where.urgent: min and max only apply to score questions"],
      [{ where: { anger: { min: 2, max: 1 } } }, "where.anger: min 2 is above max 1"],
      [{ top: { by: "team", k: 1 } }, "top: team is a choice question; rank by a score or noul"],
      [{ top: { by: { urgent: 1, nope: 1 }, k: 1 } }, "top: nope is not a question id"],
      [{ top: { by: {}, k: 1 } }, "top: by is empty"],
    ];
    for (const [extra, message] of cases) {
      // eslint-disable-next-line no-await-in-loop -- each case is its own call
      const { result, judge } = await callWithFiles(scoresFile, { files: "scores.txt", items: "lines", questions, ...extra });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toStartWith(`VALIDATION: ${message}`);
      expect(judge.bodies).toHaveLength(0);
    }
  });

  test("a condition that is not a valid shape is refused with its own message", async () => {
    const { result, judge } = await callWithFiles(scoresFile, {
      files: "scores.txt",
      where: { urgent: {} },
      questions: { urgent: urgentQ },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("where.urgent: give at least one of is, min, max, decision");
    expect(judge.bodies).toHaveLength(0);
  });

  test("errors list skipped files first, then records in order, 20 at most, and count the rest", async () => {
    const bad = Array.from({ length: 25 }, () => "{bad").join("\n");
    const { sc } = await callWithFiles(
      { "a.jsonl": `${bad}\n{"x":1}\n{"x":2}`, "z.jsonl": "{}\u0000" },
      { files: "*.jsonl", items: "jsonl", counts: true, questions: { urgent: urgentQ } },
    );
    expect(Object.keys(sc.errors ?? {})).toEqual(["z.jsonl", ...Array.from({ length: 19 }, (_, i) => `a.jsonl:${i + 1}`)]);
    expect(sc.errors?.["z.jsonl"]).toBe("binary file");
    expect(sc.errors?.["a.jsonl:1"]).toBe("invalid JSON");
    expect(sc.more_errors).toBe(6);
    expect(sc).toMatchObject({ total: 2, counts: { urgent: { false: 2 } } });
  });

  test("a record Jev rejects is an error for that record alone", async () => {
    const { sc } = await callWithFiles(
      { "x.log": "fine\nBAD line\nalso fine" },
      { files: "x.log", items: "lines", counts: true, questions: { urgent: urgentQ } },
      { reject: (content) => content.includes("BAD") },
    );
    expect(Object.keys(sc.errors ?? {})).toEqual(["x.log:2"]);
    expect(sc.errors?.["x.log:2"]).toStartWith("INVALID_REQUEST");
    expect(sc).toMatchObject({ total: 2, counts: { urgent: { false: 2 } } });
    expect(sc.more_errors).toBeUndefined();
  });

  test("every record failing is the tool's error", async () => {
    const { result } = await callWithFiles(
      { "x.log": "one\ntwo" },
      { files: "x.log", items: "lines", questions: { urgent: urgentQ } },
      { reject: () => true },
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toStartWith("INVALID_REQUEST");
  });

  test("a records file with nothing to judge gives an empty result, not an error", async () => {
    const { result, sc } = await callWithFiles({ "empty.jsonl": "\n\n" }, { files: "empty.jsonl", items: "jsonl", counts: true, questions: { urgent: urgentQ } });
    expect(result.isError).toBeFalsy();
    expect(sc).toEqual({ total: 0, counts: { urgent: {} } });
  });

  test("csv rows go to Jev as objects keyed by the header, keyed path:line", async () => {
    const { sc, judge } = await callWithFiles(
      { "t.csv": 'id,text\n1,"URGENT, refund"\n2,thanks\n' },
      { files: "t.csv", items: "csv", where: { urgent: true }, questions: { urgent: urgentQ } },
    );
    expect(Object.keys(sc.files ?? {})).toEqual(["t.csv:2"]);
    expect(judge.bodies.map((b) => JSON.stringify(b.state.content)).toSorted()).toEqual([
      '{"id":"1","text":"URGENT, refund"}',
      '{"id":"2","text":"thanks"}',
    ]);
  });

  test("json array items are keyed path[i] and markdown sections path:line", async () => {
    const json = await callWithFiles(
      { "t.json": '[{"text":"URGENT"},"plain"]' },
      { files: "t.json", items: "json", where: { urgent: true }, questions: { urgent: urgentQ } },
    );
    expect(Object.keys(json.sc.files ?? {})).toEqual(["t.json[0]"]);

    const sections = await callWithFiles(
      { "n.md": "# A\nURGENT\n```\n# not a heading\n```\n## B\nfine" },
      { files: "n.md", items: "sections", counts: true, questions: { urgent: urgentQ } },
    );
    expect(sections.sc).toEqual({ total: 2, counts: { urgent: { true: 1, false: 1 } } });
    expect(sections.judge.bodies.map((b) => String(b.state.content)).toSorted()).toEqual(["# A\nURGENT\n```\n# not a heading\n```", "## B\nfine"]);
  });

  test("8 requests are in flight at once, and no more", async () => {
    const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`t${String(i).padStart(2, "0")}.md`, `ticket ${i}`]));
    const questions = { urgent: urgentQ };
    const { result, judge } = await callWithFiles(files, { files: "*.md", counts: true, questions }, { waitFor: 8, delayMs: 5 });
    expect(result.isError).toBeFalsy();
    expect(judge.bodies).toHaveLength(30);
    expect(judge.peak()).toBe(8);
  });
});

describe("jev_ask returns the text of records Jev is unsure about", () => {
  afterEach(() => {
    resetClient();
  });

  test("records with a review or abstain answer come back with their text, so the agent settles them without opening files", async () => {
    const { sc } = await callWithFiles(
      {
        "tickets/a.md": "URGENT payouts failing",
        "tickets/b.md": "maybe urgent x=0.8",
        "tickets/c.md": "hard to say x=0.6",
        "tickets/d.md": "Please update my email",
      },
      { files: "tickets/*.md", questions: { urgent: urgentQ, team: teamQ } },
    );
    expect(Object.keys(sc.files ?? {})).toEqual(["tickets/a.md", "tickets/b.md", "tickets/c.md", "tickets/d.md"]);
    expect(sc.files?.["tickets/b.md"]?.["urgent"]?.decision).toBe("review");
    expect(sc.files?.["tickets/c.md"]?.["urgent"]?.decision).toBe("abstain");
    expect(sc.unsure).toEqual({ "tickets/b.md": "maybe urgent x=0.8", "tickets/c.md": "hard to say x=0.6" });
    expect(sc.more_unsure).toBeUndefined();
  });

  test("an unsure record over the size limit is counted in more_unsure; one that where, top or counts leave out is not", async () => {
    const files = {
      "tickets/a.md": "URGENT payouts failing",
      "tickets/b.md": "maybe x=0.8",
      "tickets/long.md": `x=0.6 ${"a".repeat(MAX_UNSURE_BYTES)}`,
    };
    const all = await callWithFiles(files, { files: "tickets/*.md", questions: { urgent: urgentQ } });
    expect(all.sc.files?.["tickets/long.md"]?.["urgent"]?.decision).toBe("abstain");
    expect(all.sc.unsure).toEqual({ "tickets/b.md": "maybe x=0.8" });
    expect(all.sc.more_unsure).toBe(1);

    const acted = await callWithFiles(files, {
      files: "tickets/*.md",
      where: { urgent: { decision: "act" } },
      questions: { urgent: urgentQ },
    });
    expect(Object.keys(acted.sc.files ?? {})).toEqual(["tickets/a.md"]);
    expect(acted.sc.unsure).toBeUndefined();
    expect(acted.sc.more_unsure).toBeUndefined();

    const top = await callWithFiles(files, { files: "tickets/*.md", top: { by: "urgent", k: 1 }, questions: { urgent: urgentQ } });
    expect(Object.keys(top.sc.files ?? {})).toEqual(["tickets/a.md"]);
    expect(top.sc.unsure).toBeUndefined();

    const counted = await callWithFiles(files, { files: "tickets/*.md", counts: true, questions: { urgent: urgentQ } });
    expect(counted.sc.unsure).toBeUndefined();
    expect(counted.sc.more_unsure).toBeUndefined();
  });

  test(`unsure carries at most ${MAX_UNSURE_TOTAL_BYTES.toLocaleString("en-US")} bytes in all, in result order, and counts the rest`, async () => {
    const size = 1_500;
    const files = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`notes/${String(i).padStart(2, "0")}.md`, `x=0.8 ${"b".repeat(size - 6)}`]),
    );
    const { sc } = await callWithFiles(files, { files: "notes/*.md", questions: { urgent: urgentQ } });
    expect(Object.keys(sc.files ?? {})).toHaveLength(15);
    const kept = Math.floor(MAX_UNSURE_TOTAL_BYTES / size);
    expect(Object.keys(sc.unsure ?? {})).toEqual(Object.keys(files).slice(0, kept));
    expect(sc.more_unsure).toBe(15 - kept);
  });

  test("the limits count UTF-8 bytes, so text in any script costs about the same context", async () => {
    // 600 three-byte characters fit in the limit; 700 do not, though they are well under 2,000 characters.
    const { sc } = await callWithFiles(
      { "notes/a.md": `x=0.6 ${"判".repeat(600)}`, "notes/b.md": `x=0.6 ${"判".repeat(700)}` },
      { files: "notes/*.md", questions: { urgent: urgentQ } },
    );
    expect(Object.keys(sc.unsure ?? {})).toEqual(["notes/a.md"]);
    expect(sc.more_unsure).toBe(1);
  });

  test("a line comes back as written, and a csv row as the JSON Jev saw", async () => {
    const lines = await callWithFiles(
      { "logs/app.log": "URGENT disk full\nmaybe x=0.8\n" },
      { files: "logs/*.log", items: "lines", questions: { urgent: urgentQ } },
    );
    expect(lines.sc.unsure).toEqual({ "logs/app.log:2": "maybe x=0.8" });

    const rows = await callWithFiles(
      { "t.csv": "id,text\n1,URGENT refund\n2,x=0.8 maybe\n" },
      { files: "t.csv", items: "csv", questions: { urgent: urgentQ } },
    );
    expect(rows.sc.unsure).toEqual({ "t.csv:3": '{"id":"2","text":"x=0.8 maybe"}' });
  });
});
