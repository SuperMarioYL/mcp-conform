/**
 * Conformance suite tests — the m3 milestone in miniature: spawn the bundled
 * echo fixture and assert a green matrix is reproducible end-to-end.
 *
 * Tests run against the compiled fixture in `dist/` (build runs before test in
 * CI), so the spawn path matches exactly what a user gets from `npm run build`.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer, type AddressInfo } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { run, isGreen, ADAPTERS } from "../src/runner.js";
import { buildMatrix, rollup } from "../src/report/matrix.js";
import {
  badgeStatus,
  buildBadgeJson,
  buildBadgeSvg,
} from "../src/report/badge.js";
import {
  checkTools,
  checkOAuth,
  parseWwwAuthenticate,
  validateProtectedResourceMetadata,
} from "../src/spec/index.js";
import { VERSION } from "../src/version.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const echoServer = resolve(repoRoot, "dist/fixtures/echo-server/server.js");

describe("runner against the echo fixture", () => {
  it("the compiled fixture exists (run `npm run build` first)", () => {
    expect(
      existsSync(echoServer),
      `expected compiled fixture at ${echoServer} — run 'npm run build'`
    ).toBe(true);
  });

  it("spawns over stdio, completes the handshake, and round-trips a tool call", async () => {
    const report = await run({ command: process.execPath, args: [echoServer] });

    expect(report.server.transport).toBe("stdio");
    expect(report.spec_version).toBe("0.1");

    const cc = report.results.filter((r) => r.client === "claude-code");
    const byId = new Map(cc.map((r) => [r.check_id, r]));

    expect(byId.get("handshake.initialize")?.status).toBe("pass");
    expect(byId.get("handshake.server_info")?.status).toBe("pass");
    expect(byId.get("handshake.capabilities")?.status).toBe("pass");
    expect(byId.get("tools.list_schema")?.status).toBe("pass");
    expect(byId.get("tools.call_roundtrip")?.status).toBe("pass");
  }, 30_000);

  it("produces a green run (no hard failures)", async () => {
    const report = await run({ command: process.execPath, args: [echoServer] });
    expect(isGreen(report)).toBe(true);
  }, 30_000);

  it("emits exactly three client columns, with Cursor/Gemini as n/a stubs", async () => {
    const report = await run({ command: process.execPath, args: [echoServer] });
    const view = buildMatrix(report);

    const clients = new Set(view.cells.map((c) => c.client));
    expect([...clients].sort()).toEqual(["claude-code", "cursor", "gemini"]);

    // Claude Code behavior cell is green.
    const ccBehavior = view.cells.find(
      (c) => c.client === "claude-code" && c.axis === "behavior"
    );
    expect(ccBehavior?.status).toBe("pass");

    // Stub adapters resolve to n/a on both axes.
    for (const stub of ["cursor", "gemini"] as const) {
      for (const axis of ["behavior", "auth"] as const) {
        const cell = view.cells.find((c) => c.client === stub && c.axis === axis);
        expect(cell?.status).toBe("n/a");
      }
    }
  }, 30_000);

  it("auth axis over stdio resolves to skip (optional), not fail", async () => {
    const report = await run({ command: process.execPath, args: [echoServer] });
    const view = buildMatrix(report);
    const ccAuth = view.cells.find(
      (c) => c.client === "claude-code" && c.axis === "auth"
    );
    expect(ccAuth?.status).toBe("skip");
  }, 30_000);

  it("badge reflects a partial verdict (passing behavior + skipped/na auth)", async () => {
    const report = await run({ command: process.execPath, args: [echoServer] });
    expect(badgeStatus(report)).toBe("partial");
    const svg = buildBadgeSvg(report);
    expect(svg).toContain("<svg");
    expect(svg).toContain("mcp-conform");
    const json = buildBadgeJson(report);
    expect(json.schemaVersion).toBe(1);
    expect(json.label).toBe("mcp-conform");
  }, 30_000);

  it("a bad server command yields a handshake fail, not a crash", async () => {
    const report = await run({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      timeoutMs: 5_000,
    });
    const handshake = report.results.find(
      (r) => r.client === "claude-code" && r.check_id === "handshake.initialize"
    );
    expect(handshake?.status).toBe("fail");
    expect(isGreen(report)).toBe(false);
  }, 30_000);
});

describe("matrix rollup", () => {
  it("fail dominates", () => {
    expect(rollup(["pass", "fail", "skip"])).toBe("fail");
  });
  it("all n/a -> n/a", () => {
    expect(rollup(["n/a", "n/a"])).toBe("n/a");
  });
  it("pass over skip -> pass", () => {
    expect(rollup(["pass", "skip"])).toBe("pass");
  });
  it("all skip -> skip", () => {
    expect(rollup(["skip", "skip"])).toBe("skip");
  });
  it("empty -> n/a", () => {
    expect(rollup([])).toBe("n/a");
  });
});

describe("adapter set", () => {
  it("ships exactly one real adapter (Claude Code) plus two stubs", () => {
    const real = ADAPTERS.filter((a) => a.implemented);
    expect(real.map((a) => a.id)).toEqual(["claude-code"]);
    const stubs = ADAPTERS.filter((a) => !a.implemented).map((a) => a.id).sort();
    expect(stubs).toEqual(["cursor", "gemini"]);
  });

  it("stub adapters return n/a rows without a live client", async () => {
    const cursor = ADAPTERS.find((a) => a.id === "cursor")!;
    const rows = await cursor.run(
      { client: "cursor", serverCmd: "x", serverArgs: [] },
      undefined
    );
    expect(rows.every((r) => r.status === "n/a")).toBe(true);
  });
});

describe("oauth discovery-shape helpers", () => {
  it("parses a Bearer WWW-Authenticate challenge", () => {
    const { scheme, params } = parseWwwAuthenticate(
      'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource", error="invalid_token"'
    );
    expect(scheme).toBe("bearer");
    expect(params.resource_metadata).toBe(
      "https://api.example.com/.well-known/oauth-protected-resource"
    );
    expect(params.error).toBe("invalid_token");
  });

  it("validates a well-formed Protected Resource Metadata document", () => {
    const ok = validateProtectedResourceMetadata({
      resource: "https://api.example.com",
      authorization_servers: ["https://auth.example.com"],
    });
    expect(ok.ok).toBe(true);
  });

  it("rejects metadata missing authorization_servers", () => {
    const bad = validateProtectedResourceMetadata({
      resource: "https://api.example.com",
    });
    expect(bad.ok).toBe(false);
  });

  it("skips auth checks when no HTTP base URL is provided (stdio)", async () => {
    const rows = await checkOAuth("claude-code");
    expect(rows.every((r) => r.status === "skip")).toBe(true);
  });

  it("passes the HTTP auth probe against a conformant fake resource", async () => {
    const metadata = {
      resource: "https://api.example.com",
      authorization_servers: ["https://auth.example.com"],
    };
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return new Response(JSON.stringify(metadata), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
        },
      });
    }) as typeof fetch;

    const rows = await checkOAuth("claude-code", {
      baseUrl: "https://api.example.com/mcp",
      fetchImpl: fakeFetch,
    });
    expect(rows.every((r) => r.status === "pass")).toBe(true);
  });
});

describe("v0.2.0 amendments", () => {
  it("m4: VERSION reads the shipped VERSION file (single source of truth)", () => {
    expect(VERSION).toBe(readFileSync(resolve(repoRoot, "VERSION"), "utf8").trim());
  });

  it("m4: `mcp-conform --version` prints the shipped version", () => {
    const out = execFileSync(
      process.execPath,
      [resolve(repoRoot, "dist/cli.js"), "--version"],
      { encoding: "utf8" }
    );
    expect(out.trim()).toBe(VERSION);
  });

  it("m5: on handshake failure the auth cell stays skip (not n/a)", async () => {
    const report = await run({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      timeoutMs: 5_000,
    });
    const view = buildMatrix(report);
    const ccBehavior = view.cells.find(
      (c) => c.client === "claude-code" && c.axis === "behavior"
    );
    expect(ccBehavior?.status).toBe("fail");
    const ccAuth = view.cells.find(
      (c) => c.client === "claude-code" && c.axis === "auth"
    );
    // Auth axis is independent of the stdio handshake — over stdio it stays
    // skip, so the matrix shape matches a green run instead of collapsing to n/a.
    expect(ccAuth?.status).toBe("skip");
    expect(isGreen(report)).toBe(false);
  }, 30_000);

  it("m6: rollup precedence — skip dominates n/a", () => {
    expect(rollup(["skip", "n/a"])).toBe("skip");
  });

  it("m6: rollup precedence — pass over n/a -> pass", () => {
    expect(rollup(["pass", "n/a"])).toBe("pass");
  });

  it("m6: rollup precedence — pass over skip -> pass (no dead arm)", () => {
    expect(rollup(["pass", "skip"])).toBe("pass");
  });

  it("m6: rollup precedence — n/a only -> n/a (still)", () => {
    expect(rollup(["n/a", "n/a"])).toBe("n/a");
  });

  it("m7: an invalid --base-url yields two fail rows instead of throwing", async () => {
    const rows = await checkOAuth("claude-code", {
      baseUrl: "not-a-valid-url",
    });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.status === "fail")).toBe(true);
    expect(rows[0]!.detail).toContain("invalid base URL");
    expect(rows[1]!.detail).toContain("invalid base URL");
  });

  it("m8: --base-url runs the live Zero-Touch OAuth probe against an HTTP resource", async () => {
    const metadata = {
      resource: "http://127.0.0.1",
      authorization_servers: ["http://127.0.0.1/auth"],
    };
    const server = createServer((req, res) => {
      if (req.url?.endsWith("/.well-known/oauth-protected-resource")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(metadata));
        return;
      }
      res.writeHead(401, {
        "www-authenticate":
          'Bearer resource_metadata="http://127.0.0.1/.well-known/oauth-protected-resource"',
      });
      res.end("unauthorized");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}/mcp`;
    try {
      const report = await run({
        command: process.execPath,
        args: [echoServer],
        baseUrl,
      });
      const view = buildMatrix(report);
      // Auth cell becomes a real pass (live discovery probe).
      const ccAuth = view.cells.find(
        (c) => c.client === "claude-code" && c.axis === "auth"
      );
      expect(ccAuth?.status).toBe("pass");
      // Behavior axis is still green (the stdio echo fixture).
      const ccBehavior = view.cells.find(
        (c) => c.client === "claude-code" && c.axis === "behavior"
      );
      expect(ccBehavior?.status).toBe("pass");
      expect(isGreen(report)).toBe(true);
    } finally {
      server.close();
    }
  }, 30_000);
});

describe("v0.3.0 amendments", () => {
  it("m9: malformed Protected Resource Metadata (non-URL resource/servers) fails instead of false-passing", async () => {
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return new Response(
          JSON.stringify({
            resource: "garbage",
            authorization_servers: ["not-a-url"],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="garbage"',
        },
      });
    }) as typeof fetch;

    const rows = await checkOAuth("claude-code", {
      baseUrl: "https://api.example.com/mcp",
      fetchImpl: fakeFetch,
    });
    const meta = rows.find((r) => r.check_id === "oauth.protected_resource_metadata");
    expect(meta?.status).toBe("fail");
    const www = rows.find((r) => r.check_id === "oauth.www_authenticate");
    expect(www?.status).toBe("fail");
  });

  it("m9: a well-formed discovery surface still passes (no false-negative)", async () => {
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return new Response(
          JSON.stringify({
            resource: "https://api.example.com",
            authorization_servers: ["https://auth.example.com"],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
        },
      });
    }) as typeof fetch;
    const rows = await checkOAuth("claude-code", {
      baseUrl: "https://api.example.com/mcp",
      fetchImpl: fakeFetch,
    });
    expect(rows.every((r) => r.status === "pass")).toBe(true);
  });

  it("m10: on handshake failure the behavior row set matches a green run (non-handshake checks = skip)", async () => {
    const report = await run({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      timeoutMs: 5_000,
    });
    const cc = report.results.filter(
      (r) => r.client === "claude-code" && r.axis === "behavior"
    );
    const ids = new Set(cc.map((r) => r.check_id));
    for (const id of [
      "handshake.initialize",
      "handshake.server_info",
      "handshake.capabilities",
      "tools.list_schema",
      "tools.call_roundtrip",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(cc.find((r) => r.check_id === "handshake.initialize")?.status).toBe("fail");
    for (const id of [
      "handshake.server_info",
      "handshake.capabilities",
      "tools.list_schema",
      "tools.call_roundtrip",
    ]) {
      expect(cc.find((r) => r.check_id === id)?.status).toBe("skip");
    }
    // The matrix cell verdict is still fail (rollup([fail, ...skip]) === "fail").
    const view = buildMatrix(report);
    const ccBehavior = view.cells.find(
      (c) => c.client === "claude-code" && c.axis === "behavior"
    );
    expect(ccBehavior?.status).toBe("fail");
    expect(isGreen(report)).toBe(false);
  }, 30_000);

  it("m11: Cursor/Gemini stub detail drops the stale '(v0.2)' promise", async () => {
    for (const id of ["cursor", "gemini"] as const) {
      const a = ADAPTERS.find((x) => x.id === id)!;
      const rows = await a.run(
        { client: id, serverCmd: "x", serverArgs: [] },
        undefined
      );
      const detail = rows[0]!.detail;
      expect(detail).not.toContain("(v0.2)");
      expect(detail).toContain("deferred");
    }
  });
});

describe("v0.4.0 amendments", () => {
  it("m12: a server whose first tool needs non-message args still passes tools.call_roundtrip (no echo tool)", async () => {
    // A conformant server whose ONLY tool requires a `url` argument — NOT the
    // echo fixture's `message`. Before the fix the harness sent echo-specific
    // {message:"mcp-conform ping"} to this arbitrary fallback tool and
    // false-failed it; now it derives a minimal valid {url} from the tool's
    // own inputSchema and the round-trip passes.
    const toolList = [
      {
        name: "fetch_url",
        description: "fetch a url",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
    ];
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const fakeClient = {
      listTools: async () => ({ tools: toolList }),
      callTool: async (req: {
        name: string;
        arguments?: Record<string, unknown>;
      }) => {
        calls.push({ name: req.name, args: req.arguments ?? {} });
        return { content: [{ type: "text", text: "fetched" }] };
      },
    } as unknown as Client;

    const rows = await checkTools("claude-code", fakeClient, {
      toolName: "echo",
      args: { message: "mcp-conform ping" },
    });

    const listRow = rows.find((r) => r.check_id === "tools.list_schema");
    expect(listRow?.status).toBe("pass");
    const roundtrip = rows.find((r) => r.check_id === "tools.call_roundtrip");
    expect(roundtrip?.status).toBe("pass");
    // The fallback tool was the one actually called, and NOT with the echo
    // {message} args — it was called with a {url} placeholder derived from
    // the tool's own inputSchema required fields.
    expect(calls[0]!.name).toBe("fetch_url");
    expect(calls[0]!.args).toEqual({ url: "mcp-conform-probe" });
    expect(calls[0]!.args).not.toHaveProperty("message");
  });

  it("m12: a non-echo tool that rejects harness-synthesized args skips (does not false-fail) tools.call_roundtrip", async () => {
    // A conformant server whose tool requires a value the harness cannot guess
    // (e.g. a URL it validates). It rejects the synthesized placeholder with
    // isError=true. The harness must not hard-fail a conformant server here —
    // the failure stems from the harness's echo default hitting a non-echo
    // tool, not from non-conformance — so it records `skip`.
    const toolList = [
      {
        name: "fetch_url",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
    ];
    const fakeClient = {
      listTools: async () => ({ tools: toolList }),
      callTool: async () => ({
        content: [{ type: "text", text: "invalid url" }],
        isError: true,
      }),
    } as unknown as Client;

    const rows = await checkTools("claude-code", fakeClient, {
      toolName: "echo",
      args: { message: "mcp-conform ping" },
    });
    const roundtrip = rows.find((r) => r.check_id === "tools.call_roundtrip");
    expect(roundtrip?.status).toBe("skip");
    expect(roundtrip?.detail).toContain("isError=true");
  });

  it("m13: a hanging HTTP resource yields a fail auth row (probe timed out) instead of stalling", async () => {
    // A "hanging socket": the fetch accepts the call but never responds (the
    // m13 failure mode). Before the fix both probes hung indefinitely, stalling
    // the CLI with no matrix and no exit. Now each probe is bounded by an
    // AbortController + setTimeout and turns into a fail "probe timed out" row.
    const hangingFetch = (() =>
      new Promise<Response>(() => {
        /* never resolves, never rejects — a pending TCP socket */
      })) as typeof fetch;

    const rows = await checkOAuth("claude-code", {
      baseUrl: "https://api.example.com/mcp",
      fetchImpl: hangingFetch,
      probeTimeoutMs: 100,
    });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.status === "fail")).toBe(true);
    expect(rows[0]!.detail).toContain("timed out");
    expect(rows[1]!.detail).toContain("timed out");
    expect(rows[0]!.check_id).toBe("oauth.protected_resource_metadata");
    expect(rows[1]!.check_id).toBe("oauth.www_authenticate");
  });
});
