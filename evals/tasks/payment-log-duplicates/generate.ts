// Deterministic generator for payments.log and gold.json.
// Run: bun run evals/tasks/payment-log-duplicates/generate.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

interface Event {
  at: number;
  seq: number;
  type: string;
  customer: string;
  order: string;
  charge: string;
  amount: string;
  currency: string;
  key: string;
}

const START = Date.parse("2026-09-20T00:00:00.000Z");
const DAY = 86_400_000;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The customers who were charged twice: two or more distinct charge ids succeeded for one order. */
export function affectedCustomers(log: string): string[] {
  const charges = new Map<string, { customer: string; ids: Set<string> }>();
  for (const line of log.split("\n")) {
    const fields = Object.fromEntries(line.split(" ").slice(2).map((kv) => kv.split("=") as [string, string]));
    if (line.split(" ")[1] !== "charge.succeeded" || !fields.order || !fields.charge || !fields.customer) continue;
    const entry = charges.get(fields.order) ?? { customer: fields.customer, ids: new Set<string>() };
    entry.ids.add(fields.charge);
    charges.set(fields.order, entry);
  }
  return [...new Set([...charges.values()].filter((c) => c.ids.size >= 2).map((c) => c.customer))].toSorted();
}

export function generate(): { log: string; gold: { customers: string[] } } {
  const rng = mulberry32(20_261_008);
  const used = new Set<string>();
  const id = (prefix: string, len: number): string => {
    for (;;) {
      const s = prefix + Array.from({ length: len }, () => ALPHABET[Math.floor(rng() * ALPHABET.length)]).join("");
      if (!used.has(s)) {
        used.add(s);
        return s;
      }
    }
  };
  const pick = <T>(xs: readonly T[]): T => {
    const x = xs[Math.floor(rng() * xs.length)];
    if (x === undefined) throw new Error("pick from empty list");
    return x;
  };
  const amount = () => (5 + rng() * 395).toFixed(2);
  const currency = () => pick(["USD", "USD", "USD", "USD", "EUR", "GBP"]);
  const time = () => START + Math.floor(rng() * 13 * DAY);

  const events: Event[] = [];
  const push = (e: Omit<Event, "seq">): Event => {
    const event = { ...e, seq: events.length };
    events.push(event);
    return event;
  };
  const customers = Array.from({ length: 30 }, () => id("cus_", 6));

  const charge = (at: number, customer: string, order: string, amt: string, cur: string, type = "charge.succeeded") => {
    return push({ at, type, customer, order, charge: id("ch_", 10), amount: amt, currency: cur, key: id("idk_", 8) });
  };

  // Normal orders, each with a unique order id.
  for (let i = 0; i < 180; i++) {
    const customer = pick(customers);
    const order = id("ord_", 6);
    const at = time();
    const amt = amount();
    const cur = currency();
    const roll = rng();
    let ok: Event;
    if (roll < 0.08) {
      charge(at, customer, order, amt, cur, "charge.failed");
      ok = charge(at + 60_000 + Math.floor(rng() * 600_000), customer, order, amt, cur);
    } else {
      ok = charge(at, customer, order, amt, cur);
    }
    if (roll > 0.97) push({ ...ok, at: ok.at + 1_000 }); // same charge logged twice: not a double charge
    if (rng() < 0.1) {
      push({ ...ok, type: "refund.created", at: ok.at + DAY + Math.floor(rng() * 3 * DAY), key: id("idk_", 8) });
    }
    if (rng() < 0.05) push({ ...ok, type: "dispute.created", at: ok.at + 2 * DAY + Math.floor(rng() * 5 * DAY) });
  }

  // Same customer, two different orders with the same amount a minute apart: not a double charge.
  for (let i = 0; i < 3; i++) {
    const customer = pick(customers);
    const at = time();
    const amt = amount();
    charge(at, customer, id("ord_", 6), amt, "USD");
    charge(at + 60_000, customer, id("ord_", 6), amt, "USD");
  }

  // Double charges: a second (or third) distinct charge for the same order.
  const planted = customers.filter(() => rng() < 0.5).slice(0, 6);
  planted.forEach((customer, i) => {
    const order = id("ord_", 6);
    const at = time();
    const amt = amount();
    const cur = currency();
    charge(at, customer, order, amt, cur);
    const gap = i === 3 ? 2 * DAY : 60_000 + Math.floor(rng() * 180_000);
    const second = charge(at + gap, customer, order, amt, cur);
    if (i === 5) charge(at + gap + 90_000, customer, order, amt, cur);
    if (i === 6) push({ ...second, type: "refund.created", at: second.at + DAY, key: id("idk_", 8) });
  });

  for (let d = 0; d < 13; d++) {
    for (let k = 0; k < 1; k++) {
      push({
        at: START + d * DAY + 23 * 3_600_000 + k * 60_000,
        type: "payout.paid",
        customer: "-",
        order: "-",
        charge: id("po_", 10),
        amount: (2_000 + rng() * 8_000).toFixed(2),
        currency: ["USD", "EUR", "GBP"][k] ?? "USD",
        key: "-",
      });
    }
  }
  for (let i = 0; i < 20; i++) {
    push({ at: time(), type: "customer.updated", customer: pick(customers), order: "-", charge: "-", amount: "-", currency: "-", key: "-" });
  }

  const log = events
    .toSorted((a, b) => a.at - b.at || a.seq - b.seq)
    .map(
      (e) =>
        `${new Date(e.at).toISOString()} ${e.type} customer=${e.customer} order=${e.order} charge=${e.charge} amount=${e.amount} currency=${e.currency} idempotency_key=${e.key}`,
    )
    .join("\n");
  const customersHit = affectedCustomers(log);
  if (customersHit.join() !== planted.toSorted().join()) throw new Error("generator produced unplanned double charges");
  return { log: `${log}\n`, gold: { customers: customersHit } };
}

if (import.meta.main) {
  const { log, gold } = generate();
  writeFileSync(join(import.meta.dir, "workspace", "payments.log"), log);
  writeFileSync(join(import.meta.dir, "gold.json"), `${JSON.stringify(gold, null, 2)}\n`);
  console.log(`${log.split("\n").length - 1} lines, ${gold.customers.length} affected customers`);
}
