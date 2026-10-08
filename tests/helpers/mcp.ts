import { pathToFileURL } from "node:url";
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { resetClient, type ClientDeps } from "../../src/client.ts";
import { createServer } from "../../src/server.ts";

/** A client that declares MCP roots, as Claude Code does with its working directory. */
export async function clientWithRoots(deps: ClientDeps, roots: readonly string[]) {
  resetClient();
  const server = createServer(deps);
  const client = new Client({ name: "test-harness", version: "1.0.0" }, { capabilities: { roots: {} } });
  let rootRequests = 0;
  client.setRequestHandler("roots/list", () => {
    rootRequests += 1;
    return { roots: roots.map((r) => ({ uri: pathToFileURL(r).href })) };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    /** How many times the server asked for the roots. */
    rootRequests: () => rootRequests,
    close: async () => {
      await client.close();
      await server.close();
      resetClient();
    },
  };
}

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
