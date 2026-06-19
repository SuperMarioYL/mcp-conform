# vhs script — mcp-conform happy path
# Render locally:  vhs docs/demo.tape   (writes assets/demo.gif)
# CI renders this on tag push via .github/workflows/demo.yml

Output assets/demo.gif

Set Shell        "bash"
Set FontSize     18
Set Width        880
Set Height       460
Set Padding      24
Set Theme        "Dracula"
Set TypingSpeed  45ms

# Build once so the bundled fixture is available under dist/.
Type "npm install && npm run build"
Enter
Sleep 6s

# Run the conformance suite against the bundled echo fixture over stdio.
Type "npx mcp-conform run node ./dist/fixtures/echo-server/server.js --badge"
Enter
Sleep 4s

# The colored per-client x {behavior, auth} parity matrix renders here:
#   Claude Code  ✓ pass   ~ skip
#   Cursor*      - n/a    - n/a
#   Gemini*      - n/a    - n/a
# and badge.svg / badge.json are written for the README.
Sleep 5s
