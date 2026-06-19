# Examples

Run the conformance suite against the bundled echo fixture (no install):

```bash
npx mcp-conform run node ./dist/fixtures/echo-server/server.js --badge --report
```

You get a colored per-client × {auth, behavior} matrix in the terminal, plus
`badge.svg`, `badge.json`, and `report.json` you can commit into your own repo.
Point it at your own server by passing its launch command after `run`:

```bash
npx mcp-conform run node ./my-mcp-server.js --json
```
