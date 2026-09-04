/**
 * Version lockstep test — the single-source-of-truth guard.
 *
 * mcp-conform announces its version in four independent surfaces:
 *   1. the `VERSION` file (read at runtime by src/version.ts, which feeds both
 *      `mcp-conform --version` and the MCP handshake `clientInfo.version`);
 *   2. `package.json` `version`;
 *   3. `web/site.json` `meta.content_version` (the version surface the live Pages
 *      site reads — v0.6.0 made it a source-tracked field so it cannot drift
 *      post-hoc the way the v0.4.0 web-factory stamp did on the v0.5.0 tag);
 *   4. the `CHANGELOG.md` head entry (`## [x.y.z]`).
 *
 * A conformance tool must not misreport its own version, so all four MUST agree.
 * This test FAILS on the v0.5.0 tag: `web/site.json` had no `content_version`
 * field at all (it was a post-hoc build stamp that read `v0.4.0` on `main` while
 * the other three surfaces read `0.5.0`), so the lockstep assertion
 * `content_version === VERSION` failed — proving the drift was real, not cosmetic.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** Read the package.json version field. */
function packageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(repoRoot, "package.json"), "utf8")
  ) as { version?: string };
  return pkg.version ?? "";
}

/** Read web/site.json meta.content_version (the Pages site version surface). */
function siteContentVersion(): string | undefined {
  const site = JSON.parse(
    readFileSync(resolve(repoRoot, "web/site.json"), "utf8")
  ) as { meta?: { content_version?: string } };
  return site.meta?.content_version;
}

/**
 * Read the head CHANGELOG version: the first `## [x.y.z]` heading. The
 * `[Unreleased]` section is skipped so the asserted head is the latest
 * *released* version.
 */
function changelogHeadVersion(): string {
  const text = readFileSync(resolve(repoRoot, "CHANGELOG.md"), "utf8");
  const match = text.match(/^##\s+\[([0-9]+\.[0-9]+\.[0-9]+)\]/m);
  return match?.[1] ?? "";
}

describe("version lockstep (single source of truth)", () => {
  it("src/version.ts VERSION reads the shipped VERSION file", () => {
    const fileVersion = readFileSync(resolve(repoRoot, "VERSION"), "utf8").trim();
    expect(VERSION).toBe(fileVersion);
  });

  it("VERSION == package.json version", () => {
    expect(VERSION).toBe(packageVersion());
  });

  it("VERSION == web/site.json meta.content_version", () => {
    // The live Pages site reads meta.content_version as its version surface.
    // It must track the shipped tag exactly (no v prefix — matching VERSION).
    // On the v0.5.0 tag this was undefined (the field was a post-hoc build
    // stamp), so this assertion failed and proved the drift was real.
    expect(siteContentVersion()).toBe(VERSION);
  });

  it("VERSION == CHANGELOG head version", () => {
    expect(changelogHeadVersion()).toBe(VERSION);
  });

  it("all four version surfaces agree on a single value", () => {
    const surfaces = {
      versionFile: VERSION,
      packageJson: packageVersion(),
      siteContentVersion: siteContentVersion(),
      changelogHead: changelogHeadVersion(),
    };
    const values = new Set(Object.values(surfaces));
    expect(values.size, JSON.stringify(surfaces)).toBe(1);
  });
});
