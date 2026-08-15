# Tufan-Blox-Bridge vs. the market

How Tufan-Blox-Bridge stacks up against every other AI/MCP plugin for Roblox
Studio as of **May 2026**. The goal here is honesty, not marketing — where a
competitor is ahead, it says so.

> **TL;DR** — Tufan is the only tool that combines *AI control + two-way file
> sync + per-place git + a backdoor scanner* in one free, MIT-licensed install.
> Every other tool does a subset, and the ones that come closest on sync
> (WEPPY) paywall it and have no git or security story.

## The field

| Tool | What it is | License / price | Status |
|---|---|---|---|
| **Tufan-Blox-Bridge** | AI control + 2-way sync + git + security + asset generation, one install | MIT, free | Active (v0.15.0) |
| **Roblox built-in MCP** | Official server shipping inside Studio + Assistant | First-party, free | Active, recommended by Roblox |
| `Roblox/studio-rust-mcp-server` | Official standalone reference server | Apache-2.0, free | **Archived Apr 2026** |
| **WEPPY** (`hope1026`) | AI control + sync, freemium | Free + paid **Pro** | Active |
| `boshyxd/robloxstudio-mcp` | AI control, full + read-only editions | MIT, free | Active (v2.7.0) |
| `drgost1/robloxstudio-mcp` | AI control, 51 tools | MIT, free | Active (predecessor to Tufan) |

## Feature matrix

| Capability | Tufan | Roblox built-in | rust-mcp (archived) | WEPPY | boshyxd | robloxstudio-mcp |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| AI tool control (MCP) | ✅ 86 | ✅ | ✅ 6 | ✅ | ✅ 43 | ✅ 51 |
| Line-level script edit | ✅ | ⚠️ | — | — | ✅ | — |
| Bulk create / duplicate / nested-tree | ✅ (+ create_tree) | — | — | — | ✅ | — |
| Read-only / safe mode | ✅ (`TUFAN_READONLY=1`) | — | — | — | ✅ (Inspector, 31) | — |
| Script get/set + grep | ✅ | ✅ | partial | ✅ | ✅ | ✅ |
| Project-wide find/replace | ✅ | — | — | ✅ (Pro bulk) | — | partial |
| Run Luau (edit mode) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Playtest control | — (defers to Roblox built-in) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Log capture during play | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Two-way file sync** | ✅ | — | — | Pro only | — | — |
| One-way sync (Studio→disk) | ✅ | — | — | ✅ free | — | — |
| **Per-place git** (commit/diff/restore) | ✅ | — | — | — | — | — |
| Auto-commit / auto-push | ✅ | — | — | — | — | — |
| **Backdoor / security scanner** | ✅ | — | — | — | — | — |
| List installed Studio plugins | ✅ | — | — | — | — | — |
| **Multi-place** (cross-place copy, pull) | ✅ | — | — | Pro only | — | — |
| OS-level screenshot → AI | ✅ (Win) | — | — | — | — | — |
| Asset search / insert | ✅ | ✅ (insert_model) | ✅ | ✅ | ✅ | ✅ |
| **AI 3D-asset generation** (text/image → lint/fix → upload → insert) | ✅ | ⚠️ mesh-gen only, no pipeline | — | — | — | — |
| Headless Blender processing (decimate/split/fracture/convert) | ✅ | — | — | — | — | — |
| Local-file import via Open Cloud (.fbx/.glb/audio/images) | ✅ | — | — | — | — | — |
| Terrain tools | — | ✅ | — | ✅ (Pro) | partial | ✅ |
| Disconnect read-only lock | ✅ | — | — | — | — | — |

## How the close competitors actually differ

### Roblox built-in MCP (the one to watch)
Roblox now ships an MCP server *inside* Studio and routes its Assistant through
it. It's first-party, zero-install, and will always have the deepest engine
access (terrain, physics, the things a plugin API can't reach). **This is the
real long-term competition.** What it does *not* do: mirror your scripts to disk
as real files, version them with git, or scan for backdoors. Tufan's bet is that
serious teams want their code on disk, in git, and audited — a dev-workflow
layer the engine vendor isn't building. Expect to run both.

### WEPPY — the closest on sync, but paywalled and no git/security
WEPPY is the only other tool with real sync and multi-place. Both are **Pro
(paid)**; the free tier is one-way Studio→local only. WEPPY also leans on
"action-based dispatch" (fewer, fatter tools) for token efficiency and has a
polished dashboard + VS Code explorer. It has **no git integration and no
security scanning** — the two things Tufan treats as first-class. If you want
bidirectional sync *plus* version control *plus* an auditor without a
subscription, Tufan is currently the only option.

### boshyxd/robloxstudio-mcp — best safety story, no workflow layer
43 tools, plus a genuinely nice **Inspector Edition**: 31 read-only tools, no
writes at all — great for letting an AI explore a place with zero risk. Tufan
now ships the same profile via `TUFAN_READONLY=1` (write tools hidden, mixed
tools write-guarded). But boshyxd has no sync, no git, and no backdoor scanner.

### drgost1/robloxstudio-mcp — Tufan's own predecessor
Same author. 51 granular tools, all-local HTTP polling, MIT. It's pure AI
control: no sync, no git, no scanner, single-place. Tufan-Blox-Bridge is
effectively its successor — fewer raw tools, but it adds the entire
sync/git/security/multi-place layer on top.

### studio-rust-mcp-server — archived
The original official reference (6 tools, Rust). **Archived April 2026** in
favor of the built-in server. Listed for history only; don't start here.

## Where Tufan wins

1. **Only all-in-one** — AI control + 2-way sync + git + security scanning in a
   single free install. Everyone else does a subset, or charges for the overlap.
2. **Per-place git is unique.** No other tool versions each open place as its own
   repo with auto-commit/auto-push and a disconnect read-only lock.
3. **Only one with a backdoor scanner.** `scan_backdoors` (require-of-Value,
   loadstring+HttpGet, exploit APIs, Discord webhooks, obfuscation, hidden binary
   attributes) plus `list_studio_plugins` for the remote-code-plugin vector.
   Security is a real pain in the Roblox ecosystem and nobody else addresses it.
4. **Free two-way sync.** WEPPY's bidirectional sync is Pro-only; Tufan's is free.
5. **Multi-place free.** Cross-place script copy and pull, no paywall.
6. **Only full AI asset pipeline.** `generate_asset` goes text-prompt → Meshy AI
   mesh → headless-Blender Roblox-limit lint + auto-fix (20k tris, 1024px
   textures) → Open Cloud upload → inserted Model → **post-insert finishing**
   (anchored, scaled to stud height, semantic names, flat-color recovery,
   CollisionFidelity, flush ground placement, traceability attributes — one
   undo step), in one tool call. `previewFirst` renders a thumbnail of the
   geometry preview *before* the texture credits are spent. Roblox's built-in
   MCP has first-party mesh *generation* (Cube 3D), but no lint/fix pass, no
   local Blender stage, no finishing, and no arbitrary local-file import;
   nobody else has any of it. (Meshy stage needs the user's own Meshy API key.)

## Where Tufan is behind (honest gaps)

1. **The built-in Roblox MCP** will out-reach any plugin on raw engine access and
   needs zero install. Tufan should position as the *workflow/disk/git/security*
   layer on top, not as a replacement.
2. **No terrain tools** yet (built-in MCP, WEPPY, and robloxstudio-mcp have them).
3. **Non-script instance mirroring is WIP** — models/parts don't yet round-trip
   to disk as files (a Roblox plugin-API limit). _(Same-named sibling scripts no
   longer collapse — disambiguated with ` (N)` suffixes since v0.1.2.)_
4. **Screenshot is Windows-only**; macOS capture is unimplemented.
5. **Fewer clients verified.** WEPPY explicitly lists Antigravity + Codex App +
   Gemini CLI etc.; Tufan documents Claude Code / Cursor primarily.

## Recommendation by use case

- **Solo dev who wants AI + code in git, free:** Tufan-Blox-Bridge.
- **Team that needs bidirectional sync + a dashboard and will pay:** WEPPY Pro
  (but you give up git + security — or run Tufan alongside for those).
- **Just want safe read-only AI exploration:** boshyxd Inspector Edition.
- **Want the deepest engine access, zero install:** Roblox's built-in MCP — and
  layer Tufan on top for disk/git/security.
- **Auditing a place for backdoors:** Tufan is the only choice.

---

*Sources: project READMEs and release pages for each tool (GitHub:
`Roblox/studio-rust-mcp-server`, `hope1026/weppy-roblox-mcp`,
`boshyxd/robloxstudio-mcp`, `drgost1/robloxstudio-mcp`) and the Roblox Developer
Forum announcements on the built-in Studio MCP server, as of May 2026. Tool
counts and free/paid splits reflect those sources and may change.*
