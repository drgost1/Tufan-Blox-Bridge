# tufan-blox-bridge: Roblox Studio MCP server and plugin

**A free Roblox Studio MCP server that works as an add-on to Roblox's built-in Studio MCP.** Connect Claude Code, Cursor or any MCP client to Roblox Studio and get 85 tools for Luau scripts, instances, properties, batch builds, snapshots, performance and security audits, two-way file sync and git history.

It pairs with the **Tufan-Blox-Bridge Studio plugin**, which carries out the commands inside Studio. The server speaks MCP over stdio to your AI client and runs an HTTP bridge on `127.0.0.1:58741` that the plugin polls.

## Why use it as an add-on

Keep Roblox's built-in server for play tests, screenshots and live debugging. Add Tufan for what it doesn't cover:

- **Reversible AI edits:** `snapshot` / `restore` and git history, including `git_recover` for deleted scripts.
- **Scripts on disk:** two-way sync, so VS Code, Selene, luau-lsp and git work on real files.
- **Backdoor scanning:** `scan_backdoors` checks free models for hidden `require` payloads, obfuscation and webhooks.
- **Code quality:** Selene linting, luau-lsp type checks and StyLua formatting.
- **Bulk builds:** thousands of changes in one call with `batch`, `create_tree` and `mass_edit`.
- **Speed:** 17 ms median per Luau call against 67 ms for the built-in server in our benchmark (November 2026, one Windows PC; your numbers will vary).
- **Game operations:** live DataStores, `cloud_luau` and asset uploads through Open Cloud.
- **Teamwork with the built-in server:** Tufan tells your AI which server owns which job, and flags results that missed a running Play session.

## Quick install

You need Node.js 18 or newer. Paste this into Claude Code, Cursor or another AI agent, opened in your Roblox project folder:

```text
Set up Tufan-Blox-Bridge, a Roblox Studio MCP server and plugin, for this project.

1. Run `npx -y tufan-blox-bridge@latest setup` in this folder. It installs the server and the Studio plugin, and registers with Claude Code or Cursor.
2. If it says nothing was registered, add the config it prints to your MCP settings, keeping any servers already there.
3. Don't ask me for API keys. They're optional.
4. Tell me what it did and the next steps it printed.
```

Or run it yourself:

```bash
npx -y tufan-blox-bridge@latest setup
```

Then restart Roblox Studio and your AI client. The Studio plugin ships inside this package. Full docs: **https://github.com/drgost1/Tufan-Blox-Bridge**

## Env

- `TUFAN_PROJECT` — the Roblox project root (for file sync + git). Defaults to cwd.
- `TUFAN_READONLY=1` — inspector mode: write tools hidden, `script_source`/`tag` readable but write-blocked.
- `TUFAN_TOOLSET=core` — expose only the 26 everyday core tools (default `full` = all 85).
- `TUFAN_AUTOCOMMIT=1` — auto-commit every in-Studio script edit.
- `TUFAN_AUTOPUSH=1` — also push after each commit.
- `TUFAN_PROJECTS_DIR` — base dir override for auto-registered projects.
- `TUFAN_OPENCLOUD_KEY` — Open Cloud API key for `import_file` (assets Read+Write).
- `TUFAN_CREATOR_ID` / `TUFAN_GROUP_ID` — upload owner override (defaults to the Studio login).

MIT © Tufan Studio.
