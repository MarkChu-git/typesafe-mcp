import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { resetClient, type ClientDeps } from "../../src/client.ts";
import { createServer } from "../../src/server.ts";

export async function inProcessClient(deps: ClientDeps) {
  resetClient();
  const handler = createMcpHandler(() => createServer(deps));
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      return handler.fetch(request);
    },
  });
  const client = new Client(
    { name: "test-harness", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
      await handler.close();
      resetClient();
    },
  };
}
