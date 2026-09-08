[简体中文](./README.md) · [Website](https://mcp-conform.lei6393.com) · [GitHub](https://github.com/SuperMarioYL/mcp-conform)

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/hero-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/hero-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/hero-dark.svg">
  <img src="./assets/presentation/hero-light.svg" width="960" alt="Hero diagram">
</picture>

# mcp-conform

**Make MCP behavior visible before integration**

mcp-conform launches a stdio MCP server, checks its handshake and tools through the MCP SDK, then produces a behavior/auth matrix. Unsupported client adapters remain marked n/a.

## Why use it

A server can expose a valid-looking tool list yet fail at initialization or invocation. Running a repeatable protocol scenario makes these failures visible before you add the server to an agent configuration.

- **Run a real server** — The harness starts the target once over stdio and checks the live connection.
- **Keep incomplete coverage visible** — The matrix distinguishes pass, fail, skip and n/a.
- **Use results in CI** — JSON reports and SVG badges share the same collected check results.

## Architecture

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/architecture-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-dark.svg">
  <img src="./assets/presentation/architecture-light.svg" width="960" alt="Architecture diagram">
</picture>

runner.ts spawns the server with StdioClientTransport and initializes an MCP Client. The implemented adapter named claude-code runs handshake, tool-schema and tool-call checks. OAuth discovery is a separate HTTP probe when baseUrl is supplied. Cursor and Gemini adapters emit n/a rows without executing those applications.

| Component | Responsibility |
| --- | --- |
| `Server process` | stdio transport |
| `MCP SDK client` | initialize connection |
| `Check suite` | handshake / tools / auth |
| `Matrix + badge` | status and evidence |

## Install and quickstart

Node.js 22+. The build compiles both the harness and the bundled fixture.

```bash
git clone https://github.com/SuperMarioYL/mcp-conform.git
cd mcp-conform
npm ci
npm run build
```

The complete command starts the included echo fixture and sends actual MCP messages locally. No model calls or external client applications are involved.

```bash
node dist/cli.js run node dist/fixtures/echo-server/server.js --json
```

## Recorded demo

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/process-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/process-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/process-dark.svg">
  <img src="./assets/presentation/process-light.svg" width="960" alt="Process diagram">
</picture>

The bundled echo server is checked over stdio; Cursor/Gemini remain n/a and OAuth is skipped.

```text
{
  "spec_version": "0.1",
  "server": {
    "cmd": "node dist/fixtures/echo-server/server.js",
    "transport": "stdio"
  },
  "cells": [
    {
      "client": "claude-code",
      "axis": "behavior",
      "status": "pass"
    },
    {
      "client": "claude-code",
      "axis": "auth",
      "status": "skip"
    },
    {
      "client": "cursor",
      "axis": "behavior",
      "status": "n/a"
    },
    {
      "client": "cursor",
      "axis": "auth",
      "status": "n/a"
    },
    {
      "client": "gemini",
      "axis": "behavior",
      "status": "n/a"
    },
    {
      "client": "gemini",
      "axis": "auth",
      "status": "n/a"
    }
  ]
}
```

The complete command and output are recorded in [docs/demo-results.json](./docs/demo-results.json). Inputs and reproduction code are included in the repository.

## Usage

Replace the fixture command with the command that starts a server you intend to test. --cwd selects its working directory; --timeout sets the handshake timeout in milliseconds (default 15000). --report and --badge can take output paths. Any fail returns exit 1; skip and n/a do not fail CI.

```bash
node dist/cli.js run node dist/fixtures/echo-server/server.js --json
node dist/cli.js run node dist/fixtures/echo-server/server.js --badge --report
```

## Configuration

Use --base-url only for an HTTP resource whose OAuth metadata you intend to probe. Without it, auth cells remain skip for stdio. The tool call uses echo when available; otherwise it derives minimal arguments from a candidate schema and can skip unsupported synthesized calls. Read the individual report rows rather than interpreting one green badge as universal compatibility.

## Integrations and responsibilities

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/integrations-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-dark.svg">
  <img src="./assets/presentation/integrations-light.svg" width="960" alt="Integrations diagram">
</picture>

The report describes this harness’s protocol checks. The claude-code row is an adapter label, not evidence that a Claude Code desktop or CLI application was launched. Authentication discovery checks metadata and challenge shape; it does not complete an OAuth token grant.

| Route | Implemented role |
| --- | --- |
| stdio MCP | child process transport |
| MCP SDK | protocol handshake and tool calls |
| HTTP metadata | optional OAuth discovery |
| JSON report | CI-readable check rows |
| SVG badge | derived matrix summary |

## Limits and next steps

- Only one adapter runs SDK checks. Cursor and Gemini are placeholders; none of the three named client applications is launched.
- Running an arbitrary server also runs its code, and tools.call can have effects. Use a controlled server and fixture data.
- The offline example does not exercise OAuth discovery or end-to-end authorization.

Implemented: stdio handshake/tool checks, stable report rows, JSON/badge outputs and optional HTTP discovery probes. Deeper OAuth authorization and real client-specific compatibility coverage remain future work. See CHANGELOG.md for supported behavior changes.

## License and contributions

See [LICENSE](./LICENSE). When reporting an issue, include a minimal input, the command, and the observed output.
