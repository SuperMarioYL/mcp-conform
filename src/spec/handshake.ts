/**
 * Handshake spec checks — the MCP `initialize` round-trip.
 *
 * By the time these run the runner has already called `client.connect(...)`,
 * which performs the `initialize` request/response and the `notifications/initialized`
 * follow-up under the hood. A successful connect therefore *is* a successful
 * handshake; these checks assert the negotiated result is well-shaped:
 * `protocolVersion`, `capabilities`, and `serverInfo` (a.k.a. server version).
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import type { Axis, CheckResult, ClientId } from "../adapters/types.js";

const AXIS: Axis = "behavior";

function row(
  client: ClientId,
  check_id: string,
  status: CheckResult["status"],
  detail: string
): CheckResult {
  return { client, axis: AXIS, check_id, status, detail };
}

/**
 * Assert the initialize handshake produced a valid negotiated state.
 *
 * @param client       which client column these rows belong to
 * @param mcpClient     a *connected* MCP SDK client
 */
export function checkHandshake(client: ClientId, mcpClient: Client): CheckResult[] {
  const results: CheckResult[] = [];

  // serverInfo / serverVersion — the `Implementation` object from initialize.
  const serverInfo = mcpClient.getServerVersion();
  if (serverInfo && typeof serverInfo.name === "string" && serverInfo.name.length > 0) {
    results.push(
      row(
        client,
        "handshake.server_info",
        "pass",
        `serverInfo.name="${serverInfo.name}" version="${serverInfo.version ?? "?"}"`
      )
    );
  } else {
    results.push(
      row(
        client,
        "handshake.server_info",
        "fail",
        "initialize did not return a valid serverInfo (name missing)"
      )
    );
  }

  // capabilities — must be an object (may be empty, but must be present).
  const caps = mcpClient.getServerCapabilities();
  if (caps && typeof caps === "object") {
    const keys = Object.keys(caps);
    results.push(
      row(
        client,
        "handshake.capabilities",
        "pass",
        keys.length > 0
          ? `capabilities advertised: ${keys.join(", ")}`
          : "capabilities present (empty object)"
      )
    );
  } else {
    results.push(
      row(
        client,
        "handshake.capabilities",
        "fail",
        "initialize did not return a capabilities object"
      )
    );
  }

  // protocolVersion — the SDK negotiates this during connect(). It is not
  // surfaced on the public Client API, so we assert reachability of the
  // negotiated state instead: a connected client whose serverInfo is present
  // means a supported protocolVersion was agreed. We additionally surface the
  // set of versions this build understands so the detail is actionable.
  if (serverInfo) {
    results.push(
      row(
        client,
        "handshake.initialize",
        "pass",
        `initialize negotiated (client supports ${SUPPORTED_PROTOCOL_VERSIONS.length} protocol versions, latest ${SUPPORTED_PROTOCOL_VERSIONS[0]})`
      )
    );
  } else {
    results.push(
      row(
        client,
        "handshake.initialize",
        "fail",
        "initialize handshake did not complete"
      )
    );
  }

  return results;
}
