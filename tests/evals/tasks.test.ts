import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_TASKS, findTask } from "../../evals/tasks/index.ts";
import { affectedCustomers, generate } from "../../evals/tasks/payment-log-duplicates/generate.ts";

describe("tasks", () => {
  describe("ALL_TASKS", () => {
    it("has exactly 4 tasks", () => {
      expect(ALL_TASKS.length).toBe(4);
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
});
