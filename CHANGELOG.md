# Changelog

All notable changes to this project are documented in this changelog.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-08-03

### Fixed
- **OAuth discovery URL-shape validation** — `validateProtectedResourceMetadata`
  and the `WWW-Authenticate` Bearer probe only checked that `resource`,
  `authorization_servers`, and the `resource_metadata` challenge parameter were
  non-empty strings, but RFC 9728 requires them to be URLs. A malformed metadata
  document (e.g. `{resource: "garbage", authorization_servers: ["not-a-url"]}`) or
  a challenge pointing `resource_metadata` at a non-URL previously **passed**,
  false-passing a non-conformant server. Both now validate `new URL()` parses
  (http/https) and fail with a precise detail instead of false-passing.
- **Stable behavior row set on handshake failure** — when `client.connect` failed,
  the real adapter pushed only a single `handshake.initialize` fail row and silently
  dropped `handshake.server_info`, `handshake.capabilities`, `tools.list_schema`,
  and `tools.call_roundtrip`, so the raw report (`--report report.json`) had 1
  behavior row on a failure run vs 5 on a green run. The v0.2.0 `m5` fix added
  auth-axis skip rows to keep the matrix shape stable, but applied that principle
  to the auth axis only. The behavior axis now emits `skip` rows for the checks that
  could not run, so the report row set is stable across green/failure runs (the
  matrix cell verdict is unchanged — `rollup([fail, …skip]) === "fail"`).
- **Stale stub version labels** — the Cursor and Gemini stub messages promised
  "(v0.2)" adapters, but v0.2.0 shipped without them and reframed them as deferred
  (the MCP protocol is client-agnostic over stdio, so a real adapter would only add
  a column, not a check). The stale version promise is dropped.

### Changed
- No new CLI flag, no new adapter, no stack change. v0.3.0 deepens auth-axis shape
  fidelity and report stability.

## [0.2.0] - 2026-07-17

### Added
- **`--base-url <url>`** CLI flag — runs the live Zero-Touch OAuth discovery probe
  (Protected Resource Metadata + `WWW-Authenticate` Bearer challenge shape) against
  an HTTP MCP resource. v0.1 shipped the auth-axis checks but the CLI never wired a
  base URL into them, so on every real `run` the auth cell resolved to `skip`. With
  the flag the auth cell becomes a real `pass` / `fail`; without it, behavior is
  unchanged (stdio → `skip`).
- `src/version.ts` — single source of truth for the package version, read from the
  `VERSION` file at runtime.

### Fixed
- **Stale version string** — `clientInfo.version` announced to the server under test
  during the `initialize` handshake and `mcp-conform --version` were hardcoded
  `"0.1.0"` literals that never advanced with a release. Both now read the `VERSION`
  file via `src/version.ts`.
- **Handshake-failure matrix shape** — when `client.connect` failed, the real adapter
  pushed only a single `handshake.initialize` fail row, leaving the auth axis with
  zero rows so the auth cell silently read `n/a` instead of `skip`. The auth axis is
  now still run on a failed handshake (over stdio it stays `skip`), so the matrix
  shape matches a green run.
- **`rollup()` precedence** — rewritten to `fail > pass > skip > n/a` so a mixed
  `["skip","n/a"]` cell reads `skip` (the actionable signal is no longer hidden
  behind a stubbed `n/a`), and the dead unreachable `"skip"` arm inside the `pass`
  branch was removed.
- **Invalid `--base-url` crash** — a malformed base URL (`new URL()` throws
  `ERR_INVALID_URL`) previously rejected the whole run and crashed the CLI with no
  matrix. It now produces two `fail` rows with the parse error in the detail, so a
  bad flag fails gracefully (exit 1 with a printed matrix) instead of crashing.

### Changed
- The roadmap is reframed for v0.2: "deeper OAuth (live discovery probe from the
  CLI)" is done; real Cursor / Gemini adapters stay deferred — the MCP protocol is
  client-agnostic over stdio, so a "real" Cursor adapter would duplicate the Claude
  Code checks and only add a column, not a check.

## [0.1.0] - 2026-06-19

### Added
- `mcp-conform run <server-cmd...>` — spawns a target MCP server over stdio and
  runs the conformance suite.
- **Behavior spec checks**: `handshake.initialize` plus `tools/list` schema
  validation and a `tools/call` round-trip.
- **Auth spec checks**: Zero-Touch OAuth discovery, Protected Resource Metadata,
  and `WWW-Authenticate` challenge-shape assertions (discovery/shape only — no
  end-to-end browser token grant).
- **Conformance matrix** primitive — a typed report keyed by
  `(client, axis, check_id)`, rendered as a colored per-client × {behavior, auth}
  terminal table.
- **Claude Code adapter** (real); Cursor and Gemini adapters stubbed, returning
  `n/a` until v0.2.
- `--json` for a stable machine-readable matrix, `--report` for the full
  `report.json`, and `--badge` to emit `badge.svg` + `badge.json`.
- Bundled echo fixture server for a reproducible green-path demo.
- Vitest suite covering the runner, spec checks, matrix roll-up, and badge output.

[Unreleased]: https://github.com/SuperMarioYL/mcp-conform/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.3.0
[0.2.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.2.0
[0.1.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.1.0
