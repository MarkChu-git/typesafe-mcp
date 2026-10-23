import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { META_KEY } from "../../src/result.ts";
import { png } from "../helpers/images.ts";
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

  test(
    "with TYPESAFE_IMAGES, jev_ask looks at PNG files",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "live-images-"));
      mkdirSync(join(root, "shots"));
      writeFileSync(join(root, "shots", "red.png"), png(400, 300, { rgb: [220, 30, 30] }));
      writeFileSync(join(root, "shots", "blue.png"), png(400, 300, { rgb: [30, 60, 220] }));
      const { client, close } = await inProcessClient({
        env: { TYPESAFE_API_KEY: apiKey, TYPESAFE_FILES_ROOT: root, TYPESAFE_IMAGES: "1" },
      });
      try {
        const r = await client.callTool({
          name: "jev_ask",
          arguments: { files: "shots/*.png", questions: { red: { type: "noul", question: "Is the image in `content` mostly red?" } } },
        });
        expect(r.isError).toBeFalsy();
        const sc = r.structuredContent as { files: Record<string, { red: { answer: boolean } }> };
        expect(sc.files["shots/red.png"]?.red.answer).toBe(true);
        expect(sc.files["shots/blue.png"]?.red.answer).toBe(false);
      } finally {
        await close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test(
    "with TYPESAFE_IMAGES, a box question finds a red square in a PNG",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "live-box-"));
      mkdirSync(join(root, "shots"));
      // 800×600, the square 160 px a side at (200, 100): top .167, bottom .433, left .25, right .45.
      const square = { left: 200, top: 100, width: 160, height: 160, rgb: [220, 30, 30] as const };
      writeFileSync(join(root, "shots", "square.png"), png(800, 600, { rect: square }));
      const { client, close } = await inProcessClient({
        env: { TYPESAFE_API_KEY: apiKey, TYPESAFE_FILES_ROOT: root, TYPESAFE_IMAGES: "1" },
      });
      try {
        const r = await client.callTool({
          name: "jev_ask",
          arguments: {
            files: "shots/square.png",
            questions: {
              there: { type: "noul", question: "Is there a red square in `content`?" },
              square: { type: "box", question: "the red square in `content`" },
            },
          },
        });
        expect(r.isError).toBeFalsy();
        type Edges = { top: number; bottom: number; left: number; right: number };
        const sc = r.structuredContent as { files: Record<string, { there: { answer: boolean }; square: { answer: Edges; certainty: number } }> };
        const answers = sc.files["shots/square.png"];
        if (!answers) throw new Error("no answers for shots/square.png");
        expect(answers.there.answer).toBe(true);
        // Within 0.05 of each true edge: 30–40 px here.
        expect(answers.square.answer.top).toBeCloseTo(100 / 600, 1);
        expect(answers.square.answer.bottom).toBeCloseTo(260 / 600, 1);
        expect(answers.square.answer.left).toBeCloseTo(200 / 800, 1);
        expect(answers.square.answer.right).toBeCloseTo(360 / 800, 1);
        expect(answers.square.certainty).toBeGreaterThan(0);
      } finally {
        await close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
