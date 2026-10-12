// Deterministic generator for the refund-promises-audit workspace and gold.json.
// Run: bun run evals/tasks/refund-promises-audit/generate.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Kind = "V" | "A" | "S" | "D" | "H" | "N";
type Role = "Customer" | "Agent";
type Slots = Record<string, string>;

interface Msg {
  role: Role;
  text: string;
}

interface Staff {
  agent: string;
  team: string;
  team_lead: string;
}

/** Facts a scenario needs. Fields a kind does not use keep their defaults. */
interface Variant {
  cents: number;
  refundAsk: boolean;
  refundWord: boolean | null;
  nearMiss: boolean;
  nearLead: boolean;
  unrelated: boolean;
  supervisorNote: boolean;
  promiseAt: number;
  approvalAt: number | null;
  history: "a" | "b" | "c" | null;
  issued: boolean;
}

interface Plan {
  kind: Kind;
  ticket: string;
  staff: Staff;
  customer: string;
  first: string;
  company: string;
  acct: number;
  channel: "chat" | "email";
  day: number;
  startMin: number;
  opener: string;
  slots: Slots;
  v: Variant;
}

interface Violation {
  ticket: string;
  agent: string;
  amount: number;
  team_lead: string;
  issued: boolean;
}

interface Gold {
  violations: Violation[];
  total_by_lead: { team_lead: string; amount: number }[];
}

const SEED = 20_261_012;
const COUNTS: Record<Kind, number> = { V: 11, A: 9, S: 10, D: 16, H: 10, N: 44 };
const KINDS: Kind[] = ["V", "A", "S", "D", "H", "N"];
const LEDGER_ROWS = 250;

const NO_VARIANT: Variant = {
  cents: 0,
  refundAsk: false,
  refundWord: null,
  nearMiss: false,
  nearLead: false,
  unrelated: false,
  supervisorNote: false,
  promiseAt: 0,
  approvalAt: null,
  history: null,
  issued: false,
};

const TEAMS = [
  { team: "Billing Desk", lead: "Dana Whitfield", agents: ["Priya Shah", "Jonah Reyes", "Hannah Okafor"] },
  { team: "Account Care", lead: "Marcus Lee", agents: ["Liam Carter", "Mei Lin", "Samuel Adeyemi"] },
  { team: "Order Support", lead: "Elena Ruiz", agents: ["Grace Kim", "Ravi Patel", "Chloe Martin"] },
  { team: "Enterprise", lead: "Tomas Brandt", agents: ["Diego Alvarez", "Nadia Haddad", "Ben Sato"] },
];
const STAFF: Staff[] = TEAMS.flatMap((t) => t.agents.map((agent) => ({ agent, team: t.team, team_lead: t.lead })));
// Staff indexes ordered so the first four violations cover all four teams.
const V_STAFF_ORDER = [0, 3, 6, 9, 1, 4, 7, 10, 2, 5, 8];

const FIRST_NAMES = [
  "Jordan", "Alex", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew",
  "Robin", "Parker", "Reese", "Kendall", "Skyler", "Harper", "Rowan", "Emerson", "Finley", "Sawyer",
  "Dakota", "Blake", "Logan", "Hayden", "Peyton", "Devin", "Lane", "Marlow", "Sloan", "Wren",
];
const LAST_NAMES = [
  "Pike", "Novak", "Brooks", "Fenwick", "Hart", "Moreau", "Okonkwo", "Lindqvist", "Ferreira", "Dunn",
  "Castellano", "Whitaker", "Tanaka", "Greer", "Abbott", "Kowalski", "Mensah", "Sorensen", "Vance", "Hollis",
  "Duarte", "Ilunga", "Brennan", "Caruso", "Fairweather", "Nakamura", "Osei", "Prentice", "Quiroga", "Rademaker",
];
const COMPANIES = [
  "Brightline Foods", "Mapleworks Ltd", "Quarry Street Clinic", "Tidewater Analytics",
  "Kettle Lane Coffee", "Summit Freight Co", "Larkspur Dental", "Foxglove Studio",
];
const PRODUCTS = [
  "Team dashboard", "analytics add-on", "mobile app", "API workspace",
  "SSO connector", "export tool", "reporting module", "priority support plan",
];
const PLANS = ["Starter", "Team", "Professional", "Enterprise"];
const BROWSERS = ["Chrome 128", "Firefox 131", "Safari 18", "Edge 130"];
const SYSTEMS = ["macOS 15.1", "Windows 11", "Ubuntu 24.04", "iOS 18.2"];
const DATES = ["August 14", "August 28", "September 1", "September 2", "last Friday", "Tuesday morning"];
const SUBJECTS = [
  "Login problem with the {product}",
  "Question about my {plan} invoice",
  "Import errors this week",
  "Shipping address update",
  "Renewal date change",
  "Duplicate webhook deliveries",
];

const POLICY = `# Refund policy for support agents

Effective 1 September 2026. This applies to every chat and email conversation.

## What counts as a promise

A promise is anything a support agent says that gets the customer money back. That includes a refund, a credit back to the card, a charge reversal, or money returned in any other form, whatever the wording. Passing a refund request to billing without promising an outcome is not a promise.

Store credit, discounts and coupons are not refunds.

## Limits

Agents may promise or issue refunds of up to $200 on their own.

A promise above $200 needs a supervisor approval recorded in the same conversation. The record must name the supervisor together with the word "approved", "approval" or "signed off", or give an approval reference such as APR-4471. An approval given in another conversation does not count.

A promise of exactly $200 is allowed.

If an approval is needed and none is recorded, do not promise the amount. Tell the customer the request is with billing or a supervisor and that the outcome is not yet decided.
`;

function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`index ${i} is out of range`);
  return x;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Rand {
  int: (lo: number, hi: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  chance: (p: number) => boolean;
  shuffle: <T>(xs: readonly T[]) => T[];
}

function makeRand(seed: number): Rand {
  const next = mulberry32(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      const held = at(out, i);
      out[i] = at(out, j);
      out[j] = held;
    }
    return out;
  };
  return {
    int,
    pick: <T>(xs: readonly T[]): T => at(xs, int(0, xs.length - 1)),
    chance: (p: number): boolean => next() < p,
    shuffle,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const clock = (min: number): string => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
const isoAt = (day: number, min: number, sec: number): string => `2026-09-${pad2(day)}T${clock(min)}:${pad2(sec)}Z`;
const asc = (a: string, b: string): number => (a < b ? -1 : Number(a > b));

/** Whole-dollar grouping with cents, for invoice tables. */
function usd(cents: number): string {
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${pad2(cents % 100)}`;
}

/** Promised amounts appear in four formats: "$260", "$260.00", "USD 260", "US$260.00". */
function money(cents: number, style: number): string {
  const whole = Math.floor(cents / 100);
  const cent = cents % 100;
  switch (style) {
    case 0:
      return cent === 0 ? `$${whole}` : `$${whole}.${pad2(cent)}`;
    case 1:
      return `$${whole}.${pad2(cent)}`;
    case 2:
      return cent === 0 ? `USD ${whole}` : `USD ${whole}.${pad2(cent)}`;
    default:
      return `US$${whole}.${pad2(cent)}`;
  }
}

function fill(template: string, slots: Slots): string {
  return template.replace(/\{(\w+)\}/g, (_match: string, key: string) => {
    const value = slots[key];
    if (value === undefined) throw new Error(`no value for {${key}}`);
    return value;
  });
}

const CUSTOMER_OPEN = [
  "Hi there, I need help with my account. Something changed after the last update and I can't finish my work.",
  "Hello, I'm writing about the {product}. It isn't behaving the way it did last month.",
  "Good morning. I have a few questions about our {plan} plan and the {product}.",
  "Hi, I think there's a problem with the {product} on our side. Can you take a look?",
  "Hello again. I was told chat would be faster than email, so here I am with the issue.",
  "Hi, we set up the {product} last week and a few things are off. Can we go through them?",
  "Hey, our admin can't see the reports tab. I'd like this sorted out today if possible.",
];

const AGENT_OPEN = [
  "Thanks for reaching out, {first}. I'm happy to help. Could you tell me the email address on the account first?",
  "Hello {first}, I've got your message. Let me pull up the account before we start.",
  "Thanks for the patience, {first}. I'll take a look now and walk through each item with you.",
];

const AGENT_GREET = ["Hi {first},", "Hello {first},"];



interface Topic {
  customer: string[];
  agent: string[];
  pastes: Paste[];
}

const BILLING: Topic = {
  customer: [
    "We added {seats} seats last month and the invoice total looks higher than I expected. The September line for seats reads {invoiceAmt}.",
    "Could you confirm which plan is on the account right now? The last invoice says {plan} and the portal says something else.",
    "Can you move my renewal date to the first of the month? I'd rather not pay mid-cycle.",
    "I'd like to move from {plan} to a smaller plan at the end of this billing period.",
    "We need the September invoice split by cost center, not one lump sum.",
    "Please don't mail the paper invoice to the old office. It closed in June.",
    "The seat count went up after the import. Is that expected?",
    "It's a small thing, but the footer on our invoices still shows the old company name.",
  ],
  agent: [
    "Let me pull up the invoices for the last two cycles and walk you through the line items.",
    "I've moved your renewal date to the 1st. The next invoice will show a prorated line for the difference.",
    "Your plan change takes effect on the next billing date, so nothing changes today.",
    "I've split the invoice by cost center. The new copy is attached to the account.",
    "For the {plan} plan the monthly seat minimum is four, so the change takes effect next cycle.",
    "Here is the September invoice breakdown so you can match it against your purchase order.",
    "I can see the seat count changed on {date}. That matches the import you ran.",
    "I've made a note on the account about the contact change, so nothing else is needed from you.",
  ],
  pastes: [invoiceTable, invoiceTable, jsonPayload],
};

/** Background subjects. Each customer line gets a reply on the same subject, so the filler reads as a conversation. */
const TOPICS: Topic[] = [
  {
    customer: [
      "The {product} keeps logging me out every few minutes. I'm on {browser} on {system}.",
      "My verification email never arrived, even after I checked my spam folder twice.",
      "My colleague says SSO worked for her but not for me. Any idea why?",
      "That fixed the login problem, thank you. One more thing about the billing contact.",
      "The button is greyed out even though I'm an admin. Screenshot is in my last message.",
      "Please add {colleague} to the admin group if that's possible.",
      "Could you resend the onboarding guide? The link in the welcome email is dead.",
    ],
    agent: [
      "I can see the session timing out after {mins} minutes of inactivity on your workspace.",
      "To verify the account, I need the billing contact's email address. Could you confirm it?",
      "I've reset the SSO mapping on our side. Please sign out and try again in a fresh window.",
      "Let's start with the browser. Please try a private window and tell me whether the error still appears.",
      "I've added {colleague} to the admin group. They should see the settings menu after a refresh.",
      "Could you send a screenshot of the error banner? The text is cut off in the copy you pasted.",
      "Glad that fixed it. I'll leave the ticket open for another day in case the issue comes back.",
    ],
    pastes: [stackTrace, serverLog],
  },
  BILLING,
  BILLING,
  {
    customer: [
      "Our shipping address changed, so please update it before the next box goes out.",
      "Where is order {order}? The tracking page has said 'label created' for three days.",
      "Can you check the status of my ticket for order {order}? I opened it last Friday.",
      "The box for order {order} still hasn't arrived and the tracking hasn't moved.",
      "Could you tell me whether the carrier has the parcel? Order {order} is for our office.",
      "The label says delivered but nothing arrived at the front desk.",
    ],
    agent: [
      "The tracking shows the parcel at the regional hub. Carriers usually scan again within a day.",
      "I've updated the shipping address. The next box ships on Monday.",
      "The shipment for order {order} was scanned at the sorting center this morning.",
      "The shipping label was created on the 2nd and the carrier has the package now.",
      "I can see the order and the label. The carrier expects the next scan within 24 hours.",
      "The carrier shows a delivery attempt that was not logged at your address. I've opened a trace with them.",
      "I've asked the carrier to recheck the delivery scan. You should hear from me by tomorrow.",
    ],
    pastes: [shippingDetails, httpDump],
  },
  {
    customer: [
      "Quick question about the API rate limit. Is it counted per key or per workspace?",
      "The webhook seems to fire twice for the same order. Here is the body from the second delivery.",
      "I just read the new release notes. Does the update change anything about our integrations?",
      "I'm not sure whether the sandbox key or the live key is the one in our config file.",
      "I think I found the cause. An old cron entry was still pointing at the staging server.",
    ],
    agent: [
      "The rate limit is per API key. Each key gets 600 requests a minute on your current plan.",
      "Thanks for the HTTP dump. The retry header is set to 0, which explains the duplicate delivery.",
      "Your release notes mention a new webhook version, but your integration is pinned to the current one, so it's unaffected.",
      "Please try the sandbox key first so we can rule out the config file.",
      "I looked at the webhook configuration. The endpoint responded with a 504 on two attempts.",
      "That's a good catch on the stale cron entry. I've asked our ops team to remove it.",
    ],
    pastes: [jsonPayload, httpDump, configSnippet],
  },
  {
    customer: [
      "I think the sync job runs in the wrong time zone. The timestamps are an hour off.",
      "We run the nightly job at {mins} past midnight. Could the window move later?",
      "Can you confirm that the nightly backup still includes the {product} data?",
      "The sync keeps retrying the same batch. Is there a limit on retries?",
    ],
    agent: [
      "I've checked the time zone setting on your workspace. It is set to UTC, so the timestamps should match your logs.",
      "I checked the logs and the webhook received two deliveries with different event ids. I'm sending that to engineering as a bug report.",
      "Yes, the nightly backup includes the {product} data. You can confirm that in the backup tab.",
      "The sync settings are on the admin page. I can set the retry limit to three for you if you'd like.",
      "Could you try once more and tell me the exact time it failed? That will help me match the logs.",
    ],
    pastes: [serverLog, configSnippet, sqlError],
  },
  {
    customer: [
      "The export job has been stuck at 47 percent since yesterday morning.",
      "The CSV import rejects any row with a trailing space in the email column.",
      "The mobile app crashes when I open a report with more than {n} columns.",
      "I keep getting a 502 on the reports page whenever I filter by region.",
      "The chart legend overlaps the bars on small screens.",
      "How long do exports stay available for download? Our team wants to save a copy.",
      "Does the {product} support keyboard shortcuts? I couldn't find a list anywhere.",
    ],
    agent: [
      "Exports stay available for 30 days. After that you'd need to generate a new one.",
      "The export is ready. The download link is valid until the end of the month.",
      "Thanks for the screenshot. The overlap happens below 900 pixels, which our design team is tracking.",
      "Our status page shows no incidents for the {product} today, so this looks specific to your account.",
      "I'm checking whether the {product} supports keyboard shortcuts. I'll get back to you within the hour.",
      "Sorry to hear it came back. I'll look at the cache layer next and keep you posted.",
      "Could you paste the full stack trace from the browser console? That will show where the 502 starts.",
    ],
    pastes: [stackTrace, serverLog],
  },
  {
    customer: [
      "Our security team asked whether the audit logs stay in the EU. Can you check?",
      "Would it be possible to get a copy of the data processing agreement?",
      "Please keep my contact details the same. The phone number on file is still correct.",
      "We need to know how long exports and audit logs are kept for our records.",
      "Can you send the list of sub-processors for our vendor review?",
      "Does your SSO connector support SCIM provisioning for our directory?",
      "Please confirm the retention period for deleted user records.",
    ],
    agent: [
      "The audit logs are stored in the EU region for accounts on your plan. I'll confirm that for your security team in writing.",
      "The data processing agreement is on our site under legal documents. I've also emailed you a copy.",
      "I've noted the phone number on file. No changes needed.",
      "Logs are kept for 90 days on your plan, and exports are kept for 30. I'll put that in the case notes.",
      "The sub-processor list is on the trust page, and I've sent you the link directly.",
      "SCIM provisioning is supported on the Enterprise plan. I've linked the setup guide in the case.",
      "Deleted user records are removed after 30 days. I'll add that to the case notes.",
    ],
    pastes: [],
  },
  {
    customer: [
      "Sorry for the late reply. I was in meetings all morning.",
      "I'm traveling until Thursday, so email works better than phone for me.",
      "Thanks for the quick response. I'll test it this afternoon and let you know how it goes.",
      "Happy with the answer. Please close the ticket once the update is live.",
      "Thanks, that helps. I'll wait for the update and check again tomorrow.",
      "Hello again. The problem came back after lunch, so the fix may not be permanent.",
      "Thanks. The dashboard numbers look right now that the cache is cleared.",
    ],
    agent: [
      "Thanks for your patience while I went through the account history.",
      "Have a good weekend. I'll be on the queue Monday morning if anything changes.",
      "Thanks for confirming. I've marked the ticket as waiting on your test.",
      "Please keep the old key until the new one is confirmed working.",
      "Thanks. I'll close the ticket after the update is live and you've confirmed it works.",
      "Thanks, {first}. Let me know how the test goes and I'll adjust the setup if needed.",
    ],
    pastes: [],
  },
];

const LEAD_INS = [
  "I've checked the order history.",
  "Thanks for waiting while I reviewed the case.",
  "I've looked through the case notes.",
  "I've been through the account activity.",
];

/** Promise phrasings. About half avoid the word "refund" on purpose. */
const PROMISES = [
  "I've issued a refund of {amt} to your card.",
  "I'll refund the {amt} today.",
  "I can confirm a refund of {amt} for this order.",
  "I'm processing a full refund of {amt} on this order now.",
  "The refund for {amt} goes back to your original payment method.",
  "You'll see {amt} back on your original payment method in 5-7 business days.",
  "I'm reversing the {amt} charge now.",
  "I've credited back the full {amt}.",
  "Consider it done: {amt} is on its way back to you.",
  "I'll make sure you're reimbursed the {amt}.",
  "We'll return {amt} to your account by Friday.",
  "The {amt} will be put back on your card.",
  "I've put {amt} back on the card you paid with.",
  "Your {amt} is going back to the card on file today.",
  "I'm sending the {amt} back to your bank account now.",
];

const ASK_REFUND = [
  "Can I get a refund for the {product}? It has not worked since {date}.",
  "I'd like a refund of {amt}. The {product} was broken for most of August.",
  "Please process a refund for order {order}. The {product} never matched what we bought.",
  "We need a refund started today for the {product}. Can you help with that?",
];

const ASK_MONEY = [
  "Please get my money back for the {product}. It has not worked since {date}.",
  "Could you send the {amt} back to my card? The {product} was broken for most of August.",
  "I want the payment for order {order} reversed. The {product} never matched what we bought.",
  "Can you return the {product} charge to my account? It never worked for our team.",
];

const ASK_DECLINED = [
  "I want a refund of {amt} for the annual plan I bought in August. It doesn't match what we were sold.",
  "Please refund the full {amt}. Our team is cutting seats and I don't need this one anymore.",
  "Refund request: {amt} for order {order}, because the feature was removed without notice.",
  "Can I get a refund on the {product}? It's been a month and it still doesn't do what the demo showed.",
];

const DECLINE = [
  "I'm not able to refund that amount myself. I can offer a {credit} store credit on your account instead, and it works on any plan.",
  "I've passed your refund request to billing; they'll decide within 3 business days.",
  "I can add a 30% coupon to your next renewal instead, but I can't promise a refund on this one.",
  "I can't promise a refund on this one, but I've flagged the case for billing review.",
  "That amount is above what I can authorize, so I've sent the request to billing and they'll reply on this thread.",
  "A store credit of {credit} is what I can do today, and store credit can be used on any plan.",
];

const SUPERVISOR_NOTE = "I'll check with my supervisor before I say anything about the amount.";

const RESTATE = [
  "Just confirming the {amt} we agreed on, so you have it in writing.",
  "To recap, {amt} is the figure on this case and nothing else is pending from my side.",
  "I've added a note with the {amt} so it's on the record for your account.",
];

/** Near misses in violations: the agent mentions a supervisor or lead, but no approval is ever recorded. */
const NEAR_PRE = [
  "This is more than I can settle on my own, so I'll check with my supervisor first.",
  "I need to loop in my team lead before I can confirm an amount this large.",
  "Let me check with my supervisor on the figure and get back to you shortly.",
];

const NEAR_POST = [
  "I'll let my team lead know what we agreed, so nothing gets lost.",
  "I'm going to loop in my supervisor on this so they're aware of the case.",
];

const NEAR_LEAD = "I'll check with my lead on the case notes before I finalize.";

/** "approved" used in an unrelated sense: no supervisor, no approval reference. */
const UNRELATED = [
  "Good news: your plan upgrade was approved this morning, so the extra seats are live.",
  "The address change is approved, and the next box ships to the new address on Monday.",
  "Your billing contact update was approved by our system overnight.",
];

/** Approvals in approved conversations. Each names a team lead or gives an APR reference. */
const APPROVALS = [
  "Supervisor Dana Whitfield approved this refund (APR-4471).",
  "Quick update: my team lead Marcus Lee signed off on the full amount.",
  "Approval reference APR-5520 is now on your case.",
  "I have written approval from my supervisor, Elena Ruiz, for this.",
  "Tomas Brandt, our enterprise lead, has approved the full amount. Reference APR-6013.",
  "Dana Whitfield signed off on this just now.",
  "My team lead, Elena Ruiz, approved the higher amount this afternoon.",
  "Approval from Marcus Lee is recorded under APR-4790.",
  "Supervisor Tomas Brandt signed off on this. The reference is APR-5108.",
  "Elena Ruiz has approved this one in writing (APR-6244).",
  "Dana Whitfield gave her approval for the full amount, APR-3917.",
];

const H_EARLIER_ASK = "I'm checking on the {amt} refund from August 14. My bank statement still doesn't show it.";
const H_EARLIER_ANS =
  "The {amt} refund from August 14 already shows as completed on our side. Banks usually post it within 5 to 7 business days, so give it a few more days.";
const H_POLICY_ASK = "What's your refund policy for annual plans? I'm thinking about upgrading and want to know what I can ask for.";
const H_POLICY_ANS =
  "Agents can issue refunds of up to $200 on their own. Anything above that needs a supervisor's approval recorded on the case before anyone can promise it. Annual plans follow the same rule.";
const H_OTHER_ASK = "{colleague} from your chat team told me last week I'd get a refund of {amt}. Can you confirm that?";
const H_OTHER_ANS = "I don't see that promise in your history, so I can't confirm it. I can check the case notes with you, though.";

const APPROVAL_PLACEMENTS = [
  { promiseAt: 15, approvalAt: 3 },
  { promiseAt: 5, approvalAt: 17 },
  { promiseAt: 15, approvalAt: 3 },
  { promiseAt: 5, approvalAt: 17 },
  { promiseAt: 7, approvalAt: 5 },
  { promiseAt: 5, approvalAt: 7 },
  { promiseAt: 7, approvalAt: 5 },
  { promiseAt: 5, approvalAt: 7 },
  { promiseAt: 7, approvalAt: 5 },
];

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const token = (r: Rand, len: number): string =>
  Array.from({ length: len }, () => ALNUM.charAt(r.int(0, ALNUM.length - 1))).join("");
const fence = (body: string): string => "```\n" + body + "\n```";

const ITEMS = [
  "Team seat (monthly)", "Priority support add-on", "Storage overage (GB)", "API calls block",
  "Onboarding session", "SSO connector", "Audit log retention", "Analytics add-on",
];

function stackTrace(r: Rand): string {
  const fn = r.pick(["buildLineItem", "renderInvoice", "syncSeats", "exportRows", "applyPlanChange"]);
  const file = r.pick(["src/billing/lines.js", "src/api/exports.js", "src/sync/seats.js", "src/plans/change.js"]);
  const field = r.pick(["sku", "seats", "period_end", "unit_price"]);
  return fence(
    [
      `TypeError: Cannot read properties of undefined (reading '${field}')`,
      `    at ${fn} (/srv/app/${file}:${r.int(40, 240)}:${r.int(5, 40)})`,
      "    at Array.map (<anonymous>)",
      `    at handle (/srv/app/src/api/${r.pick(["invoices", "accounts", "exports"])}.js:${r.int(10, 90)}:${r.int(5, 30)})`,
      "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ].join("\n"),
  );
}

function jsonPayload(r: Rand, s: Slots): string {
  const seats = r.int(3, 40);
  const cents = seats * 4900;
  const body = {
    id: `evt_${token(r, 14)}`,
    type: r.pick(["invoice.paid", "invoice.finalized", "subscription.updated"]),
    created: 1_787_000_000 + r.int(0, 900_000),
    data: {
      object: {
        id: `in_${token(r, 12)}`,
        customer: `cus_${token(r, 8)}`,
        currency: "usd",
        amount_paid: cents,
        description: s.product,
        lines: { data: [{ quantity: seats, amount: cents }] },
      },
    },
  };
  return fence(JSON.stringify(body, null, 2));
}

function httpDump(r: Rand, s: Slots): string {
  return fence(
    [
      `POST /v2/orders/${s.order}/shipping HTTP/1.1`,
      "Host: api.harbor-vale.example",
      "Content-Type: application/json",
      "Authorization: Bearer [redacted]",
      `X-Request-Id: ${token(r, 16)}`,
      "",
      `{"address":{"line1":"${r.int(10, 990)} Quay Road","city":"Millbrook","postal_code":"${r.int(10_000, 99_999)}"},"notify":true}`,
      "",
      `HTTP/1.1 ${r.pick(["200 OK", "202 Accepted", "409 Conflict"])}`,
      `X-Ratelimit-Remaining: ${r.int(0, 600)}`,
      `Retry-After: ${r.pick(["0", "5", "30"])}`,
    ].join("\n"),
  );
}

function invoiceTable(r: Rand): string {
  const rows = Array.from({ length: r.int(3, 5) }, () => ({
    label: r.pick(ITEMS),
    qty: r.int(1, 12),
    unit: r.int(900, 26_000),
  }));
  let subtotal = 0;
  for (const row of rows) subtotal += row.qty * row.unit;
  const tax = Math.round(subtotal * 0.08);
  const summary = (label: string, cents: number): string => `${label.padEnd(47)}${usd(cents).padStart(14)}`;
  return fence(
    [
      `Invoice INV-2026-09-${r.int(1000, 9999)}`,
      `${"Item".padEnd(28)}${"Qty".padStart(5)}${"Unit".padStart(14)}${"Amount".padStart(14)}`,
      ...rows.map(
        (row) =>
          `${row.label.padEnd(28)}${String(row.qty).padStart(5)}${usd(row.unit).padStart(14)}${usd(row.qty * row.unit).padStart(14)}`,
      ),
      summary("Subtotal", subtotal),
      summary("Tax (8%)", tax),
      summary("Total", subtotal + tax),
    ].join("\n"),
  );
}

function shippingDetails(r: Rand, s: Slots): string {
  const day = r.int(1, 3);
  return fence(
    [
      `Order: ${s.order}`,
      `Carrier: ${r.pick(["Harbor Post", "Northline Freight", "Ferro Parcel"])}`,
      `Tracking: HP${r.int(100_000_000, 999_999_999)}`,
      `Service: ${r.pick(["Ground", "Two-day", "Overnight"])}`,
      `Estimated delivery: September ${r.int(4, 25)}`,
      "Events:",
      `  2026-09-0${day} ${clock(r.int(480, 1000))}  label created`,
      `  2026-09-0${day + 1} ${clock(r.int(480, 1000))}  arrived at sorting facility`,
      `  2026-09-0${day + 2} ${clock(r.int(480, 1000))}  out for delivery`,
    ].join("\n"),
  );
}

function serverLog(r: Rand): string {
  const lines: string[] = [];
  let minute = r.int(480, 900);
  const count = r.int(6, 9);
  for (let i = 0; i < count; i++) {
    minute += r.int(0, 3);
    const level = r.pick(["INFO", "INFO", "WARN", "ERROR"]);
    const worker = `sync-${r.int(1, 4)}`;
    const msg = r.pick([
      `step=upload bytes=${r.int(10_000, 900_000)}`,
      `retry=${r.int(1, 3)} backoff_ms=${r.int(200, 8000)}`,
      "timeout after 30000ms waiting for ack",
      `acked event_id=evt_${token(r, 12)}`,
      `queued batch=${r.int(100, 999)} size=${r.int(10, 400)}`,
    ]);
    lines.push(`2026-09-0${r.int(1, 9)}T${clock(minute)}:${pad2(r.int(0, 59))}Z ${level} worker=${worker} ${msg}`);
  }
  return fence(lines.join("\n"));
}

function configSnippet(r: Rand): string {
  return fence(
    [
      "sync:",
      `  interval_minutes: ${r.pick(["5", "10", "15", "30"])}`,
      `  retry_limit: ${r.int(2, 6)}`,
      "  endpoint: https://hooks.harbor-vale.example/v1/events",
      `  timezone: ${r.pick(["UTC", "Europe/London", "America/New_York"])}`,
      `  batch_size: ${r.pick(["50", "100", "250"])}`,
    ].join("\n"),
  );
}

function sqlError(r: Rand): string {
  const account = r.int(10_000, 99_999);
  return fence(
    [
      'ERROR:  duplicate key value violates unique constraint "seats_account_id_key"',
      `DETAIL:  Key (account_id)=(${account}) already exists.`,
      `STATEMENT:  INSERT INTO seats (account_id, email) VALUES (${account}, 'ops+${token(r, 6)}@harbor-vale.example')`,
    ].join("\n"),
  );
}

type Paste = (r: Rand, s: Slots) => string;

function slotsFor(r: Rand, first: string): Slots {
  return {
    first,
    product: r.pick(PRODUCTS),
    plan: r.pick(PLANS),
    browser: r.pick(BROWSERS),
    system: r.pick(SYSTEMS),
    date: r.pick(DATES),
    order: `SO-${r.int(100_000, 999_999)}`,
    colleague: r.pick(FIRST_NAMES),
    mins: r.pick(["10", "15", "20", "30"]),
    seats: String(r.int(4, 60)),
    n: String(r.int(3, 40)),
    invoiceAmt: usd(r.int(9_000, 180_000)),
  };
}

function agentSignature(p: Plan): string {
  return `${p.staff.agent}\n${p.staff.team}, Harbor & Vale Support`;
}

/** Marks that this conversation already quoted its opening email. */
const QUOTE = "<quote>";

/** A template not yet used in this conversation, when the pool allows one. */
function freshPick(r: Rand, pool: readonly string[], used: Set<string>): string {
  let line = r.pick(pool);
  for (let tries = 0; tries < 8 && used.has(line); tries++) line = r.pick(pool);
  used.add(line);
  return line;
}

/** Background message at index i. Even indexes are customers, odd ones are agents, both on the given topic. */
function filler(p: Plan, i: number, r: Rand, topic: Topic, used: Set<string>): Msg {
  if (i === 0) {
    const subject = p.channel === "email" ? `Subject: ${fill(r.pick(SUBJECTS), p.slots)}\n\n` : "";
    return { role: "Customer", text: subject + p.opener };
  }
  if (i === 1) return { role: "Agent", text: fill(r.pick(AGENT_OPEN), p.slots) };
  const customer = i % 2 === 0;
  let text = fill(freshPick(r, customer ? topic.customer : topic.agent, used), p.slots);
  if (!customer && r.chance(0.3)) text = `${fill(r.pick(AGENT_GREET), p.slots)}\n${text}`;
  if (topic.pastes.length > 0 && r.chance(0.4)) text += `\n\n${r.pick(topic.pastes)(r, p.slots)}`;
  if (p.channel === "email") {
    if (!customer && r.chance(0.5)) text += `\n\n${agentSignature(p)}`;
    if (customer && r.chance(0.3)) text += `\n\n-- \n${p.customer}\n${p.company}`;
    if (customer && i > 4 && !used.has(QUOTE) && r.chance(0.2)) {
      used.add(QUOTE);
      text = `On Sep ${p.day}, 2026, ${p.customer} wrote:\n> ${p.opener.replaceAll("\n", "\n> ")}\n\n${text}`;
    }
  }
  return { role: customer ? "Customer" : "Agent", text };
}

interface Beats {
  planned: Map<number, Msg>;
  /** The promise sentence as written, without the lead-in. Null when the kind makes no promise. */
  sentence: string | null;
}

function promiseFor(refundWord: boolean | null, r: Rand): string {
  return r.pick(PROMISES.filter((t) => refundWord === null || /refund/i.test(t) === refundWord));
}

/** Scenario messages at fixed indexes; background filler fills everything else. */
function beats(p: Plan, r: Rand): Beats {
  const v = p.v;
  const planned = new Map<number, Msg>();
  const say = (i: number, role: Role, text: string): void => {
    planned.set(i, { role, text });
  };
  const restate = (i: number): void => {
    if (r.chance(0.3)) say(i, "Agent", fill(r.pick(RESTATE), { ...p.slots, amt: money(v.cents, r.int(0, 3)) }));
  };
  let sentence: string | null = null;
  switch (p.kind) {
    case "V":
    case "A":
    case "S": {
      say(2, "Customer", fill(r.pick(v.refundAsk ? ASK_REFUND : ASK_MONEY), p.slots));
      sentence = fill(promiseFor(v.refundWord, r), p.slots);
      const lead = r.chance(0.6) ? `${r.pick(LEAD_INS)} ` : "";
      say(v.promiseAt, "Agent", lead + sentence);
      if (v.approvalAt !== null) say(v.approvalAt, "Agent", r.pick(APPROVALS));
      if (v.nearMiss) {
        say(3, "Agent", r.pick(NEAR_PRE));
        say(9, "Agent", r.pick(NEAR_POST));
      }
      if (v.nearLead) say(3, "Agent", NEAR_LEAD);
      if (v.unrelated) say(p.kind === "V" ? 11 : 9, "Agent", r.pick(UNRELATED));
      restate(v.promiseAt + 8);
      break;
    }
    case "D": {
      say(2, "Customer", fill(r.pick(ASK_DECLINED), p.slots));
      const declines = r.shuffle(DECLINE);
      say(3, "Agent", fill(at(declines, 0), p.slots));
      say(5, "Agent", fill(at(declines, 1), p.slots));
      if (v.supervisorNote) say(7, "Agent", SUPERVISOR_NOTE);
      break;
    }
    case "H": {
      if (v.history === "a") {
        say(2, "Customer", fill(H_EARLIER_ASK, p.slots));
        say(3, "Agent", fill(H_EARLIER_ANS, p.slots));
      } else if (v.history === "b") {
        say(2, "Customer", H_POLICY_ASK);
        say(3, "Agent", H_POLICY_ANS);
      } else {
        say(2, "Customer", fill(H_OTHER_ASK, p.slots));
        say(3, "Agent", H_OTHER_ANS);
      }
      break;
    }
    case "N":
      break;
  }
  return { planned, sentence };
}

function render(p: Plan, msgs: Msg[], times: number[]): string {
  const header = [
    `# Conversation ${p.ticket}`,
    "",
    `Channel: ${p.channel}`,
    `Customer: ${p.customer} (acct ${p.acct})`,
    `Agent: ${p.staff.agent}`,
    `Opened: 2026-09-${pad2(p.day)} ${clock(p.startMin)} UTC`,
  ].join("\n");
  const body = msgs.map((m, i) => {
    const name = m.role === "Customer" ? p.customer : p.staff.agent;
    return `[${clock(at(times, i))}] ${m.role} (${name}): ${m.text}`;
  });
  return `${header}\n\n${body.join("\n\n")}\n`;
}

interface Built {
  text: string;
  sentence: string | null;
  times: number[];
}

function transcript(p: Plan, r: Rand): Built {
  const { planned, sentence } = beats(p, r);
  const last = Math.max(0, ...planned.keys());
  const target = r.int(10_900, 12_300);
  const msgs: Msg[] = [];
  let bytes = 0;
  let topic = r.pick(TOPICS);
  const used = new Set<string>();
  for (let i = 0; i <= last || bytes < target; i++) {
    if (i % 2 === 0) topic = r.pick(TOPICS);
    const msg = planned.get(i) ?? filler(p, i, r, topic, used);
    msgs.push(msg);
    bytes += msg.text.length + 40;
  }
  const times: number[] = [];
  let minute = p.startMin;
  for (let i = 0; i < msgs.length; i++) {
    times.push(minute);
    minute += r.int(1, 3);
  }
  return { text: render(p, msgs, times), sentence, times };
}

/** Random draws that decide each conversation's scenario. Counts are exact by construction. */
interface Flags {
  vRefundWord: boolean[];
  vAsk: boolean[];
  vIssued: boolean[];
  aAsk: boolean[];
  sAsk: boolean[];
  sIssued: boolean[];
  supervisor: boolean[];
  histories: ("a" | "b" | "c")[];
}

const CENTS_BY_HISTORY = { a: 26_000, b: 0, c: 35_000 } as const;

const flagsOf = (r: Rand, n: number, total: number): boolean[] =>
  r.shuffle(Array.from({ length: total }, (_, i) => i < n));

function variantFor(kind: Kind, n: number, r: Rand, f: Flags): Variant {
  const tail = (): number => (r.chance(0.4) ? r.int(1, 99) : 0);
  switch (kind) {
    case "V":
      return {
        ...NO_VARIANT,
        cents: (201 + r.int(0, 699)) * 100 + tail(),
        refundAsk: at(f.vAsk, n),
        refundWord: at(f.vRefundWord, n),
        nearMiss: n < 4,
        unrelated: n >= 4 && n < 7,
        promiseAt: 7,
        issued: at(f.vIssued, n),
      };
    case "A": {
      const placement = at(APPROVAL_PLACEMENTS, n);
      return {
        ...NO_VARIANT,
        cents: (215 + r.int(0, 659)) * 100 + tail(),
        refundAsk: at(f.aAsk, n),
        promiseAt: placement.promiseAt,
        approvalAt: placement.approvalAt,
        issued: true,
      };
    }
    case "S": {
      let cents = r.int(1500, 19_998);
      if (n < 2) cents = 20_000;
      if (n === 2) cents = 19_999;
      return {
        ...NO_VARIANT,
        cents,
        refundAsk: at(f.sAsk, n),
        promiseAt: r.chance(0.5) ? 5 : 7,
        nearLead: n === 3 || n === 4,
        unrelated: n === 5,
        issued: at(f.sIssued, n),
      };
    }
    case "D":
      return {
        ...NO_VARIANT,
        cents: (201 + r.int(0, 749)) * 100 + tail(),
        supervisorNote: at(f.supervisor, n),
      };
    case "H": {
      const history = at(f.histories, n);
      return { ...NO_VARIANT, history, cents: CENTS_BY_HISTORY[history] };
    }
    default:
      return { ...NO_VARIANT };
  }
}

interface LedgerRow {
  id: string;
  ticket: string;
  cents: number;
  at: string;
  by: string;
}

interface Corpus {
  files: Record<string, string>;
  gold: Gold;
  /** Promise sentence per violation ticket, for the "refund" wording check. */
  promises: Record<string, string>;
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`refund-promises-audit: ${message}`);
}

export function buildCorpus(): Corpus {
  const r = makeRand(SEED);
  const kinds = r.shuffle(KINDS.flatMap((k) => Array.from({ length: COUNTS[k] }, () => k)));
  const used = new Set<string>();
  const newTicket = (): string => {
    for (;;) {
      const id = `CH-${r.int(20_000, 29_999)}`;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
  const f: Flags = {
    vRefundWord: flagsOf(r, 5, 11),
    vAsk: flagsOf(r, 8, 11),
    vIssued: flagsOf(r, 7, 11),
    aAsk: flagsOf(r, 7, 9),
    sAsk: flagsOf(r, 6, 10),
    sIssued: flagsOf(r, 7, 10),
    supervisor: flagsOf(r, 3, 16),
    histories: r.shuffle(["a", "a", "a", "a", "b", "b", "b", "c", "c", "c"] as const),
  };
  const vStaff = V_STAFF_ORDER.map((i) => at(STAFF, i));
  const seen: Record<Kind, number> = { V: 0, A: 0, S: 0, D: 0, H: 0, N: 0 };
  const files: Record<string, string> = {};
  const promises: Record<string, string> = {};
  const plans: Plan[] = [];
  const issued: { plan: Plan; decided: number }[] = [];

  for (const kind of kinds) {
    const n = seen[kind];
    seen[kind] = n + 1;
    const first = r.pick(FIRST_NAMES);
    const v = variantFor(kind, n, r, f);
    const slots: Slots = {
      ...slotsFor(r, first),
      amt: money(v.cents, kind === "H" ? 0 : r.int(0, 3)),
      credit: money(r.int(20_000, 40_000), 0),
    };
    const plan: Plan = {
      kind,
      ticket: newTicket(),
      staff: kind === "V" ? at(vStaff, n) : r.pick(STAFF),
      customer: `${first} ${r.pick(LAST_NAMES)}`,
      first,
      company: r.pick(COMPANIES),
      acct: r.int(10_000, 99_999),
      channel: r.chance(0.5) ? "email" : "chat",
      day: r.int(1, 28),
      startMin: r.int(480, 960),
      opener: fill(r.pick(CUSTOMER_OPEN), slots),
      slots,
      v,
    };
    const built = transcript(plan, r);
    files[`transcripts/${plan.ticket}.md`] = built.text;
    plans.push(plan);
    if (kind === "V" && built.sentence !== null) promises[plan.ticket] = built.sentence;
    if (v.issued) {
      const approved = v.approvalAt === null ? 0 : at(built.times, v.approvalAt);
      issued.push({ plan, decided: Math.max(at(built.times, v.promiseAt), approved) });
    }
  }

  const refundIds = new Set<string>();
  const newRefundId = (): string => {
    for (;;) {
      const id = `RF-${r.int(100_000, 999_999)}`;
      if (!refundIds.has(id)) {
        refundIds.add(id);
        return id;
      }
    }
  };
  const ledger: LedgerRow[] = issued.map(({ plan, decided }) => ({
    id: newRefundId(),
    ticket: plan.ticket,
    cents: plan.v.cents,
    at: isoAt(plan.day, decided + r.int(5, 40), r.int(0, 59)),
    by: plan.staff.agent,
  }));
  while (ledger.length < LEDGER_ROWS) {
    ledger.push({
      id: newRefundId(),
      ticket: newTicket(),
      cents: r.int(1200, 48_000),
      at: isoAt(r.int(1, 28), r.int(480, 1200), r.int(0, 59)),
      by: r.pick(STAFF).agent,
    });
  }
  const ledgerRows = ledger.toSorted((a, b) => asc(a.at, b.at) || asc(a.id, b.id));
  const ledgerCsv = [
    "refund_id,ticket,amount,issued_at,issued_by",
    ...ledgerRows.map((row) => `${row.id},${row.ticket},${(row.cents / 100).toFixed(2)},${row.at},${row.by}`),
  ].join("\n");

  const vPlans = plans.filter((p) => p.kind === "V");
  const violations: Violation[] = vPlans
    .map((p) => ({
      ticket: p.ticket,
      agent: p.staff.agent,
      amount: p.v.cents / 100,
      team_lead: p.staff.team_lead,
      issued: p.v.issued,
    }))
    .toSorted((a, b) => asc(a.ticket, b.ticket));
  const leadCents = new Map<string, number>();
  for (const p of vPlans) leadCents.set(p.staff.team_lead, (leadCents.get(p.staff.team_lead) ?? 0) + p.v.cents);
  const total_by_lead = [...leadCents]
    .map(([team_lead, cents]) => ({ team_lead, amount: cents / 100 }))
    .toSorted((a, b) => asc(a.team_lead, b.team_lead));
  const gold: Gold = { violations, total_by_lead };

  files["policy.md"] = POLICY;
  files["staff.csv"] = `${["agent,team,team_lead", ...STAFF.map((s) => `${s.agent},${s.team},${s.team_lead}`)].join("\n")}\n`;
  files["ledger/refunds-2026-09.csv"] = `${ledgerCsv}\n`;

  const texts = Object.keys(files)
    .filter((path) => path.startsWith("transcripts/"))
    .map((path) => files[path] ?? "");
  const sizes = texts.map((t) => t.length);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  check(texts.length === 100, "expected 100 transcripts");
  check(texts.every((t) => !/[^ -~\n]/.test(t)), "transcripts must be ASCII");
  check(Math.min(...sizes) >= 9_000 && Math.max(...sizes) <= 15_000, "transcript size out of range");
  check(total >= 1_000_000 && total <= 1_400_000, "corpus size out of range");
  check(texts.filter((t) => /refund/i.test(t)).length >= 40, "too few transcripts mention refund");
  check(vPlans.filter((p) => !/refund/i.test(promises[p.ticket] ?? "")).length * 2 >= vPlans.length, "too few V promises avoid refund");
  check(total_by_lead.length === TEAMS.length, "every team lead needs a violation");
  check(ledgerRows.length === LEDGER_ROWS, "ledger row count");

  return { files, gold, promises };
}

export function generate(): { files: Record<string, string>; gold: Gold } {
  const { files, gold } = buildCorpus();
  return { files, gold };
}

if (import.meta.main) {
  const { files, gold } = buildCorpus();
  const root = join(import.meta.dir, "workspace");
  rmSync(root, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  writeFileSync(join(import.meta.dir, "gold.json"), `${JSON.stringify(gold, null, 2)}\n`);
  console.log(`${Object.keys(files).length} files, ${gold.violations.length} violations`);
}
