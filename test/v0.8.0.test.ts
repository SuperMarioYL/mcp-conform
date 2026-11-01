/**
 * v0.8.0 amendment regression tests.
 *
 * Each block pins one milestone:
 *   - fix-tools-list-pagination: every `tools/list` page is walked, so a tool
 *     advertised on a later page is found and the reported count is complete.
 *   - fix-oauth-metadata-unusable-doc-fallback: a 2xx that is not Protected
 *     Resource Metadata falls through to the legacy root URL.
 *   - fix-cli-output-write-error-traceback: an unwritable --report/--badge path
 *     exits 2 with a clean error line, not a Node stack trace.
 *   - fix-cli-timeout-validation: an invalid --timeout is a usage error, not a
 *     silent default or a bogus immediate fail.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { checkTools } from "../src/spec/tools.js";
import { checkOAuth } from "../src/spec/oauth.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliPath = resolve(repoRoot, "dist/cli.js");
const echoServer = resolve(repoRoot, "dist/fixtures/echo-server/server.js");

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run the built CLI and capture its exit status even when it is non-zero. */
function runCli(args: string[]): CliRun {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

const echoTool = (name: string) => ({
  name,
  inputSchema: { type: "object" as const },
});

describe("v0.8.0 amendments", () => {
  describe("fix-tools-list-pagination", () => {
    it("walks nextCursor, counts every page, and finds a tool on page 2", async () => {
      const pages: Array<{ tools: any[]; nextCursor?: string }> = [
        { tools: [echoTool("alpha")], nextCursor: "p1" },
        { tools: [echoTool("beta")] },
      ];
      const cursors: Array<string | undefined> = [];
      const fakeClient = {
        listTools: async (params?: { cursor?: string }) => {
          cursors.push(params?.cursor);
          return pages[params?.cursor ? 1 : 0]!;
        },
        callTool: async (req: { name: string }) => ({
          content: [{ type: "text", text: `ok:${req.name}` }],
        }),
      } as unknown as Client;

      const rows = await checkTools("claude-code", fakeClient, {
        toolName: "beta",
        explicit: true,
      });

      // Before the fix only page 1 was requested: the count read 1 and the
      // explicitly named page-2 tool false-failed as "not advertised".
      expect(cursors).toEqual([undefined, "p1"]);
      const listRow = rows.find((r) => r.check_id === "tools.list_schema");
      expect(listRow?.status).toBe("pass");
      expect(listRow?.detail).toContain("2 tool(s)");
      expect(listRow?.detail).toContain("beta");
      const callRow = rows.find((r) => r.check_id === "tools.call_roundtrip");
      expect(callRow?.status).toBe("pass");
      expect(callRow?.detail).toContain('"beta"');
    });

    it("fails the list check on a repeated cursor instead of looping forever", async () => {
      const fakeClient = {
        listTools: async () => ({
          tools: [echoTool("alpha")],
          nextCursor: "same",
        }),
        callTool: async () => ({ content: [] }),
      } as unknown as Client;

      const rows = await checkTools("claude-code", fakeClient, {});
      const listRow = rows.find((r) => r.check_id === "tools.list_schema");
      expect(listRow?.status).toBe("fail");
      expect(listRow?.detail).toContain("repeated cursor");
      const callRow = rows.find((r) => r.check_id === "tools.call_roundtrip");
      expect(callRow?.status).toBe("skip");
    });
  });

  describe("fix-oauth-metadata-unusable-doc-fallback", () => {
    const base = "https://api.example.com/mcp";
    const inserted = `${new URL(base).origin}/.well-known/oauth-protected-resource/mcp`;
    const root = `${new URL(base).origin}/.well-known/oauth-protected-resource`;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    it("falls back to the root URL when the path-inserted URL answers 2xx with a non-metadata page", async () => {
      const fakeFetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === inserted) {
          // An SPA catch-all: 2xx, but not Protected Resource Metadata.
          return new Response("<html>app shell</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        if (url === root) return json({ resource: base });
        return new Response("nope", { status: 404 });
      }) as typeof fetch;

      const rows = await checkOAuth("claude-code", {
        baseUrl: base,
        fetchImpl: fakeFetch,
      });
      const meta = rows.find(
        (r) => r.check_id === "oauth.protected_resource_metadata"
      );
      expect(meta?.status).toBe("pass");
      expect(meta?.detail).toContain(`valid Protected Resource Metadata at ${root}`);
    });

    it("reports every unusable candidate when no URL serves usable metadata", async () => {
      const fakeFetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === inserted) {
          return new Response("<html>app shell</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        return new Response("nope", { status: 404 });
      }) as typeof fetch;

      const rows = await checkOAuth("claude-code", {
        baseUrl: base,
        fetchImpl: fakeFetch,
      });
      const meta = rows.find(
        (r) => r.check_id === "oauth.protected_resource_metadata"
      );
      expect(meta?.status).toBe("fail");
      expect(meta?.detail).toContain(`invalid Protected Resource Metadata at ${inserted}`);
      expect(meta?.detail).toContain(`GET ${root} -> HTTP 404`);
    });
  });

  describe("fix-cli-output-write-error-traceback", () => {
    it("--report to a missing directory exits 2 with a clean error and no stack", () => {
      const dir = mkdtempSync(join(tmpdir(), "mcp-conform-report-"));
      try {
        const missing = join(dir, "nested", "report.json");
        const out = runCli([
          "run",
          process.execPath,
          echoServer,
          "--report",
          missing,
          "--json",
        ]);
        expect(out.status).toBe(2);
        expect(out.stderr).toContain(`error: cannot write ${missing}`);
        expect(out.stderr).not.toMatch(/^\s+at /m);
        expect(out.stderr).not.toContain("    at ");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("--badge to a missing directory exits 2 with a clean error, and a valid dir still writes", () => {
      const dir = mkdtempSync(join(tmpdir(), "mcp-conform-badge-"));
      try {
        const bad = runCli([
          "run",
          process.execPath,
          echoServer,
          "--badge",
          join(dir, "nested"),
          "--json",
        ]);
        expect(bad.status).toBe(2);
        expect(bad.stderr).toContain("error: cannot write ");
        expect(bad.stderr).not.toContain("    at ");

        const good = runCli([
          "run",
          process.execPath,
          echoServer,
          "--badge",
          dir,
          "--json",
        ]);
        expect(good.status).toBe(0);
        expect(readFileSync(join(dir, "badge.json"), "utf8")).toContain(
          '"label": "mcp-conform"'
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("fix-cli-timeout-validation", () => {
    it("rejects a non-numeric, zero, or negative --timeout with exit 2", () => {
      for (const raw of ["abc", "0", "-5"]) {
        const out = runCli([
          "run",
          process.execPath,
          echoServer,
          "--timeout",
          raw,
          "--json",
        ]);
        expect(out.status, `--timeout ${raw}`).toBe(2);
        expect(out.stderr).toContain("error: --timeout must be a positive integer");
        expect(out.stderr).toContain(`(got "${raw}")`);
        // A rejected timeout must not spawn and grade the server.
        expect(out.stdout.trim()).toBe("");
      }
    });

    it("still accepts a positive integer --timeout", () => {
      const out = runCli([
        "run",
        process.execPath,
        echoServer,
        "--timeout",
        "8000",
        "--json",
      ]);
      expect(out.status).toBe(0);
      expect(out.stdout).toContain('"status": "pass"');
    });
  });
});
