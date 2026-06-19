/**
 * Runner — spawns the target MCP server over stdio, connects an MCP SDK client,
 * runs every adapter's checks against that single live connection, and collects
 * the rows into a {@link ConformanceReport}.
 *
 * The server is spawned exactly once. The real adapter (Claude Code) drives the
 * live behavior + auth checks; the stub adapters (Cursor, Gemini) emit `n/a`
 * rows without touching the connection. This keeps the matrix three-wide from
 * day one while only one client is genuinely wired up.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  cursorAdapter,
  geminiAdapter,
  type ClientAdapter,
  type ConformanceReport,
} from "./adapters/types.js";
import { claudeCodeAdapter } from "./adapters/claude-code.js";
import { SPEC_VERSION } from "./spec/index.js";

/** The fixed three-client adapter set (real + stubs), in matrix column order. */
export const ADAPTERS: ClientAdapter[] = [
  claudeCodeAdapter,
  cursorAdapter,
  geminiAdapter,
];

export interface RunOptions {
  /** Executable to spawn (e.g. `node`, `python`, `./my-server`). */
  command: string;
  /** Arguments passed to the executable. */
  args?: string[];
  /** Working directory for the spawned server. */
  cwd?: string;
  /** Extra env for the spawned server. */
  env?: Record<string, string>;
  /** Override the adapter set (used by tests). Defaults to {@link ADAPTERS}. */
  adapters?: ClientAdapter[];
  /** Connection timeout in ms (default 15000). */
  timeoutMs?: number;
}

/**
 * Spawn the server, run the conformance suite, and return the typed report.
 * Always tears the transport down, even on failure.
 */
export async function run(opts: RunOptions): Promise<ConformanceReport> {
  const adapters = opts.adapters ?? ADAPTERS;
  const report: ConformanceReport = {
    server: {
      cmd: [opts.command, ...(opts.args ?? [])].join(" "),
      transport: "stdio",
    },
    spec_version: SPEC_VERSION,
    results: [],
  };

  const transport = new StdioClientTransport({
    command: opts.command,
    args: opts.args ?? [],
    cwd: opts.cwd,
    env: opts.env ? { ...getBaseEnv(), ...opts.env } : undefined,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "mcp-conform", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    await withTimeout(
      client.connect(transport),
      opts.timeoutMs ?? 15_000,
      "MCP initialize handshake timed out"
    );
  } catch (err) {
    // Connect (= handshake) failed: every real adapter records a hard fail on
    // the handshake check; stubs still emit their n/a rows.
    const detail = `failed to connect/handshake with server: ${errMessage(err)}`;
    for (const adapter of adapters) {
      if (adapter.implemented) {
        report.results.push({
          client: adapter.id,
          axis: "behavior",
          check_id: "handshake.initialize",
          status: "fail",
          detail,
        });
      } else {
        report.results.push(
          ...(await adapter.run(
            { client: adapter.id, serverCmd: opts.command, serverArgs: opts.args ?? [] },
            undefined
          ))
        );
      }
    }
    await safeClose(transport);
    return report;
  }

  try {
    for (const adapter of adapters) {
      const ctx = {
        client: adapter.id,
        serverCmd: opts.command,
        serverArgs: opts.args ?? [],
      };
      report.results.push(...(await adapter.run(ctx, client)));
    }
  } finally {
    await safeClose(client);
    await safeClose(transport);
  }

  return report;
}

/** True iff no `fail` rows exist (n/a and skip do not fail the run). */
export function isGreen(report: ConformanceReport): boolean {
  return !report.results.some((r) => r.status === "fail");
}

function getBaseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeClose(closable: { close: () => Promise<void> | void }): Promise<void> {
  try {
    await closable.close();
  } catch {
    /* best-effort teardown */
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
