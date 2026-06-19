/**
 * Claude Code adapter — the ONE real adapter in v0.1.
 *
 * Claude Code is a stdio MCP host: it spawns servers as child processes and
 * speaks JSON-RPC over stdin/stdout, with no inbound HTTP surface. So this
 * adapter:
 *   - runs the full behavior axis (handshake + tools) against the live client, and
 *   - runs the auth axis as a discovery-shape probe. Over stdio there is no
 *     HTTP endpoint, so the auth checks resolve to `skip` (yellow) — which is
 *     itself a faithful statement of how Claude Code treats a stdio server.
 *
 * Cursor and Gemini adapters are typed `n/a` stubs (see ./types.ts); they are
 * out of scope for v0.1.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { AdapterContext, CheckResult, ClientAdapter } from "./types.js";
import { checkHandshake, checkOAuth, checkTools } from "../spec/index.js";

/** Echo-fixture-friendly default call. Falls back gracefully on other servers. */
const ECHO_CALL = {
  toolName: "echo",
  args: { message: "mcp-conform ping" },
} as const;

export const claudeCodeAdapter: ClientAdapter = {
  id: "claude-code",
  label: "Claude Code",
  implemented: true,

  async run(ctx: AdapterContext, mcpClient: unknown): Promise<CheckResult[]> {
    const client = mcpClient as Client;
    const results: CheckResult[] = [];

    // Behavior axis.
    results.push(...checkHandshake(ctx.client, client));
    results.push(...(await checkTools(ctx.client, client, ECHO_CALL)));

    // Auth axis — stdio: discovery-shape probe with no HTTP base URL => skip.
    results.push(...(await checkOAuth(ctx.client)));

    return results;
  },
};

export default claudeCodeAdapter;
