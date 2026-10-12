import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { ALL_TASKS, findTask } from "../../evals/tasks/index.ts";
import { affectedCustomers, generate } from "../../evals/tasks/payment-log-duplicates/generate.ts";
import {
  buildCorpus,
  generate as generateRefundAudit,
} from "../../evals/tasks/refund-promises-audit/generate.ts";

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
