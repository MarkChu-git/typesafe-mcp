// Deterministic generator for the screenshot-triage workspace and gold.json.
// Run: bun run evals/tasks/screenshot-triage/generate.ts (renders with Google Chrome; set CHROME to another binary)
//
// The answer is only in the pixels. The workspace holds nothing but the screenshots, and file names say
// which page was visited, never whether it broke. Every page shares the store's header, so a broken page
// differs from a fine one only in its main area.
// - Errors come in five shapes: a red alert above the content, a red message under a form field, a toast
//   in the corner, and full 500 and 404 pages that keep the header.
// - Loading pages show a spinner with a message, or grey placeholder blocks with no text at all.
// - Decoys are fine pages that look alarming: red sale badges, green confirmations, a designed empty
//   state and a help article about failed payments.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export type Problem = "error" | "loading";

export interface Gold {
  broken: { file: string; problem: Problem }[];
}

export const WIDTH = 1280;
export const HEIGHT = 720;

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #f5f6f8; color: #1f2933;
  font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; }
header { height: 64px; background: #fff; border-bottom: 1px solid #e3e6ea; display: flex; align-items: center; gap: 32px; padding: 0 40px; }
.logo { font-weight: 700; font-size: 22px; color: #1d4ed8; }
nav { display: flex; gap: 24px; font-size: 15px; color: #52606d; }
.cart-link { margin-left: auto; font-size: 15px; color: #52606d; }
main { padding: 28px 40px; }
h1 { font-size: 26px; margin-bottom: 18px; }
h2 { font-size: 18px; margin-bottom: 10px; }
p { font-size: 15px; line-height: 1.55; color: #3e4c59; margin-bottom: 12px; }
.muted { color: #7b8794; font-size: 14px; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
.grid.three { grid-template-columns: repeat(3, 1fr); }
.card { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 16px; position: relative; }
.thumb { height: 150px; border-radius: 8px; margin-bottom: 12px; }
.name { font-size: 15px; font-weight: 600; }
.price { font-size: 15px; color: #3e4c59; margin-top: 4px; }
.was { color: #9aa5b1; text-decoration: line-through; margin-left: 6px; font-size: 13px; }
.badge { position: absolute; top: 24px; left: 24px; background: #dc2626; color: #fff; font-size: 13px; font-weight: 700; padding: 4px 8px; border-radius: 4px; }
.panel { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 24px; }
.narrow { max-width: 560px; }
.row { display: flex; gap: 24px; align-items: flex-start; }
.grow { flex: 1; }
.alert { background: #fdecec; border: 1px solid #f5b5b5; color: #9b1c1c; padding: 14px 16px; border-radius: 8px; margin-bottom: 18px; font-size: 16px; }
.notice { background: #e6f6ee; border: 1px solid #a7dfc0; color: #146c43; padding: 14px 16px; border-radius: 8px; margin-bottom: 18px; font-size: 16px; }
label { display: block; font-size: 14px; color: #52606d; margin: 14px 0 6px; }
.input { height: 40px; border: 1px solid #cbd2d9; border-radius: 6px; padding: 10px 12px; font-size: 15px; background: #fff; }
.input.bad { border: 2px solid #dc2626; }
.field-error { color: #b91c1c; font-size: 14px; margin-top: 6px; }
.button { display: inline-block; background: #1d4ed8; color: #fff; padding: 11px 20px; border-radius: 6px; font-size: 15px; margin-top: 20px; }
.button.light { background: #fff; color: #1d4ed8; border: 1px solid #1d4ed8; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; }
th, td { text-align: left; padding: 12px 16px; font-size: 15px; border-bottom: 1px solid #eef0f3; }
th { color: #7b8794; font-weight: 600; font-size: 13px; }
.toast { position: fixed; right: 32px; bottom: 32px; background: #b91c1c; color: #fff; padding: 14px 18px; border-radius: 8px; font-size: 15px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2); }
.spinner { width: 56px; height: 56px; border: 6px solid #d9dee4; border-top-color: #1d4ed8; border-radius: 50%; margin: 150px auto 18px; }
.loading { text-align: center; color: #7b8794; font-size: 16px; }
.bone { background: #e4e7eb; border-radius: 6px; }
.error-page { text-align: center; padding-top: 110px; }
.error-page .code { font-size: 72px; font-weight: 800; color: #9aa5b1; margin-bottom: 8px; }
.empty { text-align: center; padding: 70px 24px; }
.big-thumb { width: 460px; height: 460px; border-radius: 12px; }
.steps li { font-size: 15px; color: #3e4c59; margin: 0 0 10px 20px; line-height: 1.5; }
`;

interface Product {
  name: string;
  price: string;
  color: string;
  badge?: string;
  was?: string;
}

const KITCHEN: Product[] = [
  { name: "Stoneware Mug", price: "$14.00", color: "#f3d9b1" },
  { name: "Steel Kettle", price: "$48.00", color: "#cfd8dc" },
  { name: "Oak Cutting Board", price: "$32.00", color: "#d7b98e" },
  { name: "Linen Tea Towels", price: "$18.00", color: "#c8e6c9" },
];
const LIGHTING: Product[] = [
  { name: "Brass Desk Lamp", price: "$89.00", color: "#ffe0a3" },
  { name: "Paper Pendant", price: "$64.00", color: "#f5f0e6" },
  { name: "Glass Table Lamp", price: "$72.00", color: "#d6eaf8" },
  { name: "LED Strip Kit", price: "$29.00", color: "#e1d5f5" },
];
const PICKS: Product[] = [
  { name: "Wool Throw", price: "$59.00", color: "#e8c4b8", badge: "SALE", was: "$84.00" },
  { name: "Ceramic Vase", price: "$38.00", color: "#cde4e9" },
  { name: "Brass Desk Lamp", price: "$62.00", color: "#ffe0a3", badge: "SALE −30%", was: "$89.00" },
  { name: "Linen Cushion", price: "$26.00", color: "#dfe8d0" },
];
const DEALS: Product[] = [
  { name: "Stoneware Mug", price: "$11.20", color: "#f3d9b1", badge: "−20%", was: "$14.00" },
  { name: "Paper Pendant", price: "$41.60", color: "#f5f0e6", badge: "−35%", was: "$64.00" },
  { name: "Steel Kettle", price: "$40.80", color: "#cfd8dc", badge: "−15%", was: "$48.00" },
  { name: "Wool Throw", price: "$42.00", color: "#e8c4b8", badge: "−50%", was: "$84.00" },
];

const card = (p: Product): string =>
  `<div class="card"><div class="thumb" style="background:${p.color}"></div>${p.badge ? `<span class="badge">${p.badge}</span>` : ""}` +
  `<div class="name">${p.name}</div><div class="price">${p.price}${p.was ? `<span class="was">${p.was}</span>` : ""}</div></div>`;
const grid = (products: readonly Product[], cls = "grid"): string => `<div class="${cls}">${products.map(card).join("")}</div>`;

const field = (name: string, value: string, error?: string): string =>
  `<label>${name}</label><div class="input${error ? " bad" : ""}">${value}</div>${error ? `<div class="field-error">${error}</div>` : ""}`;

const rows = (head: readonly string[], body: readonly (readonly string[])[]): string =>
  `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;

const productPage = (p: Product, description: string): string =>
  `<div class="row"><div class="big-thumb" style="background:${p.color}"></div><div class="grow panel">` +
  `<h1>${p.name}</h1><p style="font-size:22px;color:#1f2933">${p.price}</p><p>${description}</p>` +
  `<p class="muted">In stock · Ships in 1–2 days</p><span class="button">Add to cart</span></div></div>`;

const spinner = (message: string): string => `<div class="spinner"></div><div class="loading">${message}</div>`;

const skeletonCard = `<div class="card"><div class="thumb bone"></div><div class="bone" style="height:14px;width:70%"></div><div class="bone" style="height:14px;width:40%;margin-top:10px"></div></div>`;

const errorPage = (code: string, title: string, text: string, button: string): string =>
  `<div class="error-page"><div class="code">${code}</div><h1>${title}</h1><p>${text}</p><span class="button">${button}</span></div>`;

/** One screenshot: the page visited, its main area and what is wrong with it, if anything. */
interface Screen {
  name: string;
  main: string;
  problem?: Problem;
  /** Drawn over the page, as a toast is. */
  overlay?: string;
}

const SHIPPING_FORM =
  field("Full name", "Dana Whitfield") + field("Street address", "418 Alder Street") + field("City", "Portland") + field("Postcode", "97205");

export const SCREENS: readonly Screen[] = [
  { name: "home", main: `<h1>Fresh picks for your home</h1>${grid(PICKS)}` },
  { name: "deals", main: `<h1>This week's deals</h1>${grid(DEALS)}` },
  { name: "category-kitchen", main: `<h1>Kitchen</h1>${grid(KITCHEN)}` },
  {
    name: "category-garden",
    problem: "loading",
    main: `<h1>Garden</h1><div class="grid">${skeletonCard.repeat(4)}</div>`,
  },
  { name: "category-lighting", main: `<h1>Lighting</h1>${grid(LIGHTING)}` },
  {
    name: "search-lamps",
    main: `<h1>Results for “lamp”</h1><p class="muted">3 products</p>${grid(LIGHTING.slice(0, 3), "grid three")}`,
  },
  {
    name: "search-mugs",
    problem: "error",
    main: `<h1>Results for “mug”</h1><div class="alert">Search is unavailable right now. Please try again in a few minutes.</div>`,
  },
  {
    name: "product-mug",
    main: productPage(KITCHEN[0] as Product, "Hand-glazed stoneware that keeps coffee warm. Holds 350 ml and is safe in the dishwasher and microwave."),
  },
  {
    name: "product-kettle",
    problem: "error",
    main: productPage(KITCHEN[1] as Product, "A brushed steel kettle for gas, electric and induction hobs. Whistles when the water boils."),
    overlay: `<div class="toast">Couldn't add Steel Kettle to your cart. Please try again.</div>`,
  },
  {
    name: "product-lamp",
    main: productPage(LIGHTING[0] as Product, "A solid brass desk lamp with an adjustable arm and a warm 2700 K bulb included."),
  },
  { name: "product-chair", problem: "loading", main: spinner("Loading product…") },
  {
    name: "product-kettle-reviews",
    problem: "error",
    main: `<h1>Reviews for Steel Kettle</h1><div class="alert">Reviews couldn't be loaded. Try again later.</div>`,
  },
  {
    name: "cart",
    main:
      `<h1>Your cart</h1><div class="row"><div class="grow">` +
      rows(["Item", "Qty", "Price"], [["Stoneware Mug", "2", "$28.00"], ["Oak Cutting Board", "1", "$32.00"], ["Wool Throw", "1", "$59.00"]]) +
      `</div><div class="panel" style="width:320px"><h2>Summary</h2><p>Subtotal: $119.00</p><p>Shipping: Free</p><span class="button">Checkout</span></div></div>`,
  },
  {
    name: "saved-for-later",
    main:
      `<h1>Saved for later</h1><div class="panel empty"><h2>Nothing saved for later yet</h2>` +
      `<p>Items you save from your cart will show up here.</p><span class="button">Browse products</span></div>`,
  },
  {
    name: "checkout-shipping",
    main: `<h1>Shipping</h1><div class="panel narrow">${SHIPPING_FORM}<span class="button">Continue to payment</span></div>`,
  },
  {
    name: "checkout-payment",
    problem: "error",
    main:
      `<h1>Payment</h1><div class="panel narrow">${field("Card number", "4242 4242 4242 424", "Card number is invalid.")}` +
      `${field("Expiry date", "09 / 28")}${field("Security code", "•••")}<span class="button">Pay $84.20</span></div>`,
  },
  {
    name: "checkout-billing",
    problem: "error",
    main:
      `<h1>Billing</h1><div class="panel narrow"><div class="alert">Payment failed: your card was declined. Use another card.</div>` +
      `${field("Name on card", "Dana Whitfield")}${field("Billing postcode", "97205")}<span class="button">Pay $84.20</span></div>`,
  },
  {
    name: "checkout-review",
    main:
      `<h1>Review your order</h1><div class="panel narrow">` +
      rows(["Item", "Price"], [["Stoneware Mug × 2", "$28.00"], ["Steel Kettle", "$48.00"], ["Shipping", "$8.20"], ["Total", "$84.20"]]) +
      `<span class="button">Place order</span></div>`,
  },
  {
    name: "checkout-confirmation",
    main:
      `<div class="notice">Order confirmed. A receipt is on its way to your inbox.</div><h1>Thank you, Dana!</h1>` +
      `<div class="panel narrow"><p>Order #1042 · 3 items · $84.20</p><p class="muted">Arrives Thursday, October 16</p><span class="button light">Track your order</span></div>`,
  },
  {
    name: "account-profile",
    main:
      `<div class="notice">Changes saved.</div><h1>Profile</h1><div class="panel narrow">` +
      `${field("Name", "Dana Whitfield")}${field("Email", "dana.whitfield@example.com")}${field("Phone", "(503) 555-0142")}<span class="button">Save changes</span></div>`,
  },
  {
    name: "account-orders",
    problem: "error",
    main: `<h1>Your orders</h1><div class="alert">We couldn't load your orders. Refresh the page to try again.</div>`,
  },
  {
    name: "account-order-1042",
    main:
      `<h1>Order #1042</h1><p class="muted">Delivered on October 9</p>` +
      rows(["Item", "Qty", "Price"], [["Stoneware Mug", "2", "$28.00"], ["Steel Kettle", "1", "$48.00"]]),
  },
  {
    name: "account-addresses",
    main:
      `<h1>Addresses</h1><div class="grid three"><div class="panel"><h2>Home</h2><p>418 Alder Street<br>Portland, OR 97205</p></div>` +
      `<div class="panel"><h2>Work</h2><p>90 Market Street, Floor 4<br>Portland, OR 97204</p></div></div><span class="button">Add address</span>`,
  },
  {
    name: "account-settings",
    problem: "loading",
    main:
      `<h1>Settings</h1><div class="panel narrow">` +
      `<div class="bone" style="height:14px;width:30%;margin:8px 0 10px"></div><div class="bone" style="height:40px"></div>`.repeat(4) +
      `</div>`,
  },
  {
    name: "account-security",
    main:
      `<h1>Sign-in &amp; security</h1>` +
      rows(["Setting", "Status", ""], [["Password", "Last changed in March", "Change"], ["Two-step verification", "On", "Manage"], ["Signed-in devices", "2 devices", "Review"]]),
  },
  {
    name: "sign-in",
    problem: "error",
    main:
      `<h1>Sign in</h1><div class="panel narrow">${field("Email", "dana.whitfield@example.com")}` +
      `${field("Password", "••••••••••", "Incorrect email or password.")}<span class="button">Sign in</span></div>`,
  },
  {
    name: "sign-up",
    main:
      `<h1>Create your account</h1><div class="panel narrow">${field("Name", "")}${field("Email", "")}${field("Password", "")}` +
      `<span class="button">Create account</span></div>`,
  },
  {
    name: "password-reset",
    main:
      `<h1>Reset your password</h1><div class="panel narrow"><p>Enter the email you signed up with and we'll send you a link to choose a new password.</p>` +
      `${field("Email", "")}<span class="button">Send reset link</span></div>`,
  },
  {
    name: "help-center",
    main:
      `<h1>Help center</h1><div class="input" style="max-width:560px;margin-bottom:20px">Search help articles</div><div class="grid">` +
      ["Orders", "Payments", "Returns", "Shipping"].map((t) => `<div class="panel"><h2>${t}</h2><p class="muted">Guides and answers</p></div>`).join("") +
      `</div>`,
  },
  {
    name: "help-payments",
    main:
      `<h1>Why did my payment fail?</h1><div class="panel" style="max-width:860px">` +
      `<p>A payment can fail when your bank declines the charge, the card has expired, or the billing address doesn't match the one your bank has on file.</p>` +
      `<p>If you see an error message at checkout, check the card number and expiry date first. Some banks block online purchases until you confirm them in their app.</p>` +
      `<p>Still stuck? Try another card or contact your bank. We never charge you for a failed payment.</p></div>`,
  },
  {
    name: "help-returns",
    main:
      `<h1>Returning an item</h1><div class="panel" style="max-width:860px"><ol class="steps">` +
      `<li>Start a return from your orders within 30 days of delivery.</li><li>Print the prepaid label we email you.</li>` +
      `<li>Drop the parcel at any post office.</li><li>We refund you within 5 business days of receiving it.</li></ol></div>`,
  },
  {
    name: "help-contact",
    problem: "error",
    main: errorPage("500", "Something went wrong", "We couldn't load this page. Try again in a moment.", "Try again"),
  },
  { name: "store-locator", problem: "loading", main: `<h1>Find a store</h1>${spinner("Finding stores near you…")}` },
  {
    name: "gift-cards",
    main:
      `<h1>Gift cards</h1><div class="grid three">` +
      ["$25", "$50", "$100"].map((v) => `<div class="panel"><div class="thumb" style="background:#dbe4ff"></div><h2>${v} gift card</h2><p class="muted">Delivered by email</p></div>`).join("") +
      `</div>`,
  },
  { name: "wishlist", main: `<h1>Wishlist</h1>${grid([LIGHTING[1] as Product, KITCHEN[2] as Product, PICKS[1] as Product], "grid three")}` },
  {
    name: "returns-start",
    problem: "error",
    main: errorPage("404", "Page not found", "The page you're looking for doesn't exist or has moved.", "Go to the homepage"),
  },
  { name: "order-tracking", problem: "loading", main: `<h1>Track your order</h1>${spinner("Loading tracking details…")}` },
  {
    name: "newsletter",
    main:
      `<h1>Get 10% off your first order</h1><div class="panel narrow"><p>Hear about new arrivals and members-only deals. One email a week, at most.</p>` +
      `${field("Email", "")}<span class="button">Subscribe</span></div>`,
  },
  {
    name: "about",
    main:
      `<h1>About Acme Store</h1><div class="panel" style="max-width:860px"><p>We started in a garage in Portland in 2014, selling mugs from local potters.</p>` +
      `<p>Today we work with more than 120 makers and ship to every state. Everything we sell is chosen to last for years.</p></div>`,
  },
  {
    name: "shipping-info",
    main:
      `<h1>Shipping &amp; delivery</h1>` +
      rows(["Option", "Arrives", "Cost"], [["Standard", "3–5 business days", "$4.99"], ["Express", "1–2 business days", "$12.99"], ["Free shipping", "3–5 business days", "Orders over $50"]]),
  },
];

const HEADER = `<header><span class="logo">Acme Store</span><nav><span>Shop</span><span>Deals</span><span>Help</span><span>Account</span></nav><span class="cart-link">Cart (3)</span></header>`;

export const html = (screen: Screen): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${HEADER}<main>${screen.main}</main>${screen.overlay ?? ""}</body></html>`;

export const fileOf = (name: string): string => `screenshots/${name}.png`;

export function generate(): { pages: Record<string, string>; gold: Gold } {
  const pages = Object.fromEntries(SCREENS.map((screen) => [fileOf(screen.name), html(screen)]));
  const broken = SCREENS.flatMap((screen) => (screen.problem ? [{ file: fileOf(screen.name), problem: screen.problem }] : []));
  if (SCREENS.length !== 40) throw new Error(`${SCREENS.length} screens`);
  if (new Set(SCREENS.map((s) => s.name)).size !== SCREENS.length) throw new Error("screen names repeat");
  return { pages, gold: { broken: broken.toSorted((a, b) => a.file.localeCompare(b.file)) } };
}

/** Renders each page with headless Chrome at the size of a default Playwright viewport. */
function render(pages: Record<string, string>, root: string): void {
  const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const scratch = mkdtempSync(join(tmpdir(), "screenshot-triage-"));
  try {
    for (const [file, page] of Object.entries(pages)) {
      const source = join(scratch, "page.html");
      writeFileSync(source, page);
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      const args = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"];
      const run = Bun.spawnSync([chrome, ...args, `--window-size=${WIDTH},${HEIGHT}`, `--screenshot=${target}`, pathToFileURL(source).href]);
      if (run.exitCode !== 0 || !existsSync(target)) throw new Error(`${file}: Chrome exited ${run.exitCode}: ${run.stderr.toString().slice(-300)}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { pages, gold } = generate();
  const root = join(import.meta.dir, "workspace");
  rmSync(root, { recursive: true, force: true });
  render(pages, root);
  writeFileSync(join(import.meta.dir, "gold.json"), `${JSON.stringify(gold, null, 2)}\n`);
  console.log(`${Object.keys(pages).length} screenshots, ${gold.broken.length} broken`);
}
