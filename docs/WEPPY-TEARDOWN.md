# weppy-roblox-mcp vs Tufan-Blox-Bridge -- Competitive Teardown
_Generated 2026-06-30 via a 23-agent adversarial workflow (every "weppy wins" claim cross-checked against what Tufan actually ships)._

**Competitor:** hope1026/weppy-roblox-mcp -- commercial open-core freemium (homepage weppyai.com, AGPL-3.0 + commercial license). The GitHub repo is a distribution/docs shell; the server (npm `@weppy/roblox-mcp`) and Studio plugin (marketplace) are CLOSED SOURCE. 43 stars, created 2026-01-26.

---

# Tufan vs weppy -- Decision Brief

## 1. The Real Answer

Weppy is a better **product**, not a better **engine**. Tufan's core capability is clearly stronger -- mesh generation, DataStore/cloud_luau, real per-place git with offsite backup, a backdoor scanner, and fully-open/no-paywall all belong to Tufan and weppy has no answer. The "performs significantly better" perception is almost entirely **onboarding/UX/marketing + one self-inflicted bug**, not capability and not really token-cost. When the teardown was pressure-tested, every "weppy is leaner/faster/smarter-per-token" claim collapsed to a tie (its "streaming transport" can't even physically push to a Studio plugin; its per-call Place routing is something Tufan already has via `placeArg`; in Claude Code the 86 tools are deferred anyway). What survived as genuine weppy wins are all *surfaces*: a web dashboard, a multi-client installer, a VSCode tree, shipped agent skills, marketplace listings -- plus the killer: **Tufan's documented install resolves a stale 0.6.0 because npm publish is paused**, so a new user literally runs 7 versions behind the real code. That single bug does more damage to perception than weppy's entire feature list.

## 2. Scorecard

### Genuine capability (engine)
| Axis | Winner | Why |
|---|---|---|
| 3D mesh generation (Meshy->Blender->finishing) | **Tufan** | Weppy is image-only and delegates even that to the AI client -- category it cannot do at all |
| DataStore + cloud_luau + http_get | **Tufan** | Weppy explicitly *blocks* DataStoreService; no datastore tool exists |
| Versioned sync (per-place git, offsite GitHub backup, branch/restore/revert) | **Tufan** | Weppy's "sync history" is a local-only change log, auto-trimmed >2MB |
| End-to-end asset automation (auto-insert + finishing, resumable) | **Tufan** | Weppy makes you apply the asset URI yourself |
| Backdoor scanner | **Tufan** | Weppy has no malware scan for inserted free models |
| Open source + no telemetry by default | **Tufan** | Weppy server+plugin closed, GA4 telemetry on by default |
| No paywall (two-way sync, Open Cloud, multi-place all free) | **Tufan** | Weppy gates exactly these behind Pro |
| Tool surface / token cost | **Tie** | Weppy's 24-vs-87 token thesis is overstated; fat union schemas + Claude deferral wipe out the edge |
| Transport latency (long-poll vs "streaming") | **Tie** | Weppy can't push to a Roblox plugin; both are long-poll on loopback |
| Multi-Place routing (per-call selector + fail-closed) | **Tie** | Tufan already ships `placeArg` + "place not connected" guard |
| Reliability hardening | **Tie** | Weppy's lead is a *changelog*, not a proven gap; Tufan has watchdog + ownership failover |
| Runaway rails (rate limit) | **Tie** | Tufan serializes to 1 in-flight op -- tighter than weppy's 450/min |
| Open Cloud upload of existing file | **Tie** | Weppy lists slightly more categories; Tufan auto-inserts |

### Perception / onboarding (product) -- where weppy actually wins
| Axis | Winner | Why |
|---|---|---|
| **npm install freshness** | **weppy** | Tufan's `@latest` resolves dead 0.6.0 (publish paused) -- #1 perceived-quality killer |
| Web dashboard (topology, tools history, before/after changelog) | **weppy** | Tufan has zero web UI, only a bare DockWidget |
| Multi-client installer (7 clients, auto-register) | **weppy** | Tufan auto-registers Claude Code only; others hand-wire |
| Shipped per-IDE skill/agent guides | **weppy** | Tufan ships no agent coaching -> fresh agent fumbles 86 tools |
| VSCode "Roblox Explorer" tree | **weppy** | Tufan tree lives only in Studio / as files |
| Marketplace listings (VSIX, Open VSX, plugin marketplaces, Smithery) | **weppy** | Tufan = GitHub + paused npm only |
| Conflict-resolution UX (direction policy + post-play prompt) | **weppy** | Tufan's live sync is silent last-writer-wins; no conflict surface |
| Plugin auto-install | **Tie** | (Brief was wrong -- Tufan's installer already auto-copies the .rbxm) |

## 3. Tufan's Moats to Protect (weppy has nothing here)

1. **Text/image->3D mesh generation** -- the single hardest-to-copy differentiator. Lead all marketing with "describe a prop, get a finished scaled/anchored/collidable mesh in the tree." Never let it be framed as parity.
2. **Live-data reach** -- DataStore REST + cloud_luau + http_get. Weppy structurally forbids this (its own docs admit the block).
3. **Real git with offsite backup** -- branch/diff/revert/restore/recover + push to private GitHub. Survives disk loss; weppy's mirror is one local copy.
4. **Backdoor scanner** -- concrete protection against the #1 Roblox infection vector (require-of-Value free models).
5. **Fully open + no telemetry + no paywall** -- for security-minded and cost-sensitive devs, this beats weppy's closed/Pro/GA4 model on trust and value.

## 4. Prioritized Action Plan

### THE single biggest quick win (same-day)
**Run `npm publish` for 0.13.0, then wire CI to auto-publish on every git tag.** This is an operational lapse, not engineering -- it instantly erases the worst perception gap (users installing a dead build). It is the highest impact / lowest effort move on this entire list. Until republished, pin the README to a known-good version instead of `@latest`. *(Effort: minutes. Impact: massive.)*

### Same-day to a few days (high leverage)
2. **Ship agent-facing skills/guides WITH the product, and leapfrog via the MCP layer.** Add a Claude Code plugin skill + Codex agent manifest (coach: prefer typed tools over `run_luau`, asset-pipeline order, git flow, guardrails). Then populate the MCP server `instructions` field + register MCP prompts so **every** client (Cursor, Windsurf, generic) gets coaching with no per-IDE plugin -- something weppy's plugin-only skills can't match. *(1 day. Closes the "weppy's AI feels smarter" illusion.)*
3. **Multi-client installer.** Extend `install.ps1`/`install.sh` to detect + merge MCP config for Claude Desktop, Cursor, Codex (TOML), Gemini, Antigravity. ~200 lines. Tufan already auto-installs the plugin AND the server, so a single one-liner doing both all-client registration + plugin install **beats** weppy for Roblox. *(1 day. Do AFTER npm publish or you spread a stale build.)*
4. **Local web dashboard off the existing 58741 Express bridge.** No new infra -- render `git_log`/`git_diff`/`git_status` + proxy session registry as a static page: tools history, before/after changelog, sync state, connection topology. **Leapfrog:** put a one-click "Revert this change" on each entry wired to `git_revert`/`git_restore` -- weppy's changelog is view-only; yours is view-and-undo. *(2-4 days. Neutralizes the biggest "feels finished" gap.)*

### Multi-week builds (do after the quick wins)
5. **VSCode (+ Open VSX) extension** -- thin webview over the existing bridge: render the `export_sourcemap` tree with class icons, then make nodes actionable (fire `insert_asset`/`rename`/`delete`, "AI: act on this node"). Tufan already produces the data weppy's explorer just renders; making it bidirectional beats weppy.
6. **Conflict-resolution UX in the plugin** -- this is a *real* gap, not perception. Add per-path direction policy (`.tufan-sync.json`), real conflict detection (content-hash in loopguard), an interactive Keep-Studio/Keep-Local list (git-backed, so reversible), and a post-play reconciliation prompt on `RunService:Stop` (Tufan's edits-persist-through-playtest design currently auto-commits silently -- close that).
7. **Distribution/listings** -- `.claude-plugin/marketplace.json` + `.codex-plugin/plugin.json` (bundle Tufan's subagents/skills -- leapfrogs weppy), Smithery badge, mcpservers.org/Glama aggregators, and a Roblox DevForum "Community Resources" thread (highest-signal channel in the actual target community). Low effort, pure discoverability.

### Bottom line
Don't get defensive about the engine -- it's ahead. Spend the next week turning that engine into something that *looks* as finished as it actually is: publish the package, ship the coaching, surface a dashboard. Those three moves erase ~80% of the "weppy performs significantly better" perception without touching a single capability.
