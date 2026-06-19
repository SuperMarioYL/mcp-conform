/**
 * Tools spec checks — `tools/list` shape + a `tools/call` round-trip.
 *
 * These are the behavioral core: a conformant server must advertise a valid
 * `ListToolsResult` and round-trip at least one `tools/call`. We validate the
 * SDK-returned shapes with a small zod schema rather than trusting the SDK's
 * own decode, so the failing assertion can be named precisely in the matrix.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import type { Axis, CheckResult, ClientId } from "../adapters/types.js";

const AXIS: Axis = "behavior";

/** Minimal shape of a single tool entry in a ListToolsResult. */
const ToolShape = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.object({ type: z.literal("object") }).passthrough(),
});

/** Minimal shape of a CallToolResult content block. */
const ContentBlock = z
  .object({ type: z.string() })
  .passthrough();

function row(
  client: ClientId,
  check_id: string,
  status: CheckResult["status"],
  detail: string
): CheckResult {
  return { client, axis: AXIS, check_id, status, detail };
}

/**
 * Run `tools/list` and a `tools/call`. The `callArg` shapes the round-trip
 * payload for the canonical echo fixture; adapters can pass a server-specific
 * argument when they know the tool surface.
 */
export async function checkTools(
  client: ClientId,
  mcpClient: Client,
  callArg: { toolName?: string; args?: Record<string, unknown> } = {}
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // --- tools/list shape ---
  let tools: Array<z.infer<typeof ToolShape>> = [];
  try {
    const listed = await mcpClient.listTools();
    const parsed = z.array(ToolShape).safeParse(listed.tools);
    if (!parsed.success) {
      results.push(
        row(
          client,
          "tools.list_schema",
          "fail",
          `tools/list returned an invalid ListToolsResult: ${parsed.error.issues[0]?.message ?? "unknown"}`
        )
      );
      // Without a valid list we cannot meaningfully round-trip a call.
      results.push(
        row(client, "tools.call_roundtrip", "skip", "skipped: tools/list invalid")
      );
      return results;
    }
    tools = parsed.data;
    results.push(
      row(
        client,
        "tools.list_schema",
        "pass",
        tools.length > 0
          ? `tools/list returned ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`
          : "tools/list returned a valid (empty) tool list"
      )
    );
  } catch (err) {
    results.push(
      row(
        client,
        "tools.list_schema",
        "fail",
        `tools/list threw: ${errMessage(err)}`
      )
    );
    results.push(
      row(client, "tools.call_roundtrip", "skip", "skipped: tools/list threw")
    );
    return results;
  }

  // --- tools/call round-trip ---
  if (tools.length === 0) {
    results.push(
      row(
        client,
        "tools.call_roundtrip",
        "skip",
        "skipped: server advertises no tools to call"
      )
    );
    return results;
  }

  const target =
    (callArg.toolName && tools.find((t) => t.name === callArg.toolName)?.name) ||
    tools[0]!.name;
  const args = callArg.args ?? {};

  try {
    const callResult = await mcpClient.callTool({ name: target, arguments: args });
    const content = (callResult as { content?: unknown }).content;
    const parsed = z.array(ContentBlock).safeParse(content);
    if (!parsed.success) {
      results.push(
        row(
          client,
          "tools.call_roundtrip",
          "fail",
          `tools/call "${target}" returned no valid content array: ${parsed.error.issues[0]?.message ?? "unknown"}`
        )
      );
    } else if ((callResult as { isError?: boolean }).isError) {
      results.push(
        row(
          client,
          "tools.call_roundtrip",
          "fail",
          `tools/call "${target}" responded with isError=true`
        )
      );
    } else {
      results.push(
        row(
          client,
          "tools.call_roundtrip",
          "pass",
          `tools/call "${target}" round-tripped (${parsed.data.length} content block(s))`
        )
      );
    }
  } catch (err) {
    results.push(
      row(
        client,
        "tools.call_roundtrip",
        "fail",
        `tools/call "${target}" threw: ${errMessage(err)}`
      )
    );
  }

  return results;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
