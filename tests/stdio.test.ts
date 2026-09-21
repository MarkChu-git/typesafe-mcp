import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = join(import.meta.dir, "..");

describe("stdio entry", () => {
  test(
    "lists jev_models and jev_check over StdioClientTransport",
    async () => {
      const transport = new StdioClientTransport({
        command: "bun",
        args: ["run", "src/index.ts"],
        cwd: root,
        stderr: "pipe",
      });
      const client = new Client({ name: "stdio-test", version: "0.0.1" });
      await client.connect(transport);
      try {
        const listed = await client.listTools();
        expect(listed.tools.map((t) => t.name)).toEqual([
          "jev_models",
          "jev_check",
          "jev_classify",
          "jev_score",
          "jev_ask",
        ]);
      } finally {
        await client.close();
      }
    },
    15_000,
  );
});
