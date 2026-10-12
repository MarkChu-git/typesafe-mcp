import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { ALL_TASKS, findTask } from "../../evals/tasks/index.ts";
import { affectedCustomers, generate } from "../../evals/tasks/payment-log-duplicates/generate.ts";
import {
  buildCorpus,
  generate as generateRefundAudit,
  money,
} from "../../evals/tasks/refund-promises-audit/generate.ts";

const APPROVAL_WORDS = /approv|signed off|APR-/i;
const MONEY_BACK = /back|refund|revers|return|credit/i;

/** Lines that open an agent message. A multi-line message counts only through its first line. */
const agentLines = (text: string): string[] =>
  text.split("\n").filter((line) => /^\[\d{2}:\d{2}\] Agent \(/.test(line));

/** Every amount in the text, in cents, in any of the four money() formats. */
const amountsIn = (text: string): number[] =>
  [...text.matchAll(/(?:US\$|\$|USD )(\d[\d,]*)(?:\.(\d{2}))?/g)].map(
    (m) => Number((m[1] ?? "0").replaceAll(",", "")) * 100 + Number(m[2] ?? 0),
  );

const escapeRegExp = (text: string): string => text.replaceAll(/[$()*+.?[\]\\^{|}]/g, "\\$&");

/** The amount appears as a whole amount in one of the money() formats, not as the start of a longer one. */
const states = (text: string, cents: number): boolean =>
  [0, 1, 2, 3].some((style) => new RegExp(`${escapeRegExp(money(cents, style))}(?!\\d|[.,]\\d)`).test(text));

describe("tasks", () => {
  describe("ALL_TASKS", () => {
    it("has exactly 5 tasks", () => {
      expect(ALL_TASKS.length).toBe(5);
    });

    it("has unique ids", () => {
      const ids = ALL_TASKS.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("all ids are defined in findTask", () => {
      for (const task of ALL_TASKS) {
        expect(findTask(task.id)).toBe(task);
      }
    });

    it("findTask returns undefined for unknown id", () => {
      expect(findTask("nonexistent-task")).toBeUndefined();
    });
  });

  for (const task of ALL_TASKS) {
    describe(`task: ${task.id}`, () => {
      it("has required properties", () => {
        expect(task.id).toBeTruthy();
        expect(task.title).toBeTruthy();
        expect(task.category).toBeTruthy();
        expect(task.split).toMatch(/^(dev|holdout)$/);
        expect(task.dir).toBeTruthy();
        expect(task.prompt).toBeTruthy();
        expect(typeof task.workspaceDir).toBe("string");
      });

      it("workspace directory exists", () => {
        expect(existsSync(task.workspaceDir)).toBe(true);
      });

      it("workspace is non-empty", () => {
        const files = readdirSync(task.workspaceDir, { recursive: true });
        expect(files.length).toBeGreaterThan(0);
      });

      it("has no AGENTS.md or CLAUDE.md in workspace", () => {
        const files = readdirSync(task.workspaceDir, { recursive: true });
        for (const file of files) {
          if (typeof file === "string") {
            expect(file).not.toBe("AGENTS.md");
            expect(file).not.toBe("CLAUDE.md");
          }
        }
      });

      it("has no test-like files in workspace", () => {
        const files = readdirSync(task.workspaceDir, { recursive: true });
        for (const file of files) {
          if (typeof file === "string") {
            expect(file).not.toMatch(/\.test\./);
            expect(file).not.toMatch(/\.spec\./);
            expect(file).not.toMatch(/_test\./);
          }
        }
      });

      it("gold() parses successfully", () => {
        const gold = task.gold();
        expect(gold).toBeDefined();
      });

      it("score(gold, gold) returns score of 1 and passed=true", () => {
        const gold = task.gold();
        const result = task.score(gold, gold);
        expect(result.score).toBe(1);
        expect(result.passed).toBe(true);
      });

      it("jsonSchema() has required structure", () => {
        const schema = task.jsonSchema();
        expect(schema.type).toBe("object");
        expect(schema.properties).toBeDefined();
        expect("feedback" in (schema.properties as Record<string, unknown>)).toBe(true);
      });

      it("parse() accepts valid answer with feedback", () => {
        const gold = task.gold() as Record<string, unknown>;
        const result = task.parse({ ...gold, feedback: "test feedback" });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.feedback).toBe("test feedback");
        }
      });

      it("parse() handles missing feedback", () => {
        const gold = task.gold() as Record<string, unknown>;
        const result = task.parse(gold);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.feedback).toBe(null);
        }
      });

      it("parse() rejects empty object", () => {
        const result = task.parse({});
        expect(result.ok).toBe(false);
      });
    });
  }

  describe("payment-log-duplicates generator", () => {
    it("generate() produces consistent output", () => {
      const result1 = generate();
      const result2 = generate();

      expect(result1.log).toBe(result2.log);
      expect(result1.gold).toEqual(result2.gold);
    });

    it("generated log has correct format", () => {
      const { log } = generate();
      const lines = log.split("\n");

      expect(lines.length).toBeGreaterThan(200);

      for (const line of lines.slice(0, 10)) {
        const parts = line.split(" ");
        expect(parts.length).toBe(8);
        // First part should be ISO timestamp
        const firstPart = parts[0];
        expect(firstPart).toBeDefined();
        if (firstPart) {
          expect(/^\d{4}-\d{2}-\d{2}T/.test(firstPart)).toBe(true);
        }
      }
    });

    it("generated gold has affected customers", () => {
      const { gold } = generate();
      expect(gold.customers.length).toBe(6);
      expect(gold.customers).toEqual([...gold.customers].toSorted());
    });

    it("workspace files match generated content", () => {
      const paymentTask = ALL_TASKS.find((t) => t.id === "payment-log-duplicates");
      if (!paymentTask) throw new Error("payment-log-duplicates task not found");
      const { log, gold } = generate();
      expect(readFileSync(join(paymentTask.workspaceDir, "payments.log"), "utf8")).toBe(log);
      expect(paymentTask.gold()).toEqual(gold);
    });

    it("gold follows the task definition", () => {
      const { log, gold } = generate();
      expect(affectedCustomers(log)).toEqual(gold.customers);
    });
  });

  describe("refund-promises-audit generator", () => {
    const task = ALL_TASKS.find((t) => t.id === "refund-promises-audit");
    if (!task) throw new Error("refund-promises-audit task not found");
    const root = task.workspaceDir;
    // Relative paths with `/`, as generate() names them; readdirSync uses `\` on Windows.
    const listFiles = (): string[] =>
      readdirSync(root, { recursive: true })
        .map((entry) => String(entry).split(sep).join("/"))
        .filter((entry) => statSync(join(root, entry)).isFile())
        .toSorted();
    const transcriptPaths = (): string[] => listFiles().filter((path) => path.startsWith("transcripts/"));
    const read = (path: string): string => readFileSync(join(root, path), "utf8");
    const ledgerTickets = (): Set<string> =>
      new Set(
        read("ledger/refunds-2026-09.csv")
          .trim()
          .split("\n")
          .slice(1)
          .map((line) => line.split(",")[1] ?? ""),
      );

    it("generate() output equals the workspace files on disk and gold.json", () => {
      const { files, gold } = generateRefundAudit();
      expect(listFiles()).toEqual(Object.keys(files).toSorted());
      for (const [path, content] of Object.entries(files)) {
        expect(read(path)).toBe(content);
      }
      expect(task.gold()).toEqual(gold);
    });

    it("has 100 transcripts", () => {
      expect(transcriptPaths().length).toBe(100);
    });

    it("each transcript is 9-15 KB and at most 64 KB", () => {
      for (const path of transcriptPaths()) {
        const size = statSync(join(root, path)).size;
        expect(size).toBeLessThanOrEqual(64 * 1024);
        expect(size).toBeGreaterThanOrEqual(9_000);
        expect(size).toBeLessThanOrEqual(15_000);
      }
    });

    it("transcripts total 1.0-1.4 MB", () => {
      const total = transcriptPaths().reduce((sum, path) => sum + statSync(join(root, path)).size, 0);
      expect(total).toBeGreaterThanOrEqual(1_000_000);
      expect(total).toBeLessThanOrEqual(1_400_000);
    });

    it("at least half of the V promise sentences avoid the word refund", () => {
      const { gold, promises } = buildCorpus();
      const lacking = gold.violations.filter((v) => !/refund/i.test(promises[v.ticket] ?? ""));
      expect(lacking.length * 2).toBeGreaterThanOrEqual(gold.violations.length);
    });

    it("at least half of the V promise sentences carry no amount", () => {
      const { gold, promises } = buildCorpus();
      const sentences = gold.violations.map((v) => promises[v.ticket]);
      const bare = sentences.filter((sentence) => sentence !== undefined && !/[\d$]|USD/.test(sentence));
      expect(sentences.every((sentence) => sentence !== undefined)).toBe(true);
      expect(bare.length * 2).toBeGreaterThanOrEqual(gold.violations.length);
    });

    it("approval words appear in agent lines of at least 6 V transcripts, 2 of them as signed off", () => {
      const { gold } = generateRefundAudit();
      const lines = gold.violations.map((v) => agentLines(read(`transcripts/${v.ticket}.md`)));
      expect(lines.filter((own) => own.some((line) => APPROVAL_WORDS.test(line))).length).toBeGreaterThanOrEqual(6);
      expect(lines.flat().filter((line) => line.includes("signed off")).length).toBeGreaterThanOrEqual(2);
    });

    it("at most a third of the A approvals use approval words", () => {
      const { approvals } = buildCorpus();
      const sentences = Object.values(approvals);
      expect(sentences.length).toBe(9);
      expect(sentences.filter((sentence) => APPROVAL_WORDS.test(sentence)).length * 3).toBeLessThanOrEqual(
        sentences.length,
      );
    });

    it("every A approval sits in its transcript and names the agent's team lead", () => {
      const { approvals } = buildCorpus();
      const leads = new Map(
        read("staff.csv")
          .trim()
          .split("\n")
          .slice(1)
          .map((line) => line.split(",") as [string, string, string])
          .map(([agent, , lead]) => [agent, lead] as const),
      );
      for (const [ticket, approval] of Object.entries(approvals)) {
        const text = read(`transcripts/${ticket}.md`);
        const agent = /^Agent: (.+)$/m.exec(text)?.[1] ?? "";
        expect(text).toContain(approval);
        expect(approval).toContain(leads.get(agent) ?? "no such agent");
      }
    });

    it("at least 15 transcripts outside the gold quote an amount over $200 next to a money-back word", () => {
      const { gold, approvals } = buildCorpus();
      // A conversations make real promises, so they are left out: the count is about decoys.
      const promised = new Set([...gold.violations.map((v) => v.ticket), ...Object.keys(approvals)]);
      const quoting = transcriptPaths().filter(
        (path) =>
          !promised.has(path.slice("transcripts/".length, -".md".length)) &&
          agentLines(read(path)).some((line) => MONEY_BACK.test(line) && amountsIn(line).some((cents) => cents > 20_000)),
      );
      expect(quoting.length).toBeGreaterThanOrEqual(15);
    });

    it("every V transcript states the gold amount in one of the money() formats", () => {
      const { gold } = generateRefundAudit();
      for (const violation of gold.violations) {
        const text = read(`transcripts/${violation.ticket}.md`);
        expect(states(text, Math.round(violation.amount * 100))).toBe(true);
      }
    });

    it("no V transcript states an amount other than the gold amount", () => {
      const { gold } = generateRefundAudit();
      for (const violation of gold.violations) {
        const cents = Math.round(violation.amount * 100);
        const found = amountsIn(read(`transcripts/${violation.ticket}.md`));
        expect(found.length).toBeGreaterThan(0);
        expect(found.every((amount) => amount === cents)).toBe(true);
      }
    });

    it("refund appears in at least 40 transcripts", () => {
      const count = transcriptPaths().filter((path) => /refund/i.test(read(path))).length;
      expect(count).toBeGreaterThanOrEqual(40);
    });

    it("every V ticket's issued flag matches the ledger", () => {
      const { gold } = generateRefundAudit();
      const tickets = ledgerTickets();
      for (const violation of gold.violations) {
        expect(tickets.has(violation.ticket)).toBe(violation.issued);
      }
    });

    it("staff.csv has 12 agents and 4 team leads", () => {
      const rows = read("staff.csv")
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.split(","));
      expect(rows.length).toBe(12);
      expect(new Set(rows.map((row) => row[2])).size).toBe(4);
    });

    it("every team lead has at least one V ticket", () => {
      const { gold } = generateRefundAudit();
      expect(gold.total_by_lead.length).toBe(4);
    });
  });
});
