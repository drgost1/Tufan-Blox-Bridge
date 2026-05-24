# Tufan-Blox-Bridge

## One-line install (Windows, PowerShell)

```powershell
iwr https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.ps1 | iex
```

Installs:
- `TufanBloxBridge.rbxm` into `%LOCALAPPDATA%\Roblox\Plugins\`
- Argon CLI into `~/.tufan-bridge/bin` (adds to PATH)
- Patches your Claude Code MCP config (if found) to start `robloxstudio-mcp` on launch

Then in your Roblox project folder: `argon init && argon serve`, restart Studio, restart Claude Code.

---

One Roblox Studio plugin that combines:

1. **[Argon](https://github.com/argon-rbx/argon-roblox)** — two-way sync between filesystem and Studio (via the Argon CLI on port `34872`)
2. **[boshyxd's MCP](https://github.com/boshyxd/robloxstudio-mcp)** — AI tool access via the Model Context Protocol (via Node MCP server on port `58741`)
3. **Tufan AI Dev layer** — coordination, activity feed, auto-snapshot, error mirror, lockdown mode (Phases B and C)

Brand: **Tufan Studio**. Built for the Chomolokko + Meet the Storm pipelines, designed to be reusable on any Roblox project.

## Status

**Phase A done** — vendored upstream `.rbxm` files booted side-by-side under one plugin.

**Phase B done (current)** — Coordinator + unified Tufan toolbar.
- `HealthCheck` pings ports `34872` (Argon CLI) and `58741` (MCP server) every 5s, drives status pills.
- `ActivityFeed` rings-buffers the last 200 LogService events, categorized as `argon` / `mcp` / `error` / `system` / `other`. Filterable in the Activity tab.
- `EditLock` is a documented stub — proper mutex requires source-level vendoring (Phase D). The race in practice is rare since both Argon and MCP eventually converge on the same content.
- Tufan toolbar with one button → 4-tab DockWidget (Argon / MCP / Activity / AI Dev).
- Argon's and boshyxd's own toolbars are still visible because their vendored Scripts run their own bootstraps. Suppressing them needs source-level patches.

**Phase C** — AIDev (auto-snapshot, error mirror, lockdown, playtest tracking).
**Phase D (deferred)** — source-level vendoring with patches, unified Rust backend.

See [`.claude/plans/i-have-two-plugins-sprightly-walrus.md`](../.claude/plans/i-have-two-plugins-sprightly-walrus.md) for the full plan.

## Build

Requires `argon` CLI (`tools/argon.exe` in the parent project, or installed globally).

```powershell
pwsh scripts/build.ps1
```

Produces `TufanBloxBridge.rbxm` at repo root and (with `--install`) copies it into `%LOCALAPPDATA%\Roblox\Plugins\`.

## Install

1. Uninstall `Argon.rbxm` and `MCPPlugin.rbxmx` from `%LOCALAPPDATA%\Roblox\Plugins\` (so they don't conflict).
2. Drop `TufanBloxBridge.rbxm` into that folder.
3. Restart Studio.

Both Argon and MCP boot from inside this plugin — keep their backends running:

- `argon serve` (port `34872`)
- Claude Code MCP config points at `npx -y robloxstudio-mcp@latest` (port `58741`)

## Layout

```
src/
├── init.server.luau            # plugin root Script, runs on load
├── Coordinator/                # PHASE B — locks, feed, health
├── AIDev/                      # PHASE C — snapshot, error mirror, lockdown, playtest
├── UI/                         # PHASE B — unified toolbar + tabs
└── vendor/
    ├── argon/Argon.rbxm        # upstream Argon plugin binary
    └── mcp/MCPPlugin.rbxmx     # upstream boshyxd plugin binary
```

## Re-vendoring upstreams

When upstream ships a new version:

```powershell
pwsh scripts/vendor-argon.ps1     # downloads latest Argon.rbxm release
pwsh scripts/vendor-mcp.ps1       # downloads latest MCPPlugin.rbxmx release
pwsh scripts/build.ps1
```

## License

Tufan Studio code (anything outside `src/vendor/`) — see `LICENSE`. Vendored upstreams keep their own licenses — see `NOTICE`.
