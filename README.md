# Tufan-Blox-Bridge

An original AI-dev tool for Roblox Studio, by **Tufan Studio**. One product:

- **MCP server** — Claude Code / Cursor connect over stdio and get a full toolset to drive Roblox Studio.
- **Studio plugin** — the in-Studio agent that executes those commands (plugins can't host MCP; they poll the server over HTTP).
- **File sync** — files→Studio (Rojo-style) and scripts Studio→files.
- **Git history** — commit/log/diff/restore/branch as MCP tools.

No dependency on Argon or boshyxd's MCP — this is all original code. They were references only.

## Architecture

```
Claude Code / Cursor ──stdio(MCP)──▶ SERVER (TypeScript) ──HTTP :58741──▶ PLUGIN (Luau, in Studio)
                                       │ owns files + git              executes commands, watches scripts
```

The server runs two transports in one process: stdio for the AI client, and an HTTP long-poll endpoint on `127.0.0.1:58741` for the plugin. An AI tool call becomes a queued command the plugin picks up, executes, and answers.

## Tools (34)

- **Scripts** — get_script_source, set_script_source, grep_scripts, get_script_tree
- **Instances** — create_instance, delete_instance, clone_instance, move_instance, rename_instance
- **Properties** — get_properties, set_property, mass_set_property, search_by_property
- **Tree** — get_children, get_descendants, search_objects, get_services
- **Luau** — run_luau
- **Logs** — get_output_log, get_playtest_output
- **Assets** — search_assets, get_asset_details, insert_asset
- **Git** — git_status, git_commit, git_log, git_diff, git_restore, git_branch
- **Capture / Playtest** — capture_screenshot, start_playtest, stop_playtest, is_running

> ⚠️ `capture_screenshot` and `start/stop_playtest` are honest stubs: Roblox provides no plugin API for viewport pixel capture or programmatic play control. They return a clear message rather than fake data. `is_running` works.

## Setup (dev, pre-npm-publish)

**1. Build the server**
```powershell
cd server
bun install
bun run build
```

**2. Build + install the plugin**
```powershell
pwsh scripts/build-plugin.ps1 -Install
```

**3. Point your AI client at the server**, with the project root as `TUFAN_PROJECT`:
```powershell
claude mcp add tufan --env TUFAN_PROJECT=C:\path\to\your\roblox\project -- node C:\Users\drgos_5ax3dfg\Tufan-Blox-Bridge\server\dist\index.js
```
Set `TUFAN_AUTOCOMMIT=1` too if you want every in-Studio script edit auto-committed to git.

**4. Restart Studio + the AI client.** The Tufan toolbar appears; its widget shows a green "connected" pill once the server is reachable.

## File sync

Drop a Rojo/Argon-style `default.project.json` (or `tufan.project.json`) in your project root mapping services to folders:
```json
{ "name": "MyGame", "tree": {
  "ServerScriptService": { "$path": "src/server" },
  "ReplicatedStorage":   { "$path": "src/shared" }
}}
```
The server watches those folders (files→Studio) and writes Studio script edits back to the matching files (Studio→files), with a loop guard so changes don't ping-pong.

## Once published

```powershell
iwr https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.ps1 | iex
```
and the AI-client config becomes `npx -y tufan-blox-bridge`.

## Repo

```
server/   TypeScript MCP server (publishable as tufan-blox-bridge)
plugin/   Luau Studio plugin (built to TufanBloxBridge.rbxm)
scripts/  build-plugin.ps1
```

The previous vendoring approach (wrapping Argon + boshyxd) is archived on the `legacy-vendor` branch.

## License

MIT © Tufan Studio.
