import { describe, expect, test } from "bun:test";
import { META_KEY } from "../../src/result.ts";
import { inProcessClient } from "../helpers/mcp.ts";

const apiKey = process.env.TYPESAFE_API_KEY;

// Live smoke against the real TypeSafe API. The whole file skips without a key:
// `bun run test:integration` in CI or a fresh checkout is a no-op.
describe.skipIf(!apiKey)("live TypeSafe API", () => {
  test(
    "jev_models lists models over the wire",
    async () => {
      const { client, close } = await inProcessClient({
        env: { TYPESAFE_API_KEY: apiKey, TYPESAFE_TOOLS: "models" },
      });
      try {
        const r = await client.callTool({ name: "jev_models", arguments: {} });
        expect(r.isError).toBeFalsy();
        const sc = r.structuredContent as { models: { name: string }[]; default_model: string };
        expect(sc.models.length).toBeGreaterThan(0);
        expect(sc.default_model.length).toBeGreaterThan(0);
      } finally {
        await close();
      }
    },
    30_000,
  );

  test(
    "jev_ask answers a minimal noul question",
    async () => {
      const { client, close } = await inProcessClient({
        env: { TYPESAFE_API_KEY: apiKey },
      });
      try {
        const r = await client.callTool({
          name: "jev_ask",
          arguments: {
            state: "A customer was charged twice and asks for a refund.",
            questions: { billing: { type: "noul", question: "Does this message describe a billing problem?" } },
          },
        });
        expect(r.isError).toBeFalsy();
        const sc = r.structuredContent as { answers: Record<string, { answer: boolean; certainty: number; decision: string }> };
        const a = sc.answers["billing"];
        if (!a) throw new Error("no answer for billing");
        expect(typeof a.answer).toBe("boolean");
        expect(a.certainty).toBeGreaterThanOrEqual(0);
        expect(a.certainty).toBeLessThanOrEqual(1);
        expect(["act", "review", "abstain"]).toContain(a.decision);
        const meta = r._meta?.[META_KEY] as { usage: { input_tokens: number } } | undefined;
        expect(meta?.usage.input_tokens).toBeGreaterThan(0);
      } finally {
        await close();
      }
    },
    30_000,
  );
});
