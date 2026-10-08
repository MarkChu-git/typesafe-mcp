import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "@typesafe-ai/sdk";
import { resetClient } from "../src/client.ts";
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
      expect(sent).toBeLessThanOrEqual(4);
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
      // Without cancellation all 20 requests would have gone out by now (5 rounds of 4 × 20 ms).
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
