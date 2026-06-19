/**
 * Adapter contract + the core conformance primitive.
 *
 * The new noun this tool introduces is the *conformance matrix*: a versioned
 * report keyed by `(client, axis, check_id)`. Every spec check returns a
 * {@link CheckResult} row; the runner collects them into a {@link ConformanceReport}.
 */

/** The MCP clients whose behavior we assert parity across. */
export type ClientId = "claude-code" | "cursor" | "gemini";

/** The two parity dimensions a server is graded on. */
export type Axis = "behavior" | "auth";

/** Per-cell verdict. `n/a` means the client has no real adapter yet. */
export type CheckStatus = "pass" | "fail" | "skip" | "n/a";

/** One row of the conformance matrix. */
export interface CheckResult {
  client: ClientId;
  axis: Axis;
  /** Stable identifier, e.g. `handshake.initialize`, `oauth.www_authenticate`. */
  check_id: string;
  status: CheckStatus;
  /** Human-readable detail; on failure this names the failed assertion. */
  detail: string;
}

/** The full versioned report — the primitive from mvp_plan §2. */
export interface ConformanceReport {
  server: {
    cmd: string;
    transport: "stdio";
  };
  spec_version: string;
  results: CheckResult[];
}

/**
 * Context handed to an adapter when it runs its checks.
 *
 * `client` lets shared spec checks stamp the correct row. `serverCmd`/`serverArgs`
 * describe the spawned target; the runner owns the actual MCP SDK client so the
 * spawn happens exactly once and every adapter observes the same live server.
 */
export interface AdapterContext {
  client: ClientId;
  serverCmd: string;
  serverArgs: string[];
}

/**
 * A client adapter knows how a specific MCP host (Claude Code, Cursor, Gemini)
 * is expected to talk to a server, and produces the rows for that client.
 *
 * v0.1 ships exactly one *real* adapter (Claude Code). Cursor and Gemini are
 * declared here as typed stubs that return `n/a` rows so the matrix always has
 * three columns — the harness is built for three clients from day one even
 * though only one is wired up. (Cursor/Gemini real adapters are out of scope
 * for v0.1; see mvp_plan §6.)
 */
export interface ClientAdapter {
  readonly id: ClientId;
  /** Display name for the matrix header. */
  readonly label: string;
  /** True for the one real adapter; false for the `n/a` stubs. */
  readonly implemented: boolean;
  /**
   * Run this client's checks against the already-connected MCP client.
   * `mcpClient` is typed `unknown` here to keep this module free of an SDK
   * import; the runner narrows it to the real `Client` before calling.
   */
  run(ctx: AdapterContext, mcpClient: unknown): Promise<CheckResult[]>;
}

/** Build the `n/a` rows a stub adapter emits for both axes. */
export function naRows(client: ClientId, reason: string): CheckResult[] {
  return [
    {
      client,
      axis: "behavior",
      check_id: "adapter.not_implemented",
      status: "n/a",
      detail: reason,
    },
    {
      client,
      axis: "auth",
      check_id: "adapter.not_implemented",
      status: "n/a",
      detail: reason,
    },
  ];
}

/**
 * Cursor adapter — typed stub. Returns `n/a` for every axis.
 * A real Cursor adapter is deferred to v0.2 (mvp_plan out_of_scope).
 */
export const cursorAdapter: ClientAdapter = {
  id: "cursor",
  label: "Cursor",
  implemented: false,
  async run(ctx) {
    return naRows(ctx.client, "Cursor adapter not yet implemented (v0.2)");
  },
};

/**
 * Gemini adapter — typed stub. Returns `n/a` for every axis.
 * A real Gemini adapter is deferred to v0.2 (mvp_plan out_of_scope).
 */
export const geminiAdapter: ClientAdapter = {
  id: "gemini",
  label: "Gemini",
  implemented: false,
  async run(ctx) {
    return naRows(ctx.client, "Gemini adapter not yet implemented (v0.2)");
  },
};
