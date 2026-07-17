/**
 * Single source of truth for the mcp-conform package version.
 *
 * Read from the repo-root `VERSION` file at runtime so the CLI `--version` and
 * the MCP `clientInfo.version` announced to the server under test during
 * `initialize` never drift from the shipped release. A conformance tool must
 * not misreport its own version (or crash over its version label), so on any
 * read failure this falls back to `"0.0.0-unknown"` rather than throwing.
 *
 * Resolved relative to the compiled module location: `dist/version.js` (when
 * shipped) and `src/version.ts` (when run under vitest) both sit one level
 * below the repo root that holds `VERSION`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function readVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  // Walk up a few directories to find the VERSION file (covers dist/, src/,
  // and nested node_modules installs). Stops well short of the filesystem root.
  for (let i = 0; i < 6; i++) {
    try {
      const v = readFileSync(resolve(dir, "VERSION"), "utf8").trim();
      if (v) return v;
    } catch {
      // not here — try parent
    }
    dir = dirname(dir);
  }
  return "0.0.0-unknown";
}

export const VERSION: string = readVersion();
