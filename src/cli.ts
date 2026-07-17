#!/usr/bin/env node
/**
 * mcp-conform CLI — `mcp-conform run <server-cmd...>`.
 *
 * Spawns the target MCP server over stdio, runs the conformance suite, prints
 * the colored per-client × {auth, behavior} matrix, and (optionally) writes
 * `report.json`, `badge.svg`, and `badge.json`.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { run } from "./runner.js";
import { matrixJson, renderMatrix } from "./report/matrix.js";
import { buildBadgeJson, buildBadgeSvg } from "./report/badge.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("mcp-conform")
  .description(
    "Neutral cross-client MCP conformance harness — run a server through " +
      "Claude Code / Cursor / Gemini behavior + Zero-Touch OAuth checks and " +
      "emit a per-client conformance matrix."
  )
  .version(VERSION);

program
  .command("run")
  .description("Spawn an MCP server over stdio and run the conformance suite.")
  .argument(
    "<server-cmd...>",
    'Command to launch the server, e.g. "node ./dist/fixtures/echo-server/server.js"'
  )
  .option("--json", "Print the conformance matrix as JSON instead of the table.")
  .option(
    "--badge [path]",
    "Write badge.svg + badge.json (optionally to a directory).",
    false
  )
  .option(
    "--report [path]",
    "Write the full report.json (optionally to a path).",
    false
  )
  .option("--cwd <dir>", "Working directory for the spawned server.")
  .option("--timeout <ms>", "Handshake timeout in milliseconds.", "15000")
  .option(
    "--base-url <url>",
    "HTTP base URL of the server's resource, to run the live Zero-Touch OAuth " +
      "discovery probe (Protected Resource Metadata + WWW-Authenticate). When " +
      "omitted (stdio) the auth axis resolves to skip."
  )
  .action(async (serverCmd: string[], opts) => {
    const [command, ...args] = serverCmd;
    if (!command) {
      console.error("error: no server command provided");
      process.exit(2);
    }

    const report = await run({
      command,
      args,
      cwd: opts.cwd,
      timeoutMs: Number(opts.timeout) || 15_000,
      baseUrl: opts.baseUrl,
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify(matrixJson(report), null, 2) + "\n");
    } else {
      process.stdout.write(renderMatrix(report) + "\n");
    }

    // --report
    if (opts.report) {
      const reportPath =
        typeof opts.report === "string"
          ? resolve(opts.report)
          : resolve("report.json");
      writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
      if (!opts.json) console.error(`wrote ${reportPath}`);
    }

    // --badge
    if (opts.badge) {
      const dir = typeof opts.badge === "string" ? resolve(opts.badge) : resolve(".");
      const svgPath = resolve(dir, "badge.svg");
      const jsonPath = resolve(dir, "badge.json");
      writeFileSync(svgPath, buildBadgeSvg(report));
      writeFileSync(jsonPath, JSON.stringify(buildBadgeJson(report), null, 2) + "\n");
      if (!opts.json) {
        console.error(`wrote ${svgPath}`);
        console.error(`wrote ${jsonPath}`);
      }
    }

    // Exit non-zero if any hard failure occurred (n/a and skip do not fail CI).
    const hasFail = report.results.some((r) => r.status === "fail");
    process.exit(hasFail ? 1 : 0);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(2);
});
