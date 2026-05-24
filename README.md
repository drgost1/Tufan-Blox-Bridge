# Tufan-Blox-Bridge

AI-driven development for Roblox Studio — full MCP control, two-way file sync, per-place git, and a backdoor scanner. One install. By **Tufan Studio**. MIT.

## Setup

**1 — Install the plugin + helper** (run from your Roblox project folder):

```powershell
# Windows (PowerShell)
iwr https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.ps1 | iex
```
```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.sh | bash
```

**2 — Point your AI client at the server** (use **forward slashes** in the path):

```
claude mcp add tufan --env TUFAN_PROJECT=C:/path/to/your/project -- npx -y tufan-blox-bridge
```

**3 — Restart Studio and your AI client.** A **Tufan Studio** toolbar button appears; open its widget — the pill turns green when connected.

That's it. Your AI can now drive Studio, your scripts mirror to disk, and `scan_backdoors` is ready.

---

## What it is

Two parts that talk over a local HTTP bridge:

- **MCP server** (`npx -y tufan-blox-bridge`) — what your AI client (Claude Code, Cursor) connects to. Exposes ~46 tools.
- **Studio plugin** (`TufanBloxBridge.rbxm`) — the in-Studio agent that executes the commands.

Unlike Rojo (sync) or other MCP plugins (AI control), this does **AI control + two-way sync + git + security scanning** in one tool, across one or more open places.

## Install methods

- **One-liner** (above) — installs plugin + registers the MCP server.
- **MCP server, no install:** `npx -y tufan-blox-bridge` or `bunx tufan-blox-bridge` (both verified).
- **Global:** `npm i -g tufan-blox-bridge` (then command `tufan-blox-bridge`).
- **Plugin manually:** download `TufanBloxBridge.rbxm` from [Releases](https://github.com/drgost1/Tufan-Blox-Bridge/releases) → drop in your Roblox Plugins folder; or build it with `pwsh scripts/build-plugin.ps1 -Install`.

## Tools (~46)

- **Scripts** — get/set source, grep, script tree, project-wide find-and-replace
- **Instances** — create / delete / clone / move / rename
- **Properties & attributes** — get/set, mass-set, search-by-value, get/set attribute
- **Tags** — get / add / remove / get-tagged (CollectionService)
- **Tree** — children, descendants, search, services, selection
- **Luau** — `run_luau` (captures return + prints)
- **Logs** — output / playtest output
- **Assets** — search, details, insert (flags script-bearing models)
- **Git** — status / commit / log / diff / restore / branch
- **Security** — 🛡️ `scan_backdoors` (require-of-Value, loadstring+HttpGet, exploit APIs, Discord webhooks, obfuscation, hidden binary attributes/Values)
- **Multi-place** — `list_places`, `copy_script_across`, `pull_place`
- *(stubs — no Roblox plugin API: `capture_screenshot`, `start_playtest`, `stop_playtest`)*

## How it works

- **Auto-mirror on connect** — opening a published place pulls its script tree to
  `<project>/projects/<Experience>_<universeId>/<Place>_<placeId>/`.
- **Two-way sync** — edit a local file → Studio updates; edit in Studio → the file updates.
- **Git per place** — each place folder is its own git repo. The widget has **Auto-commit** / **Auto-push** toggles.
- **Disconnect lock** — when the plugin goes offline, the mirror is set read-only (copy-only) until it reconnects.
- **Cross-place** — with two places open, `copy_script_across` moves a module from one into the other.

## Config (env)

- `TUFAN_PROJECT` — project root for sync/git (use forward slashes). Defaults to cwd.
- `TUFAN_AUTOCOMMIT=1` — auto-commit each Studio→file edit.
- `TUFAN_AUTOPUSH=1` — also push after commit.
- `TUFAN_PROJECTS_DIR` — base dir override for auto-registered projects.

## Status

Solid + tested: AI tools, script sync, git, the scanner, multi-place. **WIP:** non-script instance mirroring (models/parts as files — geometry stays in Studio by reference, a Roblox plugin limit), and UUID-suffixing for same-named sibling scripts (they currently collapse).

## Repo

```
server/   TypeScript MCP server (published as npm `tufan-blox-bridge`)
plugin/   Luau Studio plugin (built to TufanBloxBridge.rbxm)
scripts/  build-plugin.ps1
docs/     launch notes
```
Previous vendoring approach archived on the `legacy-vendor` branch.

## License

MIT © Tufan Studio.
