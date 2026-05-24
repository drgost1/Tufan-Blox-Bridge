# Launch post (DevForum — Community Resources) — DRAFT

> Positioning: lead with the **backdoor scanner** (universal fear, instantly demoable),
> then reveal the depth (AI control + two-way sync + git). Honest about WIP.

---

## [Plugin] Tufan-Blox-Bridge — scan your game for backdoors, and let AI build it with you

Every Roblox dev who's ever inserted a free model has the same quiet fear: *did that come with a backdoor?* So I built a tool that scans your whole place for them in seconds — and it already caught a live `require(...Value)` backdoor in my own shipped game that survived a manual scrub.

That scanner turned out to be one piece of something bigger. **Tufan-Blox-Bridge** connects your AI assistant (Claude Code, Cursor) directly to Studio, syncs your code to the filesystem, and versions it with git — all from one plugin.

### 🛡️ Security scanner (the headline)
`scan_backdoors` checks every script **and** instance attributes/StringValues for:
- `require(...Value)` asset-id backdoors, `loadstring` + `HttpGet` remote exec
- `getfenv`/`setfenv`, exploit APIs (`hookfunction`, `getgenv`, Synapse)
- Discord-webhook exfiltration, anti-debug (`IsStudio`/`JobId`), obfuscation (entropy-scored blobs, `string.char` chains)
- Hidden binary payloads stashed in attributes/Values — the spot script-only scanners miss

Run it on any place you've imported free models into. It ranks findings high→low.

### 🤖 Full AI control of Studio (MCP)
~40 tools your AI can call: read/write scripts, create/edit/clone instances, get/set properties + attributes, CollectionService tags, tree inspection, run Luau, read the output log, project-wide find-and-replace, selection.

### 🔄 Two-way file sync + git
Open a place → its scripts auto-mirror to a local folder. Edit a file → Studio updates; edit in Studio → the file updates. Each place is a git repo with optional **auto-commit / auto-push** toggles. Multi-place + cross-place: copy a module straight from one open place into another.

### Install
```
# 1. plugin + server, one line (Windows PowerShell):
iwr https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.ps1 | iex
# macOS/Linux: curl -fsSL .../install.sh | bash

# 2. point your AI client at it (forward slashes!):
claude mcp add tufan --env TUFAN_PROJECT=C:/path/to/project -- npx -y tufan-blox-bridge
```
Restart Studio + your AI client. Free + open-source (MIT): https://github.com/drgost1/Tufan-Blox-Bridge

### Honest about what's WIP
- Script sync, AI tools, git, and the scanner are solid and tested.
- Non-script **instance** mirroring (models/parts as files) is in progress — geometry stays in Studio by reference (a Roblox plugin limit, same as Rojo/Argon).
- Same-named sibling scripts currently collapse in the mirror (UUID-suffixing coming).
- Screenshots / programmatic playtest aren't supported (no Roblox plugin API).

Built by **Tufan Studio**. Feedback + PRs welcome — tell me what tools you want next.

---

## Posting checklist
- [ ] Publish server to npm (`npm publish`) so the `npx` line works
- [ ] Tag a GitHub release with `TufanBloxBridge.rbxm` attached
- [ ] Record a 20s GIF of `scan_backdoors` catching something (the hook)
- [ ] Post to DevForum #Community-Resources, then cross-post: r/robloxgamedev, X #RobloxDev
- [ ] Custom 32×32 toolbar icon before posting (currently blank)
