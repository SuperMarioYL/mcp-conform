#!/usr/bin/env node
/**
 * Canonical echo MCP server — the conformance fixture.
 *
 * A minimal, fully-compliant MCP server over stdio: it advertises a single
 * `echo` tool that returns its `message` argument. This is the green-path
 * target the conformance suite runs against, so the matrix is reproducible
 * with one command. It uses the official SDK server primitives, so it is a
 * real server, not a mock.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

async function main(): Promise<void> {
  const server = new McpServer(
    { name: "echo-server", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Echo the provided message back to the caller.",
      inputSchema: { message: z.string().describe("Text to echo back") },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Server errors go to stderr so they never corrupt the stdio JSON-RPC stream.
  console.error("echo-server fatal:", err);
  process.exit(1);
});
