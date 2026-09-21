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
 * argument when they know the tool surface. `requestTimeoutMs` bounds each
 * protocol request: without it a hang-after-handshake server rides the SDK's
 * DEFAULT_REQUEST_TIMEOUT_MSEC (60s) per request, blowing the §3 "sub-30s
 * total run" contract (the same failure class the m13 OAuth-probe timeout
 * fixed for the auth axis).
 */
export async function checkTools(
  client: ClientId,
  mcpClient: Client,
  callArg: {
    toolName?: string;
    args?: Record<string, unknown>;
    /** True when the user explicitly named the tool (--tool). */
    explicit?: boolean;
  } = {},
  requestTimeoutMs?: number
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const requestOptions = requestTimeoutMs
    ? { timeout: requestTimeoutMs }
    : undefined;

  // --- tools/list shape ---
  let tools: Array<z.infer<typeof ToolShape>> = [];
  try {
    const listed = await mcpClient.listTools({}, requestOptions);
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

  // Resolve the target tool. Prefer the adapter-requested toolName; if it is
  // not advertised by this server, fall back to the first tool — but only for
  // the implicit echo-probe default. When the user explicitly named a tool
  // (--tool), a missing tool is a REAL server failure (the user's intent was
  // explicit), not a synthesized skip.
  //
  // When we fall back we must NOT force the requested tool's args (e.g. the
  // echo fixture's {message}) onto an unrelated tool — that would false-fail
  // any conformant server whose first tool needs different args (e.g. a URL).
  // Instead we derive a minimal valid arguments object from the fallback
  // tool's OWN inputSchema required fields. And if even that synthesized call
  // does not pass, we record `skip` rather than `fail`: the failure stems from
  // the harness being unable to drive a real round-trip, NOT from the server
  // being non-conformant. A conformant server that accepts the synthesized
  // args still reaches `pass`.
  const requestedTool = callArg.toolName
    ? tools.find((t) => t.name === callArg.toolName)
    : undefined;
  if (callArg.toolName && !requestedTool && callArg.explicit) {
    results.push(
      row(
        client,
        "tools.call_roundtrip",
        "fail",
        `tools/call "${callArg.toolName}" failed: tool is not advertised by the server (tools/list: ${tools.map((t) => t.name).join(", ") || "no tools"})`
      )
    );
    return results;
  }
  const targetTool = requestedTool ?? tools[0]!;
  const target = targetTool.name;
  /** True when the adapter's implicit requested tool is not on this server. */
  const isFallback = !requestedTool;
  const args = isFallback
    ? deriveMinimalArgs(targetTool.inputSchema)
    : callArg.args ?? {};

  try {
    const callResult = await mcpClient.callTool(
      { name: target, arguments: args },
      undefined,
      requestOptions
    );
    const content = (callResult as { content?: unknown }).content;
    const parsed = z.array(ContentBlock).safeParse(content);
    if (!parsed.success) {
      const detail = `tools/call "${target}" returned no valid content array: ${parsed.error.issues[0]?.message ?? "unknown"}`;
      results.push(
        row(
          client,
          "tools.call_roundtrip",
          isFallback ? "skip" : "fail",
          isFallback ? `${detail} (harness fallback: use --tool/--args to drive an explicit round-trip)` : detail
        )
      );
    } else if ((callResult as { isError?: boolean }).isError) {
      const detail = `tools/call "${target}" responded with isError=true${isFallback ? " using harness-synthesized args" : ""}`;
      results.push(
        row(
          client,
          "tools.call_roundtrip",
          isFallback ? "skip" : "fail",
          isFallback ? `${detail} (harness fallback: use --tool/--args to drive an explicit round-trip)` : detail
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
    const detail = `tools/call "${target}" threw: ${errMessage(err)}`;
    results.push(
      row(
        client,
        "tools.call_roundtrip",
        isFallback ? "skip" : "fail",
        isFallback ? `${detail} (harness fallback: use --tool/--args to drive an explicit round-trip)` : detail
      )
    );
  }

  return results;
}

/**
 * Derive a minimal valid arguments object from a tool's `inputSchema`, so a
 * fallback `tools/call` (the adapter's requested tool is not on this server)
 * does not force the requested tool's args onto an unrelated tool. For each
 * `required` property a type-appropriate placeholder is supplied; a property
 * with a `default` uses it; unknown types fall back to `null`. A schema with
 * no `required` fields yields `{}` — a conformant server must accept that.
 */
function deriveMinimalArgs(inputSchema: unknown): Record<string, unknown> {
  const schema = (inputSchema ?? {}) as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const args: Record<string, unknown> = {};
  for (const field of required) {
    if (typeof field !== "string") continue;
    const prop = properties[field];
    if (prop && "default" in prop && prop.default !== undefined) {
      args[field] = prop.default;
    } else {
      args[field] = placeholderFor(prop);
    }
  }
  return args;
}

/** Type-appropriate placeholder for a synthesized argument value. */
function placeholderFor(prop: unknown): unknown {
  if (!prop || typeof prop !== "object") return null;
  const type = (prop as Record<string, unknown>).type;
  switch (type) {
    case "string":
      return "mcp-conform-probe";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
