# Tufan-Blox-Bridge

**AI-driven development for Roblox Studio.** Connect Claude Code, Cursor, or any MCP client to Studio and let your AI *build, inspect, test, and version* your game — 72 tools, two-way file sync, opt-in per-place git, a backdoor scanner, local-file import, subtree snapshots, perf + responsive audits, and concurrent multi-session support. One install. MIT. By **Tufan Studio**.

> Unlike Rojo (file sync only) or other MCP plugins (AI control only), Tufan-Blox-Bridge does **AI control + two-way sync + git + security + safe-mode** in a single tool — across one or more open places at once.

---

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

**3 — Restart Studio and your AI client.** A **Tufan Studio** toolbar button appears — open its widget; the pill turns green when connected.

That's it. Your AI can now drive Studio, your scripts mirror to disk, and `scan_backdoors` is ready.

> **`tufan` times out / won't connect?** Run `claude mcp get tufan` and confirm **Args is `-y tufan-blox-bridge`** (not just `-y`). If the package name is missing, the `add` dropped an argument — `claude mcp remove tufan`, then re-run the add. The installer auto-verifies this.

### Other install methods
- **No install:** `npx -y tufan-blox-bridge` or `bunx tufan-blox-bridge`.
- **Global:** `npm i -g tufan-blox-bridge` → command `tufan-blox-bridge`.
- **Plugin manually:** download `TufanBloxBridge.rbxm` from [Releases](https://github.com/drgost1/Tufan-Blox-Bridge/releases) → drop in your Roblox Plugins folder (or `pwsh scripts/build-plugin.ps1 -Install`).

---

## What it is

Two parts over a local HTTP bridge (`127.0.0.1:58741`):

- **MCP server** (`npx -y tufan-blox-bridge`) — what your AI client connects to. Exposes the 72 tools.
- **Studio plugin** (`TufanBloxBridge.rbxm`) — the in-Studio agent that executes commands and mirrors your scripts.

The AI calls a tool → the server queues a command → the plugin's long-poll picks it up → executes in Studio → returns the result. The server also handles file sync and git on your machine.

## Features

- 🛠 **Full Studio control** — 76 tools: scripts (line-level edits + atomic multi-hunk `patch_script`), instances (incl. whole-tree creation in one call), properties/attributes with full round-trip serialization (particle curves, gradients, fonts, springs), tags, tree inspection (`describe` = an instance's entire context in one call), Luau execution, output logs + a live error feed.
- 🔄 **Two-way file sync** — open a place and its script tree mirrors to disk; edit a file → Studio updates, edit in Studio → the file updates.
- 🌿 **Opt-in per-place git** — off by default (no `.git`, no headache). Turn it on in the widget and each place becomes its own repo with Commit / Push / Backup / Setup-GitHub buttons + auto-commit/push toggles. Your choice persists across restarts.
- 🛡 **Backdoor scanner** — `scan_backdoors` finds require-of-Value, loadstring+HttpGet, exploit APIs, Discord webhooks, obfuscation, and hidden binary payloads; `list_studio_plugins` surfaces the remote-code-plugin vector.
- ⏪ **Snapshots** — `snapshot` checkpoints any subtree before risky changes; `restore` brings it back exactly. A real undo that survives across the AI boundary.
- ⚡ **Batch ops** — `batch` runs dozens of mixed operations in one round-trip and one undo entry; 40 creates = 1 call, not 40.
- 📱 **Responsive UI engine** — `make_responsive` converts a UI subtree Offset→Scale with a validated formula (skips draggables, `dryRun` previews); `scan_responsive` audits tree **and** scripts for resolution breakage and sub-44px tap targets.
- 🩺 **One-look audits** — `project_health` (full place census in one traversal), `scan_perf` (ranked frame-killer fix list), `find_duplicates` (copy-pasted script clusters).
- 📥 **Local file import** — `import_file` uploads `.rbxm`/`.fbx`/`.glb`/audio/images from your disk to your own Roblox account (Open Cloud) and drops them straight into the place — Models insert, audio becomes a `Sound`, images a `Decal`. Your own uploads always pass the LoadAsset ownership wall.
- 🧭 **Spatial awareness** — the AI relates what it *sees* to coordinates: `scene_state` grounds a screenshot (every visible object's world **and** on-screen pixel coords via projection), `pick` raycasts a screen point → world hit + surface normal (identify / trace), `place_on` computes and applies a *flush* placement (bounding-box offset, optional align-to-surface + grid snap), `objects_in_region` queries an area.
- 👥 **Concurrent multi-session** — run several Claude/Cursor sessions on the same Studio at once; one owns the plugin, the rest proxy through it, all commands serialized → no collisions.
- 🔒 **Read-only / safe mode** — `TUFAN_READONLY=1` hides all 38 write tools; mixed tools (`script_source`, `tag`) stay readable with writes blocked. Zero-risk AI exploration.
- 🎚 **Lean core toolset** — `TUFAN_TOOLSET=core` exposes only the ~24 everyday tools (the power suites stay one env-var away) for smaller tool menus and sharper AI focus.
- 👁 **Screenshots** — `capture_screenshot` returns a PNG of the Studio viewport so the AI can *see* its work. `get_asset_thumbnail` shows any catalog asset.
- ▶️ **Playtest control** — `playtest` (start / stop / pause) drives Run mode (server scripts + physics); `playtest_probe` runs structured Luau *inside* the running sim, `playtest_input` drives the character, and `run_luau` + `get_output_log` keep working *during* the run — a closed build→test→inspect loop.
- 🗺 **Multi-place** — `list_places`, `pull_place`, and `copy_script_across` to move a module straight from one open place into another.

## Tools (76)

| Group | Tools |
|---|---|
| **Scripts** | `script_source` · `grep_scripts` · `edit_script_lines` · `patch_script` · `find_and_replace_in_scripts` · `find_duplicates` |
| **Instances** | `create_instance` · `delete_instance` · `clone_instance` · `move_instance` · `rename_instance` · `create_tree` · `undo` · `redo` |
| **Properties** | `get_properties` · `set_property` · `mass_edit` · `search_by_property` · `get_attributes` · `set_attribute` · `mass_set_attribute` |
| **Inspection** | `get_tree` · `get_descendants` · `search_objects` · `get_services` · `describe` |
| **Tags** | `tag` · `get_tagged` |
| **Selection** | `get_selection` · `set_selection` |
| **Luau / Batch** | `run_luau` · `batch` |
| **Logs** | `get_output_log` · `get_recent_errors` |
| **Playtest** | `playtest` · `is_running` · `playtest_probe` · `playtest_input` |
| **Snapshots** | `snapshot` · `restore` · `list_snapshots` · `delete_snapshot` |
| **Responsive UI** | `make_responsive` · `scan_responsive` |
| **Audits** | `project_health` · `scan_perf` |
| **Spatial** | `scene_state` · `pick` · `place_on` · `objects_in_region` |
| **Git** | `git_status` · `git_log` · `git_diff` · `git_show` · `git_commit` · `git_push` · `git_pull` · `git_restore` · `git_revert` · `git_recover` · `git_branch` · `git_remote` |
| **Assets** | `search_assets` · `get_asset_details` · `get_asset_thumbnail` · `search_materials` · `insert_asset` · `import_file` |
| **Security** | `scan_backdoors` · `list_studio_plugins` |
| **Capture / HTTP** | `capture_screenshot` · `http_get` |
| **Multi-place** | `list_places` · `pull_place` · `copy_script_across` |
| **Meta** | `ping` |

In read-only mode (`TUFAN_READONLY=1`) the 38 write tools are hidden and the mixed read/write tools (`script_source`, `tag`) stay visible with their write paths blocked — 38 inspection tools remain. With `TUFAN_TOOLSET=core` only the ~24 everyday tools are exposed; both gates compose.

## How it works

- **Auto-mirror on connect** — opening a published place pulls its script tree to `<project>/projects/<Experience>_<universeId>/<Place>_<placeId>/`.
- **Two-way sync** — file edits push to Studio; Studio edits write to disk. A loop-guard prevents echo.
- **Git (opt-in)** — enable it in the widget; each place folder becomes its own repo. Off by default = plain files, no `.git`. A re-pull auto-snapshots first, so it never overwrites uncommitted work. `git_recover` brings back a deleted file from history.
- **Concurrent sessions** — the first server owns port 58741 + the plugin; others run as proxies that forward to it. The owner serializes every command through one plugin queue, so multiple sessions never collide. If the owner closes, a proxy promotes automatically.
- **Disconnect lock** — when the plugin goes offline the mirror is set read-only (copy-only) until it reconnects.

## Config (env)

| Variable | Effect |
|---|---|
| `TUFAN_PROJECT` | Project root for sync/git (use forward slashes). Defaults to cwd. |
| `TUFAN_READONLY=1` | Safe/inspector mode — write tools hidden, `script_source`/`tag` readable but write-blocked. |
| `TUFAN_TOOLSET=core` | Lean mode — expose only the ~22 everyday core tools (default `full` = all 72). |
| `TUFAN_AUTOCOMMIT=1` | Auto-commit each Studio→file edit (also toggle-able in the widget). |
| `TUFAN_AUTOPUSH=1` | Also push after each commit. |
| `TUFAN_PROJECTS_DIR` | Base dir override for auto-registered projects. |
| `TUFAN_OPENCLOUD_KEY` | Open Cloud API key for `import_file` (assets Read+Write scopes, [create one here](https://create.roblox.com/dashboard/credentials)). |
| `TUFAN_CREATOR_ID` / `TUFAN_GROUP_ID` | Upload owner override for `import_file` (defaults to the logged-in Studio user). |

---

## Potential capability (roadmap)

Where this can go — honest about what's built vs. next:

- **Full Play Solo automation** — `playtest` drives *Run* mode today (server + physics, no player character), and `playtest_input` can drive the character in a manually started F5 session. Starting/stopping full Play Solo (character + client + replicated GUI) has no plugin API yet; pairs with Roblox's official MCP for now.
- **Runtime introspection in play** — `playtest_probe` runs structured Luau inside a running Run-mode sim. Targeting a live Play Solo client/server would need injected companion agents.
- **Non-script instance mirroring** — models/parts as files on disk (geometry currently stays in Studio by reference, a plugin-API limit).
- **More Power Tools** — `scan_deprecated` (flag deprecated API usage across all scripts).
- **Asset pipeline** — inventory-insert for unowned assets, AI mesh/material generation (Roblox-privileged — pairs with the official MCP).
- **macOS screenshots** — `capture_screenshot` is Windows-only today.
- **Shared off-machine backup** — push every place mirror to a configured GitHub org with one click.

Issues + status tracked in [`ISSUES.md`](ISSUES.md). Contributions welcome.

## Repo

```
server/   TypeScript MCP server (published as npm `tufan-blox-bridge`)
plugin/   Luau Studio plugin (built to TufanBloxBridge.rbxm)
scripts/  build-plugin.ps1
docs/     launch notes, market comparison
```

## License

MIT © Tufan Studio.
