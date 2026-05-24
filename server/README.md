# tufan-blox-bridge

MCP server for AI-driven Roblox Studio development, by Tufan Studio.

Connect Claude Code / Cursor and get 34 tools to drive Studio: read/write scripts, create & edit instances, get/set properties, inspect the tree, run Luau, read logs, insert assets — plus two-way file sync (files↔Studio for code) and git history (commit/log/diff/restore/branch).

Pairs with the **Tufan-Blox-Bridge Studio plugin**, which executes the commands inside Studio. The server speaks MCP over stdio to your AI client and runs an HTTP bridge on `127.0.0.1:58741` that the plugin polls.

## Use

```
claude mcp add tufan --env TUFAN_PROJECT=C:\path\to\roblox\project -- npx -y tufan-blox-bridge
```

Install the Studio plugin and full setup instructions:
**https://github.com/drgost1/Tufan-Blox-Bridge**

## Env

- `TUFAN_PROJECT` — the Roblox project root (for file sync + git). Defaults to cwd.
- `TUFAN_AUTOCOMMIT=1` — auto-commit every in-Studio script edit.

MIT © Tufan Studio.
