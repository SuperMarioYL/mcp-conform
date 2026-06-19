# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/SuperMarioYL/mcp-conform/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.1.0
