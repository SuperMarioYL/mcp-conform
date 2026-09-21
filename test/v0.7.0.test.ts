/**
 * v0.7.0 amendment regression tests.
 *
 * Each block pins one milestone:
 *   - fix-stderr-pipe-undrained: a chatty server (sync stderr writes) must not
 *     stall or false-fail; the failure detail surfaces the stderr tail.
 *   - fix-tools-request-60s-stall: the tools axis honors the run timeout
 *     instead of the SDK's 60s default.
 *   - fix-wellknown-path-insertion: RFC 9728 §3.1 path-inserted metadata URL
 *     is probed first, with the legacy root URL as fallback.
 *   - feat-tool-args-flags: --tool/--args drive an explicit round-trip; an
 *     explicitly-missed tool is a real fail, not a synthesized skip.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { run } from "../src/runner.js";
import { checkTools } from "../src/spec/tools.js";
import { checkOAuth } from "../src/spec/oauth.js";
import { VERSION } from "../src/version.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const echoServer = resolve(repoRoot, "dist/fixtures/echo-server/server.js");

/** A server that writes KB kilobytes to stderr synchronously, then speaks MCP. */
function chattyServerScript(kb: number): string {
  return `
const fs = require("node:fs");
const buf = Buffer.alloc(1024, 0x78);
for (let i = 0; i < ${kb}; i++) { try { fs.writeSync(2, buf); } catch {} }
let acc = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  acc += d;
  let i;
  while ((i = acc.indexOf("\\n")) !== -1) {
    const line = acc.slice(0, i); acc = acc.slice(i + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize" && msg.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "chatty", version: "0.0.0" } } }) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\\n");
    } else if (msg.method === "tools/list" && msg.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "t", inputSchema: { type: "object" } }] } }) + "\\n");
    } else if (msg.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } }) + "\\n");
    }
  }
});
`;
}

/** A server that completes the handshake and then goes silent. */
const hangServerScript = `
let acc = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  acc += d;
  let i;
  while ((i = acc.indexOf("\\n")) !== -1) {
    const line = acc.slice(0, i); acc = acc.slice(i + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize" && msg.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "hang", version: "0.0.0" } } }) + "\\n");
    }
  }
});
`;

describe("v0.7.0 amendments", () => {
  describe("fix-stderr-pipe-undrained", () => {
    it("a 200KB sync-stderr writer completes the handshake (was: false 'handshake timed out')", async () => {
      const report = await run({
        command: process.execPath,
        args: ["-e", chattyServerScript(200)],
        timeoutMs: 8_000,
      });
      const hs = report.results.find((r) => r.check_id === "handshake.initialize");
      expect(hs?.status).toBe("pass");
      const tools = report.results.find((r) => r.check_id === "tools.call_roundtrip");
      expect(tools?.status).toBe("pass");
    }, 30_000);

    it("the failure detail carries a capped stderr tail for diagnostics", async () => {
      const script = `
console.error("MCP-CONFORM-STDERR-MARKER boom");
process.exit(1);
`;
      const report = await run({
        command: process.execPath,
        args: ["-e", script],
        timeoutMs: 5_000,
      });
      const hs = report.results.find((r) => r.check_id === "handshake.initialize");
      expect(hs?.status).toBe("fail");
      expect(hs?.detail).toContain("MCP-CONFORM-STDERR-MARKER");
    }, 30_000);
  });

  describe("fix-tools-request-60s-stall", () => {
    it("a hang-after-handshake server fails the tools axis inside the run timeout (was: 60s SDK default)", async () => {
      const t0 = Date.now();
      const report = await run({
        command: process.execPath,
        args: ["-e", hangServerScript],
        timeoutMs: 2_000,
      });
      const elapsed = Date.now() - t0;
      const listRow = report.results.find((r) => r.check_id === "tools.list_schema");
      expect(listRow?.status).toBe("fail");
      expect(listRow?.detail).toMatch(/timed out/i);
      // The pre-fix behavior stalled 60s (SDK DEFAULT_REQUEST_TIMEOUT_MSEC).
      expect(elapsed).toBeLessThan(15_000);
    }, 30_000);
  });

  describe("fix-wellknown-path-insertion", () => {
    const metadata = {
      resource: "https://api.example.com/mcp",
      authorization_servers: ["https://auth.example.com"],
    };
    const jsonResponse = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const statusResponse = (status: number) =>
      new Response("nope", { status });
    const insertedUrl = (base: string) => {
      const u = new URL(base);
      return `${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/+$/, "")}`;
    };
    const rootUrl = (base: string) =>
      `${new URL(base).origin}/.well-known/oauth-protected-resource`;

    it("probes the RFC 9728 §3.1 path-inserted URL first and passes (was: root-only probe, false 404 fail)", async () => {
      const fetched: string[] = [];
      const fakeFetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        fetched.push(url);
        if (url === insertedUrl("https://api.example.com/mcp")) {
          return jsonResponse(metadata);
        }
        return statusResponse(404);
      }) as typeof fetch;

      const rows = await checkOAuth("claude-code", {
        baseUrl: "https://api.example.com/mcp",
        fetchImpl: fakeFetch,
      });
      const prm = rows.find((r) => r.check_id === "oauth.protected_resource_metadata");
      expect(prm?.status).toBe("pass");
      expect(prm?.detail).toContain(insertedUrl("https://api.example.com/mcp"));
      expect(fetched[0]).toBe(insertedUrl("https://api.example.com/mcp"));
    });

    it("a root-only deployment still passes via the legacy fallback", async () => {
      const fakeFetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === rootUrl("https://api.example.com/mcp")) {
          return jsonResponse(metadata);
        }
        return statusResponse(404);
      }) as typeof fetch;

      const rows = await checkOAuth("claude-code", {
        baseUrl: "https://api.example.com/mcp",
        fetchImpl: fakeFetch,
      });
      const prm = rows.find((r) => r.check_id === "oauth.protected_resource_metadata");
      expect(prm?.status).toBe("pass");
      expect(prm?.detail).toContain(rootUrl("https://api.example.com/mcp"));
    });

    it("a pathless resource probes the root URL only (unchanged)", async () => {
      const fetched: string[] = [];
      const fakeFetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        fetched.push(url);
        if (url === rootUrl("https://api.example.com")) {
          return jsonResponse({ resource: "https://api.example.com" });
        }
        return statusResponse(404);
      }) as typeof fetch;

      const rows = await checkOAuth("claude-code", {
        baseUrl: "https://api.example.com",
        fetchImpl: fakeFetch,
      });
      const prm = rows.find((r) => r.check_id === "oauth.protected_resource_metadata");
      expect(prm?.status).toBe("pass");
      expect(fetched.filter((u) => u.endsWith("oauth-protected-resource"))).toHaveLength(1);
    });
  });

  describe("feat-tool-args-flags", () => {
    it("--tool echo --args drives an explicit round-trip on the fixture", async () => {
      const report = await run({
        command: process.execPath,
        args: [echoServer],
        tool: "echo",
        toolArgs: { message: "hi from v0.7.0" },
        timeoutMs: 8_000,
      });
      const call = report.results.find((r) => r.check_id === "tools.call_roundtrip");
      expect(call?.status).toBe("pass");
      expect(call?.detail).toContain('"echo"');
    }, 30_000);

    it("--tool naming a missing tool is a real FAIL, not a synthesized skip", async () => {
      const report = await run({
        command: process.execPath,
        args: [echoServer],
        tool: "missing-tool",
        timeoutMs: 8_000,
      });
      const call = report.results.find((r) => r.check_id === "tools.call_roundtrip");
      expect(call?.status).toBe("fail");
      expect(call?.detail).toContain("not advertised");
    }, 30_000);

    it("CLI: --tool echo --args '{...}' exits 0 on the fixture", () => {
      const out = execFileSync(
        process.execPath,
        [
          resolve(repoRoot, "dist/cli.js"),
          "run",
          process.execPath,
          echoServer,
          "--tool",
          "echo",
          "--args",
          '{"message":"hi"}',
          "--json",
        ],
        { encoding: "utf8" }
      );
      const view = JSON.parse(out) as { cells: Array<{ client: string; axis: string; status: string }> };
      const ccBehavior = view.cells.find(
        (c) => c.client === "claude-code" && c.axis === "behavior"
      );
      expect(ccBehavior?.status).toBe("pass");
    }, 30_000);

    it("CLI: --args without --tool errors with exit 2; bad JSON errors with exit 2", () => {
      const runCli = (extraArgs: string[]): number => {
        try {
          execFileSync(
            process.execPath,
            [
              resolve(repoRoot, "dist/cli.js"),
              "run",
              process.execPath,
              echoServer,
              ...extraArgs,
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
          );
          return 0;
        } catch (err) {
          return (err as { status?: number }).status ?? 1;
        }
      };
      expect(runCli(["--args", '{"message":"hi"}'])).toBe(2);
      expect(runCli(["--tool", "echo", "--args", "{not json"])).toBe(2);
    }, 30_000);
  });

  describe("version lockstep (v0.7.0 bump)", () => {
    it("all four version surfaces read 0.7.0", () => {
      expect(VERSION).toBe("0.7.0");
      const pkg = JSON.parse(
        readFileSync(resolve(repoRoot, "package.json"), "utf8")
      ) as { version: string };
      expect(pkg.version).toBe("0.7.0");
      const site = JSON.parse(
        readFileSync(resolve(repoRoot, "web/site.json"), "utf8")
      ) as { meta?: { content_version?: string } };
      expect(site.meta?.content_version).toBe("0.7.0");
      const changelog = readFileSync(resolve(repoRoot, "CHANGELOG.md"), "utf8");
      expect(changelog.match(/^##\s+\[([0-9.]+)\]/m)?.[1]).toBe("0.7.0");
    });
  });
});
