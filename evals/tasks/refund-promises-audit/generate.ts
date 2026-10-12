// Deterministic generator for the refund-promises-audit workspace and gold.json.
// Run: bun run evals/tasks/refund-promises-audit/generate.ts
//
// The corpus is built so that keyword search cannot find the violations; telling them apart takes reading.
// - Most promises name no amount. The customer states the charge earlier, in a message or a pasted receipt.
// - Supervisors' agreements often avoid "approved" and "signed off". Violations are full of lines that use
//   those words without approving anything.
// - Conversations without a promise quote amounts next to "refund", "back" and "credit" all the time.
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

/** Agent lines that sit around a scenario without being part of it. See ASIDES. */
type Aside =
  | "nearPre"
  | "nearPost"
  | "nearLead"
  | "unrelated"
  | "supervisorNote"
  | "ask"
  | "pending"
  | "notYet"
  | "other"
  | "wait"
  | "elsewhere"
  | "withinLimit";

interface Placed {
  /** Message index; agents speak at odd indexes. */
  at: number;
  aside: Aside;
}

/** Facts a scenario needs. Fields a kind does not use keep their defaults. */
interface Variant {
  cents: number;
  /** Index into REQUESTS (V, A, S). */
  request: number;
  refundAsk: boolean;
  refundWord: boolean | null;
  /** The promise sentence leaves the amount to the customer's request. */
  amountless: boolean;
  promiseAt: number;
  approvalAt: number | null;
  /** The approval an A conversation records, with {lead} for the team lead. */
  approval: string | null;
  asides: readonly Placed[];
  /** Index into D_MONEY (D) or N_MONEY (N): a non-promise line that quotes the amount. */
  money: number | null;
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
  request: 0,
  refundAsk: false,
  refundWord: null,
  amountless: false,
  promiseAt: 0,
  approvalAt: null,
  approval: null,
  asides: [],
  money: null,
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

A promise refers to the money it returns, and the amount may have been stated anywhere in the conversation, not only in the promise itself. "I'll reverse that charge" promises the charge the customer described.

Saying the money cannot be returned is not a promise, and neither is saying what would happen only if something else happens first.

Store credit, discounts and coupons are not refunds.

## Limits

Agents may promise or issue refunds of up to $200 on their own.

A promise above $200 needs a supervisor's approval of that refund, recorded in the same conversation. Supervisors are the team leads listed in staff.csv. Any wording counts, as long as it says the supervisor agreed to this refund. These do not count: asking for approval, waiting for it, a refusal, a supervisor approving something else, or an approval given in another conversation.

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
export function money(cents: number, style: number): string {
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

const AGENT_LINE = /^\[\d{2}:\d{2}\] Agent \(/;
const APPROVAL_WORDS = /approv|signed off|APR-/i;
const MONEY_BACK = /back|refund|revers|return|credit/i;
/** A promise sentence with no amount has no "$", no "USD" and no digit. */
const AMOUNT_TEXT = /[\d$]|USD/;
const MONEY = /(?:US\$|\$|USD )(\d[\d,]*)(?:\.(\d{2}))?/g;

/** Every amount in the text, in cents, whichever of the four formats it uses. */
function amountsIn(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => Number(at(m, 1).replaceAll(",", "")) * 100 + Number(m[2] ?? 0));
}

/** Transcript lines that open an agent message. A multi-line message counts only through its first line. */
const agentLines = (text: string): string[] => text.split("\n").filter((line) => AGENT_LINE.test(line));

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

/**
 * The same subjects without anything that carries money: the invoice line with an amount, invoice tables and
 * the webhook payload. Conversations that hinge on one charge use these, so no other amount can pass for it.
 */
function withoutMoney(topic: Topic): Topic {
  return {
    customer: topic.customer.filter((line) => !line.includes("{invoiceAmt}")),
    agent: topic.agent,
    pastes: topic.pastes.filter((paste) => paste !== invoiceTable && paste !== jsonPayload),
  };
}

const MONEY_FREE_TOPICS = TOPICS.map(withoutMoney);

const LEAD_INS = [
  "I've checked the order history.",
  "Thanks for waiting while I reviewed the case.",
  "I've looked through the case notes.",
  "I've been through the account activity.",
];

/** Promise phrasings that name the amount. About half avoid the word "refund" on purpose. REQUESTS has the ones that leave the amount out. */
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
  "I'm taking the {amt} charge off your card today.",
  "The {amt} payment is being released back to your card.",
];

/**
 * What a refund request in V, A and S can be about. The customer states the charge, either in the request
 * or in a receipt they paste, and the agent's amountless promise points back at it. Promise sentences here
 * carry no digit, no "$" and no "USD", so none of them may use {amt}, {order} or {date}.
 */
interface Request {
  /** The customer's request. {amt} is the charge; a receipt request leaves the amount to the paste. */
  ask: { refund: readonly string[]; plain: readonly string[] };
  promises: { refund: readonly string[]; plain: readonly string[] };
  /** The agent asks for a receipt and the customer pastes it. */
  receipt: boolean;
}

const REQUESTS: readonly Request[] = [
  {
    // 0: a duplicate charge
    ask: {
      refund: [
        "The {product} was charged {amt} twice around {date}. Could you refund the duplicate?",
        "We were billed {amt} two times for the {product}. I'd like a refund of the second one.",
      ],
      plain: [
        "The {product} was charged {amt} twice around {date}. Could you undo the second charge?",
        "We were billed {amt} two times for the {product}. Please take the extra one off our card.",
      ],
    },
    promises: {
      refund: [
        "I've issued the refund for that duplicate charge.",
        "The refund for the second charge is going back to your original payment method.",
        "I'm processing a refund of that duplicate now.",
      ],
      plain: [
        "I'm reversing that duplicate charge now.",
        "The second charge is going back to your card today.",
        "The money from that duplicate is on its way back to you.",
        "I've credited back the duplicate payment.",
        "I'm taking that duplicate charge off your card right now.",
        "That second charge is being undone as we speak.",
        "I'm cancelling that duplicate charge and releasing the money to your card now.",
      ],
    },
    receipt: false,
  },
  {
    // 1: a product nobody used
    ask: {
      refund: [
        "We paid {amt} for the {product} in August and never switched it on. I'd like a refund.",
        "Our team never used the {product}. We paid {amt} for it and want a refund.",
      ],
      plain: [
        "We paid {amt} for the {product} in August and never switched it on. I'd like that money back.",
        "Our team never used the {product}. We paid {amt} for it and want to be repaid.",
      ],
    },
    promises: {
      refund: [
        "I'll refund the full amount you paid for the {product} today.",
        "I've issued a full refund for the {product}.",
      ],
      plain: [
        "The full amount you paid for the {product} is going back to your card.",
        "I'm sending back everything you paid for the {product}.",
        "I'll make sure you're reimbursed for the {product}.",
        "You won't be out of pocket for the {product}; I'm releasing the full payment to your card.",
        "The full {product} payment is being undone, and the money is released to your card today.",
      ],
    },
    receipt: false,
  },
  {
    // 2: a renewal after cancelling
    ask: {
      refund: [
        "I cancelled the {plan} plan before {date}, but the renewal still went through for {amt}. Please refund it.",
        "The {plan} plan renewed for {amt} even though we had cancelled it. We'd like a refund of the renewal.",
      ],
      plain: [
        "I cancelled the {plan} plan before {date}, but the renewal still went through for {amt}. Please give that money back.",
        "The {plan} plan renewed for {amt} even though we had cancelled it. We want the renewal payment returned.",
      ],
    },
    promises: {
      refund: ["I'll refund that renewal today.", "The refund for the renewal goes back to your original payment method."],
      plain: [
        "I'm reversing that renewal charge now.",
        "The renewal payment is going back to your card by Friday.",
        "We'll return the renewal payment to your account today.",
        "That renewal is being cancelled in full and the payment released to your card.",
        "I'm taking the renewal charge off your card today.",
      ],
    },
    receipt: false,
  },
  {
    // 3: an annual plan bought by mistake
    ask: {
      refund: [
        "I bought the annual {product} by mistake last month. It cost {amt} and I'd like a refund.",
        "We ordered the annual {product} for {amt} by accident. Can we get a refund?",
      ],
      plain: [
        "I bought the annual {product} by mistake last month. It cost {amt} and I'd like to return it.",
        "We ordered the annual {product} for {amt} by accident. Can we have that money back?",
      ],
    },
    promises: {
      refund: [
        "I can confirm a full refund for the annual {product}.",
        "I'm processing a full refund of the annual {product} now.",
      ],
      plain: [
        "Everything you paid for the annual {product} is going back to your card.",
        "I've put the annual {product} payment back on the card you paid with.",
        "We'll return what you paid for the annual {product} by Friday.",
        "I'm undoing the annual {product} purchase in full and releasing the payment to your card.",
        "The annual {product} payment is being released to your card in full.",
      ],
    },
    receipt: false,
  },
  {
    // 4: a cancelled order that was still charged
    ask: {
      refund: [
        "Order {order} was cancelled around {date}, but our card was still charged {amt}. Please refund that charge.",
        "We cancelled order {order} before it shipped and were still billed {amt}. I'd like a refund.",
      ],
      plain: [
        "Order {order} was cancelled around {date}, but our card was still charged {amt}. Please reverse that charge.",
        "We cancelled order {order} before it shipped and were still billed {amt}. I want that charge taken off.",
      ],
    },
    promises: {
      refund: [
        "I've issued a refund for that cancelled order.",
        "The refund for the cancelled order goes back to the card you paid with.",
      ],
      plain: [
        "I'm reversing the charge for that cancelled order now.",
        "The payment for the cancelled order is going back to your card today.",
        "We'll return the money for that order to your account by Friday.",
        "I'm taking that charge off your card; the order was cancelled and should never have been billed.",
        "The charge for that cancelled order is being undone in full.",
      ],
    },
    receipt: false,
  },
  {
    // 5: the amount is only on a receipt the customer pastes
    ask: {
      refund: [
        "I'd like a refund for the {product} we bought in August.",
        "We need a refund for the {product}. It never did what we needed.",
      ],
      plain: [
        "I'd like my money back for the {product} we bought in August.",
        "We want to be repaid for the {product}. It never did what we needed.",
      ],
    },
    promises: {
      refund: [
        "I've issued a full refund of everything on that receipt.",
        "The refund for the full receipt amount goes back to your original payment method.",
      ],
      plain: [
        "The full amount on that receipt is going back to your card.",
        "I'm returning everything shown on that receipt to your card today.",
        "I'll make sure you're reimbursed for the charge on that receipt.",
        "I'm taking everything on that receipt off your card today.",
        "The payment on that receipt is being released to your card in full.",
      ],
    },
    receipt: true,
  },
];

const RECEIPT_ASK = [
  "Could you paste the receipt so I can find the right charge?",
  "Please send me the receipt for that purchase so I'm looking at the right payment.",
  "Can you paste the receipt or invoice for it? I want to be sure I have the right charge.",
];

const RECEIPT_SENT = ["Sure, here is the receipt.", "Here it is.", "Pasting it below."];

/** Which request each V, A and S conversation makes, by order within its kind. */
const V_REQUESTS = [0, 5, 1, 2, 3, 5, 4, 0, 1, 5, 2];
// A conversations 0 and 2 record their approval at message 3, which a receipt would need.
const A_REQUESTS = [0, 1, 2, 5, 3, 5, 4, 5, 1];
// The first three S conversations are the $200 and $199.99 edges; "charged twice" would invite doubling them.
const S_REQUESTS = [1, 5, 3, 0, 2, 5, 4, 1, 5, 0];

const ASK_DECLINED = [
  "I want a refund of {amt} for the annual plan I bought in August. It doesn't match what we were sold.",
  "Please refund the full {amt}. Our team is cutting seats and I don't need this one anymore.",
  "Refund request: {amt} for order {order}, because the feature was removed without notice.",
  "Can I get a refund of {amt} on the {product}? It's been a month and it still doesn't do what the demo showed.",
];

/** D customers also ask the way V, A and S customers do, so the request alone says nothing about the answer. */
const D_ASKS = [
  ...ASK_DECLINED,
  ...REQUESTS.flatMap((q) => (q.receipt ? [] : q.ask.refund.concat(q.ask.plain))),
];

/**
 * Agent lines in D that quote the amount next to a money-back word and still promise nothing.
 * One list per kind of non-promise: the money can't be returned, would only come back on a condition,
 * is offered as store credit, or is just the charge the customer means.
 */
const D_MONEY: readonly (readonly string[])[] = [
  [
    "I can't put the {amt} back on your card myself, so I've sent the request to billing.",
    "Returning the {amt} isn't something I can do from this chat.",
    "I'm not able to send the {amt} back to you on my own.",
    "I can't promise the {amt} will come back to you. That decision sits with billing.",
    "I can't take the {amt} charge off your card from here, so I've sent the request to billing.",
    "Sending the {amt} back is a decision for billing, and I'm not able to make it.",
  ],
  [
    "If billing confirms the charge was an error, the {amt} would come back to you.",
    "Should our finance team agree, {amt} could be credited back to your card, but nothing is decided yet.",
    "Only if the review finds a billing fault would the {amt} be refunded.",
    "If billing finds a fault on our side, the {amt} would be returned to your card.",
    "If billing agrees, the {amt} charge would be taken off your card.",
    "Only if the charge turns out to be a mistake would the {amt} go back to your card.",
  ],
  [
    "I'm not able to refund that amount myself. I can offer a {credit} store credit on your account instead, and it works on any plan.",
    "A store credit of {credit} is what I can do today, and store credit can be used on any plan.",
    "Instead of the {amt} refund, I can add {credit} in store credit to the account today.",
    "Store credit is the most I can offer on a charge this size: {credit} on your account, usable on any plan.",
    "What I can offer is {credit} in store credit. The {amt} refund is not something I can approve.",
  ],
  [
    "I can see the {amt} charge you mean. I've passed your refund request to billing.",
    "The {amt} charge shows on the card ending {card}. Your refund request is with billing now, and I can't say how they'll rule.",
    "To confirm I have it right: you want the {amt} charge refunded. I've logged that and sent it to billing.",
    "I found the {amt} payment for the {product}. The request to get that money back is with billing, and they'll reply on this thread.",
    "You're asking about the {amt} payment for the {product}. I've written that up for billing, and they'll decide on the refund.",
    "I see the {amt} charge for the {product}. Billing will look at your refund request and reply here.",
  ],
];

/** The other decline in D, with no amount in it. */
const D_PLAIN = [
  "I've passed your refund request to billing; they'll decide within 3 business days.",
  "I can add a 30% coupon to your next renewal instead, but I can't promise a refund on this one.",
  "I can't promise a refund on this one, but I've flagged the case for billing review.",
  "That amount is above what I can authorize, so I've sent the request to billing and they'll reply on this thread.",
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

/** "approved" used in an unrelated sense: no supervisor, no approval of a refund. */
const UNRELATED = [
  "Good news: your plan upgrade was approved this morning, so the extra seats are live.",
  "The address change is approved, and the next box ships to the new address on Monday.",
  "Your billing contact update was approved by our system overnight.",
];

/**
 * Agent lines that sit around a promise or an approval without being one. {lead} is the agent's team lead,
 * {anyLead} any team lead. In V none of them is followed by an approval of this refund: the agent asks for it,
 * says it is pending or not given, or names a lead who agreed to something else. "ask", "pending", "notYet" and
 * "other" use approval words; "wait" and "elsewhere" say the same in the words an approval itself would use.
 */
const ASIDES: Record<Aside, readonly string[]> = {
  nearPre: NEAR_PRE,
  nearPost: NEAR_POST,
  nearLead: [NEAR_LEAD],
  unrelated: UNRELATED,
  supervisorNote: [SUPERVISOR_NOTE],
  ask: [
    "I've asked {lead} for approval on this one.",
    "I've put this in front of {lead} and asked for approval.",
    "I've sent the case to {lead} and requested approval.",
    "I'm asking {lead} for approval on the full amount.",
  ],
  pending: [
    "Approval is still pending with {lead}.",
    "The approval request is still open with {lead}.",
    "I'm still waiting on {lead} for approval.",
    "The approval for the whole refund is still with {lead}, and I haven't heard back.",
  ],
  notYet: [
    "{lead} hasn't signed off yet.",
    "{lead} hasn't signed off on this one yet.",
    "I don't have {lead}'s answer yet, and nothing is signed off.",
    "Nobody has signed off on the full amount yet; {lead} is still looking at it.",
  ],
  other: [
    "{anyLead} approved your seat change this morning.",
    "{anyLead} signed off on the plan change earlier today.",
    "{anyLead} approved the address update, so the next box goes to the new office.",
    "{anyLead} approved the extra seats for your team yesterday.",
    "{anyLead} approved a refund on your colleague's ticket last week.",
  ],
  wait: [
    "I'm waiting to hear whether {lead} is fine with the full amount.",
    "{lead} hasn't given the go-ahead yet.",
    "{lead} wants to look at the whole refund before saying yes.",
    "I asked {lead} about it, and there's no answer yet.",
  ],
  elsewhere: [
    "{anyLead} okayed your address change this morning.",
    "{anyLead} was fine with moving your renewal date, so that is done.",
    "{anyLead} gave the go-ahead on the extra seats yesterday.",
    "{anyLead} cleared the plan change earlier today.",
  ],
  withinLimit: [
    "This is within my limit, so it doesn't need anyone's approval.",
    "Refunds of this size don't need a supervisor's approval, so I can handle it myself.",
  ],
};

/** Lines around the promise in each V conversation, by order within the kind. Eight of the eleven use approval words. */
const V_ASIDES: readonly (readonly Placed[])[] = [
  [{ at: 5, aside: "ask" }],
  [{ at: 5, aside: "nearPre" }, { at: 9, aside: "notYet" }],
  [{ at: 5, aside: "pending" }, { at: 11, aside: "other" }],
  [{ at: 5, aside: "nearPre" }, { at: 9, aside: "nearPost" }, { at: 13, aside: "notYet" }],
  [{ at: 5, aside: "notYet" }, { at: 11, aside: "unrelated" }],
  [{ at: 9, aside: "pending" }, { at: 11, aside: "unrelated" }],
  [{ at: 5, aside: "ask" }, { at: 11, aside: "other" }],
  [{ at: 5, aside: "wait" }, { at: 11, aside: "elsewhere" }],
  [{ at: 9, aside: "nearPost" }, { at: 13, aside: "other" }],
  [{ at: 5, aside: "nearPre" }, { at: 9, aside: "nearPost" }],
  [],
];

/** A conversations whose supervisor is asked first and agrees later. */
const A_ASIDES: readonly (readonly Placed[])[] = [
  [],
  [{ at: 9, aside: "ask" }],
  [],
  [{ at: 9, aside: "pending" }],
  [{ at: 3, aside: "ask" }],
  [],
  [],
  [],
  [],
];

/** What a D agent adds about approval, in rotation. */
const D_ASIDES: readonly Aside[] = ["pending", "ask", "wait", "notYet"];

const S_ASIDES: readonly (readonly Placed[])[] = [
  [],
  [],
  [],
  [{ at: 3, aside: "nearLead" }],
  [{ at: 3, aside: "nearLead" }],
  [{ at: 9, aside: "unrelated" }],
  [{ at: 9, aside: "withinLimit" }],
  [{ at: 9, aside: "withinLimit" }],
  [],
  [],
];

/**
 * What a supervisor says in A conversations. Each names {lead}, the agent's team lead, and agrees to this refund.
 * Some borrow the words of the lines above ("asked", "waiting", "go-ahead") to say yes.
 */
const AGREEMENTS = [
  "{lead} is fine with the full amount.",
  "{lead} okayed sending all of it back.",
  "{lead} gave me the go-ahead on the whole refund.",
  "I've got the nod from {lead}, so the entire charge can go back to you.",
  "{lead} said yes to this one, so nothing else is holding it up.",
  "I spoke with {lead}, who is happy for me to return the lot.",
  "{lead} cleared this refund on their side.",
  "{lead} agreed we can send back everything you paid.",
  "{lead} green-lit the whole payment going back to you.",
  "I asked {lead} about the full amount, and the answer is yes.",
  "I was waiting on {lead}, who has now said yes to the whole refund.",
  "{lead} took a look at the numbers and is fine with the entire charge going back.",
  "{lead} gave the go-ahead on this refund a few minutes ago.",
];

/** The same, in the words a keyword search would look for. */
const WORDED_AGREEMENTS = [
  "{lead} approved this refund (APR-4471).",
  "Quick update: {lead} signed off on the full amount.",
];

const WHEN = ["August 14", "last month", "two weeks ago", "early August"];

const H_EARLIER_ASK = "I'm checking on the {amt} refund from {when}. My bank statement still doesn't show it.";
const H_EARLIER_ANS = [
  "The {amt} refund from {when} already shows as completed on our side. Banks usually post it within 5 to 7 business days, so give it a few more days.",
  "That {amt} refund from {when} was paid out before you wrote in, and our records show it as done. Your bank may still be posting it.",
  "Our records show the {amt} refund from {when} was sent back to your card. Nothing is outstanding on our side, so it is worth asking your bank.",
];
const H_POLICY_ASK = "What's your refund policy for annual plans? I'm thinking about upgrading and want to know what I can ask for.";
const H_POLICY_ANS =
  "Agents can issue refunds of up to $200 on their own. Anything above that needs a supervisor's approval recorded on the case before anyone can promise it, so a refund of {amt} would need that first. Annual plans follow the same rule.";
const H_OTHER_ASK = "{colleague} from your chat team told me last week I'd get a refund of {amt}. Can you confirm that?";
const H_OTHER_ANS =
  "I don't see a promise to refund {amt} in your history, so I can't confirm it. I can check the case notes with you, though.";

/** Past or negated money talk in N conversations: the amount sits next to a money-back word and nothing is promised. */
const N_MONEY: readonly { ask: string; answer: string }[] = [
  {
    ask: "Finance is closing the month. Did the {amt} refund from {when} ever go through?",
    answer: "Yes, the {amt} refund from {when} was completed on our side and went back to the original card.",
  },
  {
    ask: "Can you confirm that the {amt} credit back to our card for the cancelled order posted?",
    answer: "The {amt} was returned to your card before you wrote in, so that one is closed.",
  },
  {
    ask: "I'm reconciling our statement. Is the {amt} charge from {when} one that was reversed?",
    answer: "The {amt} charge from {when} was reversed at the time, and the case is marked closed.",
  },
  {
    ask: "Our bank shows a {amt} charge from your company. Can you tell me what it was for?",
    answer:
      "That {amt} charge is the annual {product} renewal. There is no refund pending on it, and I haven't changed anything.",
  },
  {
    ask: "Was the {amt} refund for our old workspace ever paid out? Finance keeps asking.",
    answer: "It was. The {amt} refund from {when} shows as completed, and banks usually post it within a week.",
  },
  {
    ask: "Our books show a {amt} credit that I can't match. Do you know what it was?",
    answer: "That {amt} was a refund we returned to your card; it dates from {when}. Nothing further is due either way.",
  },
];

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

const CARDS = ["Visa", "Mastercard", "Amex"];

/** Receipts a customer pastes. They show one charge and nothing else that could pass for a refund amount. */
function receiptBlock(r: Rand, s: Slots): string {
  return fence(
    [
      `Receipt RC-2026-08-${r.int(1000, 9999)}`,
      `Item: ${s.product}`,
      `Date: 2026-08-${pad2(r.int(1, 28))}`,
      `Amount charged: ${s.receiptAmt}`,
      `Card: ${r.pick(CARDS)} ending ${r.int(1000, 9999)}`,
    ].join("\n"),
  );
}

function receiptInvoice(r: Rand, s: Slots): string {
  return fence(
    [
      `Invoice INV-2026-08-${r.int(1000, 9999)} (paid)`,
      `${fill("{product}", s).padEnd(34)}${fill("{receiptAmt}", s).padStart(14)}`,
      `Payment method: ${r.pick(CARDS)} ending ${r.int(1000, 9999)}`,
    ].join("\n"),
  );
}

function receiptNotice(r: Rand, s: Slots): string {
  return fence(
    [
      "Payment received - Harbor & Vale",
      `Description: ${s.product}`,
      `Amount: ${s.receiptAmt}`,
      `Date: 2026-08-${pad2(r.int(1, 28))}`,
    ].join("\n"),
  );
}

const RECEIPTS: readonly Paste[] = [receiptBlock, receiptInvoice, receiptNotice];

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
    card: String(r.int(1000, 9999)),
    when: r.pick(WHEN),
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
  /** What the supervisor says. Only A conversations record one. */
  approval: string | null;
}

/** The sentence that makes the promise: it names the amount, or points back at the charge the request stated. */
function promiseFor(v: Variant, r: Rand): string {
  if (!v.amountless) {
    return r.pick(PROMISES.filter((t) => v.refundWord === null || /refund/i.test(t) === v.refundWord));
  }
  const { promises } = at(REQUESTS, v.request);
  if (v.refundWord === null) return r.pick([...promises.refund, ...promises.plain]);
  return r.pick(v.refundWord ? promises.refund : promises.plain);
}

/** Scenario messages at fixed indexes; background filler fills everything else. */
function beats(p: Plan, r: Rand): Beats {
  const v = p.v;
  const planned = new Map<number, Msg>();
  const say = (i: number, role: Role, text: string): void => {
    check(!planned.has(i), `${p.ticket}: two scenario messages at index ${i}`);
    planned.set(i, { role, text });
  };
  const aside = (placed: Placed): void => {
    say(placed.at, "Agent", fill(r.pick(ASIDES[placed.aside]), p.slots));
  };
  /** The message may open with a greeting line, which moves the sentence off the line that names the agent. */
  const greet = (text: string): string => (r.chance(0.3) ? `${fill(r.pick(AGENT_GREET), p.slots)}\n${text}` : text);
  const restate = (i: number): void => {
    if (r.chance(0.3)) say(i, "Agent", fill(r.pick(RESTATE), { ...p.slots, amt: money(v.cents, r.int(0, 3)) }));
  };
  let sentence: string | null = null;
  let approval: string | null = null;
  switch (p.kind) {
    case "V":
    case "A":
    case "S": {
      const request = at(REQUESTS, v.request);
      say(2, "Customer", fill(r.pick(v.refundAsk ? request.ask.refund : request.ask.plain), p.slots));
      if (request.receipt) {
        say(3, "Agent", r.pick(RECEIPT_ASK));
        say(4, "Customer", `${r.pick(RECEIPT_SENT)}\n\n${r.pick(RECEIPTS)(r, p.slots)}`);
      }
      sentence = fill(promiseFor(v, r), p.slots);
      const lead = r.chance(0.6) ? `${r.pick(LEAD_INS)} ` : "";
      say(v.promiseAt, "Agent", greet(lead + sentence));
      if (v.approval !== null && v.approvalAt !== null) {
        approval = fill(v.approval, p.slots);
        say(v.approvalAt, "Agent", greet(approval));
      }
      for (const placed of v.asides) aside(placed);
      if (!v.amountless) restate(v.promiseAt + 8);
      break;
    }
    case "D": {
      say(2, "Customer", fill(r.pick(D_ASKS), p.slots));
      const plain = r.shuffle(D_PLAIN);
      const opening = v.money === null ? at(plain, 0) : r.pick(at(D_MONEY, v.money));
      say(3, "Agent", fill(opening, p.slots));
      say(5, "Agent", fill(at(plain, v.money === null ? 1 : 0), p.slots));
      for (const placed of v.asides) aside(placed);
      break;
    }
    case "H": {
      if (v.history === "a") {
        say(2, "Customer", fill(H_EARLIER_ASK, p.slots));
        say(3, "Agent", fill(r.pick(H_EARLIER_ANS), p.slots));
      } else if (v.history === "b") {
        say(2, "Customer", H_POLICY_ASK);
        say(3, "Agent", fill(H_POLICY_ANS, p.slots));
      } else {
        say(2, "Customer", fill(H_OTHER_ASK, p.slots));
        say(3, "Agent", fill(H_OTHER_ANS, p.slots));
      }
      break;
    }
    case "N": {
      if (v.money !== null) {
        const talk = at(N_MONEY, v.money);
        say(2, "Customer", fill(talk.ask, p.slots));
        say(3, "Agent", fill(talk.answer, p.slots));
      }
      for (const placed of v.asides) aside(placed);
      break;
    }
  }
  return { planned, sentence, approval };
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
  approval: string | null;
  times: number[];
}

/** Kinds whose promise hinges on one stated charge. Their background talk carries no other money. */
const ONE_CHARGE: ReadonlySet<Kind> = new Set<Kind>(["V", "A", "S"]);

/** The customer states the charge before the promise, and no other amount can pass for it. */
function verifyCharge(p: Plan, msgs: readonly Msg[], sentence: string): void {
  const stated = msgs.findIndex((m) => amountsIn(m.text).length > 0);
  check(
    stated >= 0 && stated < p.v.promiseAt && at(msgs, stated).role === "Customer",
    `${p.ticket}: the customer must state the charge before the promise`,
  );
  check(
    msgs.every((m) => amountsIn(m.text).every((cents) => cents === p.v.cents)),
    `${p.ticket}: only the charge may appear as an amount`,
  );
  check(AMOUNT_TEXT.test(sentence) !== p.v.amountless, `${p.ticket}: the promise sentence disagrees with its amountless flag`);
}

function transcript(p: Plan, r: Rand): Built {
  const { planned, sentence, approval } = beats(p, r);
  const topics = ONE_CHARGE.has(p.kind) ? MONEY_FREE_TOPICS : TOPICS;
  const last = Math.max(0, ...planned.keys());
  const target = r.int(10_900, 12_300);
  const msgs: Msg[] = [];
  let bytes = 0;
  let topic = r.pick(topics);
  const used = new Set<string>();
  for (let i = 0; i <= last || bytes < target; i++) {
    if (i % 2 === 0) topic = r.pick(topics);
    const msg = planned.get(i) ?? filler(p, i, r, topic, used);
    msgs.push(msg);
    bytes += msg.text.length + 40;
  }
  if (sentence !== null) verifyCharge(p, msgs, sentence);
  const times: number[] = [];
  let minute = p.startMin;
  for (let i = 0; i < msgs.length; i++) {
    times.push(minute);
    minute += r.int(1, 3);
  }
  return { text: render(p, msgs, times), sentence, approval, times };
}

/** Random draws that decide each conversation's scenario. Counts are exact by construction. */
interface Flags {
  vRefundWord: boolean[];
  vAsk: boolean[];
  vIssued: boolean[];
  vAmountless: boolean[];
  aAsk: boolean[];
  aAmountless: boolean[];
  /** The approval each A conversation records, with {lead} for the team lead. */
  agreements: string[];
  sAsk: boolean[];
  sIssued: boolean[];
  sAmountless: boolean[];
  supervisor: boolean[];
  dAsk: boolean[];
  /** D conversations whose declines never quote the amount. */
  dBare: boolean[];
  nMoney: boolean[];
  nAside: boolean[];
  histories: ("a" | "b" | "c")[];
}

const CENTS_BY_HISTORY = { a: 26_000, b: 45_000, c: 35_000 } as const;

const flagsOf = (r: Rand, n: number, total: number): boolean[] =>
  r.shuffle(Array.from({ length: total }, (_, i) => i < n));

function variantFor(kind: Kind, n: number, r: Rand, f: Flags): Variant {
  const tail = (): number => (r.chance(0.4) ? r.int(1, 99) : 0);
  switch (kind) {
    case "V":
      return {
        ...NO_VARIANT,
        cents: (201 + r.int(0, 699)) * 100 + tail(),
        request: at(V_REQUESTS, n),
        refundAsk: at(f.vAsk, n),
        refundWord: at(f.vRefundWord, n),
        amountless: at(f.vAmountless, n),
        asides: at(V_ASIDES, n),
        promiseAt: 7,
        issued: at(f.vIssued, n),
      };
    case "A": {
      const placement = at(APPROVAL_PLACEMENTS, n);
      return {
        ...NO_VARIANT,
        cents: (215 + r.int(0, 659)) * 100 + tail(),
        request: at(A_REQUESTS, n),
        refundAsk: at(f.aAsk, n),
        amountless: at(f.aAmountless, n),
        promiseAt: placement.promiseAt,
        approvalAt: placement.approvalAt,
        approval: at(f.agreements, n),
        asides: at(A_ASIDES, n),
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
        request: at(S_REQUESTS, n),
        refundAsk: at(f.sAsk, n),
        amountless: at(f.sAmountless, n),
        asides: at(S_ASIDES, n),
        promiseAt: r.chance(0.5) ? 5 : 7,
        issued: at(f.sIssued, n),
      };
    }
    case "D": {
      const asides: Placed[] = [];
      if (at(f.supervisor, n)) asides.push({ at: 7, aside: "supervisorNote" });
      if (at(f.dAsk, n)) asides.push({ at: 9, aside: at(D_ASIDES, (n + 1) % D_ASIDES.length) });
      return {
        ...NO_VARIANT,
        cents: (201 + r.int(0, 749)) * 100 + tail(),
        money: at(f.dBare, n) ? null : n % D_MONEY.length,
        asides,
      };
    }
    case "H": {
      const history = at(f.histories, n);
      return { ...NO_VARIANT, history, cents: CENTS_BY_HISTORY[history] };
    }
    case "N": {
      const asides: Placed[] = at(f.nAside, n) ? [{ at: 5, aside: n % 2 === 0 ? "other" : "elsewhere" }] : [];
      return at(f.nMoney, n)
        ? { ...NO_VARIANT, cents: (201 + r.int(0, 699)) * 100 + tail(), money: r.int(0, N_MONEY.length - 1), asides }
        : { ...NO_VARIANT, asides };
    }
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
  /** Promise sentence per violation ticket, for the "refund" and amount wording checks. */
  promises: Record<string, string>;
  /** What the supervisor says, per A ticket. */
  approvals: Record<string, string>;
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`refund-promises-audit: ${message}`);
}

/** The wording tables keep the properties the scenarios rely on. */
function verifyTables(): void {
  const promises = REQUESTS.flatMap((q) => [...q.promises.refund, ...q.promises.plain]);
  check(!promises.some((s) => AMOUNT_TEXT.test(s) || /\{(?:amt|order|date)\}/.test(s)), "an amountless promise names an amount");
  check(
    REQUESTS.every(
      (q) =>
        q.promises.refund.every((s) => /refund/i.test(s)) &&
        q.promises.plain.every((s) => !/refund/i.test(s)) &&
        q.ask.refund.every((s) => /refund/i.test(s)) &&
        q.ask.plain.every((s) => !/refund/i.test(s)),
    ),
    "request wording disagrees with its refund flag",
  );
  check(
    REQUESTS.every((q) => [...q.ask.refund, ...q.ask.plain].every((s) => q.receipt !== s.includes("{amt}"))),
    "a request states its amount unless a receipt does",
  );
  check(PROMISES.every((s) => s.includes("{amt}")), "a promise phrasing lacks an amount");
  check(AGREEMENTS.every((s) => s.includes("{lead}") && !APPROVAL_WORDS.test(s)), "an agreement uses approval words");
  check(WORDED_AGREEMENTS.every((s) => s.includes("{lead}") && APPROVAL_WORDS.test(s)), "a worded agreement lacks approval words");
  check(
    [...ASIDES.ask, ...ASIDES.pending, ...ASIDES.notYet, ...ASIDES.other].every((s) => APPROVAL_WORDS.test(s)),
    "an approval-word aside lacks approval words",
  );
  check(ASIDES.notYet.every((s) => s.includes("signed off")), "a not-yet aside must say signed off");
  check(
    [...D_MONEY.flat(), ...N_MONEY.map((t) => t.answer)].every((s) => /\{(?:amt|credit)\}/.test(s)),
    "a money line lacks an amount",
  );
  check(
    D_MONEY.every((lines) => lines.filter((s) => MONEY_BACK.test(s)).length >= 3) && N_MONEY.every((t) => MONEY_BACK.test(t.answer)),
    "too few money lines carry a money-back word",
  );
}

/** The properties the redesign is for, checked on the finished corpus. */
function verifyCorpus(
  plans: readonly Plan[],
  files: Record<string, string>,
  sentences: Record<string, string>,
  approvals: Record<string, string>,
): void {
  const textOf = (p: Plan): string => files[`transcripts/${p.ticket}.md`] ?? "";
  const ofKind = (...kinds: Kind[]): Plan[] => plans.filter((p) => kinds.includes(p.kind));
  for (const kind of ["V", "A", "S"] as const) {
    const group = ofKind(kind);
    const bare = group.filter((p) => !AMOUNT_TEXT.test(sentences[p.ticket] ?? "x$"));
    check(bare.length * 2 >= group.length, `too few ${kind} promises leave out the amount`);
  }
  const violations = ofKind("V");
  const withApprovalWords = violations.filter((p) => agentLines(textOf(p)).some((line) => APPROVAL_WORDS.test(line)));
  check(withApprovalWords.length >= 6, "too few V conversations use approval words without approving");
  const signedOff = violations.flatMap((p) => agentLines(textOf(p))).filter((line) => line.includes("signed off"));
  check(signedOff.length >= 2, "too few V lines say signed off");
  const worded = Object.values(approvals).filter((s) => APPROVAL_WORDS.test(s));
  check(worded.length * 3 <= ofKind("A").length, "too many A approvals use approval words");
  check(
    ofKind("A").every((p) => (approvals[p.ticket] ?? "").includes(p.staff.team_lead)),
    "an A approval does not name the agent's team lead",
  );
  const quoting = ofKind("D", "H", "N").filter((p) =>
    agentLines(textOf(p)).some((line) => amountsIn(line).some((cents) => cents > 20_000) && MONEY_BACK.test(line)),
  );
  check(quoting.length >= 15, "too few D, H and N conversations quote an amount next to a money-back word");
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
    vRefundWord: flagsOf(r, 5, COUNTS.V),
    vAsk: flagsOf(r, 8, COUNTS.V),
    vIssued: flagsOf(r, 7, COUNTS.V),
    vAmountless: flagsOf(r, 7, COUNTS.V),
    aAsk: flagsOf(r, 7, COUNTS.A),
    aAmountless: flagsOf(r, 6, COUNTS.A),
    agreements: r.shuffle([...WORDED_AGREEMENTS, ...r.shuffle(AGREEMENTS).slice(0, COUNTS.A - WORDED_AGREEMENTS.length)]),
    sAsk: flagsOf(r, 6, COUNTS.S),
    sIssued: flagsOf(r, 7, COUNTS.S),
    sAmountless: flagsOf(r, 6, COUNTS.S),
    supervisor: flagsOf(r, 3, COUNTS.D),
    dAsk: flagsOf(r, 7, COUNTS.D),
    dBare: flagsOf(r, 3, COUNTS.D),
    nMoney: flagsOf(r, 12, COUNTS.N),
    nAside: flagsOf(r, 8, COUNTS.N),
    histories: r.shuffle(["a", "a", "a", "a", "b", "b", "b", "c", "c", "c"] as const),
  };
  const vStaff = V_STAFF_ORDER.map((i) => at(STAFF, i));
  const seen: Record<Kind, number> = { V: 0, A: 0, S: 0, D: 0, H: 0, N: 0 };
  const files: Record<string, string> = {};
  const promises: Record<string, string> = {};
  const sentences: Record<string, string> = {};
  const approvals: Record<string, string> = {};
  const plans: Plan[] = [];
  const issued: { plan: Plan; decided: number }[] = [];

  for (const kind of kinds) {
    const n = seen[kind];
    seen[kind] = n + 1;
    const first = r.pick(FIRST_NAMES);
    const v = variantFor(kind, n, r, f);
    const staff = kind === "V" ? at(vStaff, n) : r.pick(STAFF);
    const slots: Slots = {
      ...slotsFor(r, first),
      amt: money(v.cents, r.int(0, 3)),
      receiptAmt: money(v.cents, 1 + r.int(0, 2)),
      credit: money(r.int(20_000, 40_000), 0),
      lead: staff.team_lead,
      anyLead: r.pick(TEAMS).lead,
    };
    const plan: Plan = {
      kind,
      ticket: newTicket(),
      staff,
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
    if (built.sentence !== null) sentences[plan.ticket] = built.sentence;
    if (kind === "V" && built.sentence !== null) promises[plan.ticket] = built.sentence;
    if (kind === "A" && built.approval !== null) approvals[plan.ticket] = built.approval;
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

  verifyTables();
  verifyCorpus(plans, files, sentences, approvals);

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

  return { files, gold, promises, approvals };
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
