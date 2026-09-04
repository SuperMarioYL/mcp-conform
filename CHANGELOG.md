# Changelog

All notable changes to this project are documented in this changelog.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-09-04

### Fixed
- **site content_version drift** — the shipped `web/site.json` had no
  `content_version` field at all (it was a post-hoc web-factory build stamp
  committed to `main` only on a "site: refresh" run), so the live Pages site's
  version surface read `v0.4.0` while `VERSION`, `package.json`,
  `src/version.ts` (`--version` and the handshake `clientInfo.version`), and the
  `CHANGELOG` head all read `0.5.0` — a one-minor drift. `meta.content_version`
  is now a source-tracked field set to the package version (no `v` prefix,
  matching `VERSION`/`package.json`), and a new `test/version.test.ts`
  lockstep test asserts `VERSION` == `package.json` version ==
  `web/site.json` `meta.content_version` == `CHANGELOG` head version. The test
  fails on the v0.5.0 tag (`content_version` absent → `undefined !== "0.5.0"`),
  proving the drift was real.
- **README roadmap v0.5.0 entries** — the roadmap in both `README.md` and
  `README.en.md` listed v0.2/v0.3/v0.4 entries but omitted v0.5.0, even though
  the v0.5.0 plan required the roadmap to note the release. The two v0.5.0
  fixes (RFC 9728 `authorization_servers` optional; OAuth metadata body-read
  timeout) are now listed in both roadmaps.

### Notes
- v0.6.0 is a cold-start bug-hunt release: no new feature scope. Since the
  2026-08-25 v0.5.0 ship there has been no post-ship code or community activity
  (0 open issues / 0 PRs / 0 forks); the two version/doc-drift fixes above are
  the entirety of the release.

## [0.5.0] - 2026-08-25

### Fixed
- **RFC 9728 `authorization_servers` false-fail** —
  `validateProtectedResourceMetadata` required the `authorization_servers`
  field as a non-empty `http(s)` URL[], but RFC 9728 §2.1 marks it OPTIONAL —
  it may be omitted entirely when the set of authorization servers is not
  enumerable. Conformant metadata like `{"resource": "https://api.example.com"}`
  (no `authorization_servers`) therefore false-failed with
  `oauth.protected_resource_metadata=fail` — a conformance tool rejecting a
  valid RFC 9728 document. `authorization_servers` is now treated as optional:
  when absent the document passes (`resource` is the only REQUIRED member);
  when present it is still validated as a non-empty `http(s)` URL[]. The
  success-detail string that did `d.authorization_servers.length` is guarded so
  it no longer throws once the field may be absent. (m14)
- **OAuth metadata probe body-read timeout** — `fetchWithTimeout` cleared its
  `AbortController` timer in `.finally` as soon as the response headers arrived
  (the race settled on the fetch promise), so the subsequent `await res.json()`
  in the Protected Resource Metadata probe read the body OUTSIDE any timeout.
  A server that returned `200` + `content-type: application/json` then never
  completed the body hung `res.json()` far beyond the per-probe budget,
  reopening the m13 "hanging resource stalls the CLI" failure the per-probe
  timeout was meant to close. The metadata probe now uses `fetchJsonWithTimeout`,
  which keeps the `AbortController` + timer alive across the body read (the timer
  is only cleared once `res.json()` settles), so a slow-dripping body is aborted
  and surfaced as a `fail` row ("metadata probe timed out after Nms") instead of
  a multi-minute stall. The `WWW-Authenticate` probe, which reads only headers,
  is unchanged. (m15)

### Notes
- v0.5.0 is a cold-start bug-hunt release: no new feature scope. Since the
  2026-08-08 v0.4.0 ship there has been no post-ship code or community activity
  (0 open issues / 0 PRs / 0 forks / 0 patches); the two verified
  `src/spec/oauth.ts` fixes above are the entirety of the release.

## [0.4.0] - 2026-08-08

### Fixed
- **echo-call-args false-fail** — the Claude Code adapter always passed the
  echo fixture's `ECHO_CALL = {toolName:"echo", args:{message:"mcp-conform ping"}}`
  to `checkTools`. When the server had no "echo" tool, `checkTools` fell back to
  the first tool for the *name* but still sent the echo-specific `{message}` args
  to that arbitrary tool, so any conformant server whose first tool requires
  different args (e.g. a URL) returned `isError=true` or rejected on schema
  validation, making `tools.call_roundtrip=fail` and the CLI exit 1 — a false
  failure for a conformant server. `checkTools` now resolves the actual target
  tool and, when the requested tool is not on the server, derives a minimal
  valid `arguments` object from the fallback tool's own `inputSchema` required
  fields (type-appropriate placeholders) instead of forcing echo args onto it.
  And when even that synthesized call cannot succeed (the tool needs values the
  harness cannot guess) it records `skip` rather than `fail`, since the failure
  stems from the harness being unable to drive a real round-trip, not from the
  server being non-conformant. A conformant server without an "echo" tool now
  passes `tools.call_roundtrip`. (The optional `--tool`/`--args` CLI flags that
  would let a user drive a real round-trip against a specific tool are deferred
  to a follow-up `type:feature` milestone; the minimum fix ships without them.)
- **OAuth HTTP probe timeout** — `checkOAuth`'s two `fetch` calls (Protected
  Resource Metadata and `WWW-Authenticate`) had no `AbortSignal`/timeout; only
  `client.connect` was wrapped in a timeout. A `--base-url` pointed at an HTTP
  resource that accepts the TCP connection but never responds hung both fetches
  indefinitely, stalling the CLI forever with no matrix and no exit — a direct
  violation of the §3 "sub-30s total run" contract. Each `fetchImpl` in
  `checkOAuth` is now wrapped in an `AbortController` + `setTimeout` (default
  10s per probe; configurable via the new `OAuthProbeOptions.probeTimeoutMs`),
  turning a non-responsive HTTP resource into a `fail` auth row
  ("probe timed out after Nms") instead of an indefinite hang.

### Changed
- No new CLI flag, no new adapter, no new transport, no stack change. v0.4.0
  deepens harness correctness (echo-arg fallback + OAuth probe timeout). License
  line reconciled to Apache 2.0 (SuperMarioYL).

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

[Unreleased]: https://github.com/SuperMarioYL/mcp-conform/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.6.0
[0.5.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.5.0
[0.4.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.4.0
[0.3.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.3.0
[0.2.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.2.0
[0.1.0]: https://github.com/SuperMarioYL/mcp-conform/releases/tag/v0.1.0
