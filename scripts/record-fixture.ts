#!/usr/bin/env bun
/**
 * Record real TypeSafe API responses into tests/fixtures/.
 *
 * Usage: TYPESAFE_API_KEY=ts_... bun run scripts/record-fixture.ts
 *
 * Each call's response body is written verbatim — headers are never captured.
 * Error fixtures (error.*.json) are hand-written shapes and are NOT recorded here.
 * Review diffs before committing; real responses may contain model/version drift.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { choice, noul, score, TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";

const apiKey = process.env.TYPESAFE_API_KEY?.trim();
if (!apiKey) {
  console.error("record-fixture: TYPESAFE_API_KEY is not set.");
  console.error("Export a real key, then re-run:");
  console.error("  TYPESAFE_API_KEY=ts_... bun run scripts/record-fixture.ts");
  process.exit(1);
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");

let pending: string | undefined;
const recordingFetch: Fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init);
  if (pending) {
    const name = pending;
    pending = undefined;
    const body = (await res.clone().json()) as unknown;
    writeFileSync(join(fixturesDir, name), `${JSON.stringify(body, null, 2)}\n`);
    console.log(`wrote tests/fixtures/${name} (HTTP ${res.status})`);
  }
  return res;
};

const client = new TypeSafeClient({ apiKey, fetch: recordingFetch, logLevel: "warn" });

const state = { ticket: "Help! My payouts have been failing for 3 days." };

pending = "models.ok.json";
await client.models.list();

pending = "check.yes095.json";
await client.systemOne({
  state,
  questions: { q: noul("Does `ticket` convey urgency?") },
});

pending = "check.ambiguous052.json";
await client.systemOne({
  state: "The deployment completed and logs look normal.",
  questions: { q: noul("Does this message convey urgency?") },
});

pending = "classify.billing081.json";
await client.systemOne({
  state,
  questions: {
    q: choice("Which team should handle `ticket`?", {
      billing: "Payments, invoicing, refunds",
      technical: "Bugs, outages, integrations",
      sales: null,
    }),
  },
});

pending = "score.105.json";
await client.systemOne({
  state,
  questions: { q: score("How frustrated is the customer?", ["Calm", "Frustrated", "Very angry"]) },
});

pending = "ask.mixed3.json";
await client.systemOne({
  state,
  questions: {
    urgent: noul("Does `ticket` convey urgency?"),
    dept: choice("Which team should handle `ticket`?", {
      billing: null,
      technical: null,
      sales: null,
    }),
    anger: score("How frustrated is the customer?", ["Calm", "Frustrated", "Very angry"]),
  },
});

console.log("done — review `git diff tests/fixtures/` before committing");
