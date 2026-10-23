// Gold boxes for screenshot-locate: where each page that screenshot-triage marks broken shows its problem.
// Run: bun run evals/tasks/screenshot-locate/generate.ts (drives Google Chrome through Playwright; set CHROME to another binary)
//
// Playwright loads each broken page from screenshot-triage's generate.ts at the screenshots' size, with GPU
// compositing off and scrollbars hidden as when they were rendered, and stops unless its screenshot is byte
// for byte the committed one, so every box fits the image the agent sees. A box is the union of the problem's parts, rounded out to whole pixels:
// - the element's box for a part with its own background or border: an alert, the toast, a failed field
//   and its message, a spinner, placeholder blocks, a button;
// - the text's box for centred text in a full-width block, a loading message or an error page's lines,
//   so the box ends where the text does.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { fileOf, HEIGHT, html, SCREENS, WIDTH } from "../screenshot-triage/generate.ts";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The parts of a page that show its problem. */
interface Parts {
  /** Elements whose own box counts. */
  boxes: readonly string[];
  /** Elements whose text counts. */
  text?: readonly string[];
}

const ALERT: Parts = { boxes: [".alert"] };
const FIELD: Parts = { boxes: [".input.bad", ".field-error"] };
const ERROR_PAGE: Parts = { boxes: [".error-page .button"], text: [".error-page .code", ".error-page h1", ".error-page p"] };
const SPINNER: Parts = { boxes: [".spinner"], text: [".loading"] };
const PLACEHOLDERS: Parts = { boxes: [".bone"] };

const PARTS: Readonly<Record<string, Parts>> = {
  "account-orders": ALERT,
  "account-settings": PLACEHOLDERS,
  "category-garden": PLACEHOLDERS,
  "checkout-billing": ALERT,
  "checkout-payment": FIELD,
  "help-contact": ERROR_PAGE,
  "order-tracking": SPINNER,
  "product-chair": SPINNER,
  "product-kettle": { boxes: [".toast"] },
  "product-kettle-reviews": ALERT,
  "returns-start": ERROR_PAGE,
  "search-mugs": ALERT,
  "sign-in": FIELD,
  "store-locator": SPINNER,
};

/** The box of every part on the loaded page. */
async function rects(page: Page, parts: Parts): Promise<Rect[]> {
  const [boxed, texts] = await Promise.all([
    Promise.all(parts.boxes.map((selector) => page.locator(selector).all())),
    Promise.all((parts.text ?? []).map((selector) => page.locator(selector).all())),
  ]);
  return Promise.all([
    ...boxed.flat().map(async (element) => {
      const box = await element.boundingBox();
      if (!box) throw new Error("a part is not visible");
      return box;
    }),
    ...texts.flat().map((element) =>
      element.evaluate((el) => {
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(el);
        const { x, y, width, height } = range.getBoundingClientRect();
        return { x, y, width, height };
      }),
    ),
  ]);
}

function union(parts: readonly Rect[]): Box {
  if (parts.length === 0) throw new Error("no parts on the page");
  return {
    left: Math.floor(Math.min(...parts.map((r) => r.x))),
    top: Math.floor(Math.min(...parts.map((r) => r.y))),
    right: Math.ceil(Math.max(...parts.map((r) => r.x + r.width))),
    bottom: Math.ceil(Math.max(...parts.map((r) => r.y + r.height))),
  };
}

async function generate(chrome: string, workspace: string): Promise<{ problems: { file: string; box: Box }[] }> {
  const pages = Object.entries(PARTS).map(([name, parts]) => {
    const screen = SCREENS.find((s) => s.name === name && s.problem);
    if (!screen) throw new Error(`${name} is not a broken page`);
    return { screen, parts };
  });
  if (pages.length !== SCREENS.filter((s) => s.problem).length) throw new Error("every broken page needs its parts");
  const browser = await chromium.launch({ executablePath: chrome, args: ["--disable-gpu", "--hide-scrollbars"] });
  try {
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const problems = await Promise.all(
      pages.map(async ({ screen, parts }) => {
        const file = fileOf(screen.name);
        const page = await context.newPage();
        await page.setContent(html(screen));
        const shot = await page.screenshot({ type: "png" });
        if (!shot.equals(readFileSync(join(workspace, file)))) {
          throw new Error(`${file} is not what this Chrome renders; run screenshot-triage's generate.ts with it first`);
        }
        return { file, box: union(await rects(page, parts)) };
      }),
    );
    return { problems: problems.toSorted((a, b) => a.file.localeCompare(b.file)) };
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const gold = await generate(chrome, join(import.meta.dir, "..", "screenshot-triage", "workspace"));
  writeFileSync(join(import.meta.dir, "gold.json"), `${JSON.stringify(gold, null, 2)}\n`);
  console.log(`${gold.problems.length} boxes`);
}
