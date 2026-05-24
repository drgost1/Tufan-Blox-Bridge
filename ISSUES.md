# Tufan-Blox-Bridge — Known Issues & Improvement Roadmap

These are real problems hit while **using the plugin for a full day of game-dev work**
on a live place (Chomolokko Beach & Bars), not hypotheticals. Each item has the
evidence that surfaced it, its impact, and a concrete fix path tied to the actual
codebase. Ordered by impact.

**Status legend:** ⛔ Open · 🛠️ Partially fixed (verify deployed) · ✅ Fixed (verify deployed)

> ⚠️ Several fixes landed in v0.1.1 / v0.1.2 *during* the session that found these
> bugs. A long-running bridge launched before that upgrade is still running the old
> code — **restart the MCP server + reload the `.rbxm`** before trusting any "Fixed" tag.

## 🎯 Top 3 to fix first
Without these, the core promise — *"the AI does the work and verifies it itself"* —
is impossible; a human has to babysit every step.

1. **`capture_screenshot`** (H1) — the AI can't see what it built.
2. **Runtime introspection** (H2) — the AI is blind during playtests.
3. **Pull-before-commit data loss** (H4) — the "backup" can eat your work.

---

## 🔴 High impact — blocked work or caused loss

### H1 · `capture_screenshot` is unsupported &nbsp; ⛔ Open
**Evidence:** Every call returned *"Currently unsupported — no plugin pixel-capture API."*
Not one UI/scene/VFX build this session could be visually verified by the tool itself.
**Impact:** Biggest gap for an AI-driven Studio tool. The AI cannot see its own output,
so a human had to screenshot and paste back every time.
**Why it's hard:** Roblox plugins have no pixel-read API. `CaptureService:CaptureScreenshot`
returns a `rbxtemp://` id whose bytes a plugin cannot read or upload.
**Fix (server-side OS capture — the bridge runs on the same machine as Studio):**
- Add `mcp/tools/capture.ts` → dispatch a `getWindowBounds` op to the plugin (returns
  `workspace.CurrentCamera.ViewportSize` + GUI insets for context), then have the **Node
  server** grab the Studio window:
  - Windows: spawn PowerShell `System.Drawing.Graphics.CopyFromScreen` over the
    "Roblox Studio" window rect (enumerate via `System.Windows.Forms`/Win32 `GetWindowRect`),
    or use the `screenshot-desktop` npm package for full-screen + crop.
  - Return a **base64 PNG in an MCP image content block** (`{ type: "image", data, mimeType }`)
    so Claude/Cursor actually *see* it.
- This is the single highest-leverage feature. It converts the tool from "blind editor"
  to "agent that can look."

### H2 · Total runtime blindness (playtest) &nbsp; ⛔ Open
**Evidence:** `run_luau` is documented *"Execute Luau in **edit mode**"*; `get_playtest_output`
**timed out at 30 s twice** (*"Plugin did not respond within 30000ms"*) — exactly while
debugging a live spinner bug. Net: nothing observable at runtime; had to plant `print`
diagnostics and read the human's Output screenshot. Turned one bug into 5–6 round-trips.
**Root cause:** The plugin lives in the **Edit** DataModel. During Play Solo a separate
server+client DataModel runs, which the plugin can't reach; meanwhile the poll loop appears
to stall, so output requests block to timeout.
**Fix:**
- **Companion runtime agents:** on connect, inject a `Script` into `ServerScriptService`
  and a `LocalScript` into `StarterPlayerScripts` (or via `run_luau` at playtest start) that
  open their own HTTP channel to the bridge during play. `run_luau` then gains a
  `context: "edit" | "playServer" | "playClient"` arg routed to the right agent.
- **Non-blocking output:** the plugin should continuously buffer `LogService.MessageOut`
  + seed from `GetLogHistory()` into a ring buffer, and `get_playtest_output` should read
  that buffer immediately (never a 30 s synchronous wait). Make the poll loop survive the
  edit→play transition (re-arm on `RunService:IsRunning()` changes).

### H3 · `insert_asset` can't load most free models &nbsp; ⛔ Open
**Evidence:** *"LoadAsset failed: User is not authorized to access Asset."* — couldn't insert
a merry-go-round free model.
**Impact:** The whole asset-insert capability fails for the common case (toolbox free models
not owned by the logged-in user). Ironic given the tip *"run scan_backdoors after inserting
free models"* — you can't insert them.
**Why:** `InsertService:LoadAsset` only succeeds for assets the **logged-in user owns** or
Roblox-created assets; arbitrary free models 403 server-side. The bridge can't bypass Roblox auth.
**Fix:**
- Detect the auth error and return an **actionable message**: *"You must take/own this model
  first (Toolbox → Add to Inventory), then retry."*
- Add `insert_owned_asset` that lists/inserts from the user's inventory (owned, always
  authorized), and document the ownership requirement in the tool description.
- Optionally try `InsertService:LoadAssetVersion` and surface the distinction between
  "not owned" vs "private" vs "moderated."

### H4 · `pull_place` overwrites uncommitted files → real data loss &nbsp; 🛠️ Partially fixed
**Evidence:** The per-place mirror repo had **0 commits**, everything untracked
(`fatal: ... does not have any commits yet`). A re-pull **overwrote/removed** untracked
files — 7 ReplicatedStorage modules + 5 `CarryChoises` files vanished from the mirror with
no git history. The only real save was the **main repo's committed `src/`**, not the bridge's
own repo. "Backup exists" was false security.
**Impact:** The headline feature (git-backed mirror) actively lost data and gave false
confidence.
**Fixed so far:**
- ✅ v0.1.1 `baselineCommitIfEmpty()` — first pull now makes a baseline commit so a place is
  never stuck at 0 commits.
- ✅ v0.1.2 loop-guard added to both watcher `unlink` handlers — a server-side delete no
  longer echoes back into Studio.
**Still open (critical):**
- ⛔ **Pre-pull snapshot:** before `pullPlace` writes, run `git add -A && git commit -m
  "pre-pull snapshot"` (or stash) so *nothing uncommitted is ever overwritten*. This is the
  real fix and isn't in yet.
- ⛔ **Non-destructive pull:** never delete a mirror file for a script that still exists in
  Studio; pull to a temp dir then atomic-swap; warn on large deltas (e.g. >20% of files
  removed) instead of silently applying.

### H5 · `scan_backdoors` can't see installed plugins &nbsp; ⛔ Open
**Evidence:** The session's actual threat was a **`UITools` cloud plugin** loading remote
asset `16781084836` (`cloud_6514761722.UITools.Main`). The scanner is blind to it — it walks
the place DataModel, not installed Studio plugins.
**Impact:** As a security product this is a real gap: the most dangerous vector (a plugin
running remote code) is exactly what it misses.
**Fix:**
- Plugins aren't in the DataModel, but their **symptoms** are detectable. Extend the scanner
  (`plugin/src/Handlers/Security.luau`) to flag in-place scripts that: `require(<numericAssetId>)`
  (remote require), `HttpService:GetAsync(...)` + `loadstring`, `getfenv`/`setfenv` obfuscation,
  or insert GUIs named like known tools.
- Scan `CoreGui` / `PluginGuiService` descendants where reachable.
- Document the installed-plugin limitation honestly and recommend Studio's own plugin audit.

---

## 🟡 Medium — reliability / noise

### M6 · MCP connection instability &nbsp; 🛠️ Partially fixed
**Evidence:** Session start `/mcp`: *"Failed to reconnect to tufan: connection timed out
after 30000ms"*, then a later reconnect. Logs show multiple instances fighting over port
58741 (`EADDRINUSE`).
**Fixed:** ✅ v0.1.1 graceful `EADDRINUSE` (clear message + exit instead of an unhandled crash).
**Still open:** single-instance guarantee (port lockfile / detect-and-reuse), faster boot so
the MCP `connect` doesn't hit the 30 s ceiling, and a `/health` endpoint. Ensure the long-poll
timeout is comfortably under the client timeout with keepalive.

### M7 · `pull_place` is inconsistent / partial &nbsp; ⛔ Open
**Evidence:** `projects/` dump didn't match the live tree — `CarryChoises` existed in Studio
but files were missing on disk; ReplicatedStorage showed 8 vs expected. Stale/partial pulls
make the baseline unreliable.
**Fix:** make pull atomic + self-verifying: count `LuaSourceContainer`s in Studio, count files
written, log any discrepancy and surface it in the result. Handle duplicate siblings
(✅ v0.1.2 `uniquePath`) and folder-scripts consistently. Consider temp-dir + atomic swap.

### M8 · `search_objects` is a noisy substring match &nbsp; ⛔ Open
**Evidence:** Searching `"go"` returned 100+ unrelated hits (Hexagon, gobo, TorchSeating).
No regex / whole-word / case control, so finding an exact instance was painful.
**Fix:** add `matchMode: "substring" | "exact" | "wholeWord" | "regex"` + `caseSensitive`
params, and rank results (exact > prefix > substring). Cap + paginate large result sets.

---

## 🟢 Minor / cosmetic

### m9 · `get_children` on an empty folder is ambiguous &nbsp; ⛔ Open
*"completed with no output"* — can't tell empty from failure (hit on `CarryChoises`, `Ludo`,
`TufanAuditTemp`). **Fix:** always return an explicit `{ children: [] }`.

### m10 · Nested-git-repo footgun &nbsp; 🛠️ Partially fixed
`pull_place` writes a `.git` *inside* the user's project repo → embedded-repo (gitlink) trap.
**Fixed:** ✅ v0.1.1 `ensureMirrorIgnored()` auto-adds `projects/` to the parent repo's
`.gitignore`. **Consider:** placing the mirror outside the user's repo entirely by default.

### m11 · Plugin icon fails to load &nbsp; ⛔ Open
Output: *"Unable to load plugin icon: rbxassetid://118914904301383"*. **Fix:** upload/own a
valid public icon asset, or bundle it; verify the id before shipping.

### m12 · `audit.mjs` leaves junk on interrupt &nbsp; ⛔ Open
An empty `TufanAuditTemp` was left in ReplicatedStorage (create at line 52 succeeded, then the
run stopped before rename/delete). **Fix:** wrap the CRUD probe in `try/finally` that deletes
the temp instance, and delete any leftover `TufanAudit*` on start.

### m13 · `git_log` raw error on an empty repo &nbsp; ⛔ Open
Empty repo throws the raw *"does not have any commits yet"*. **Fix:** catch it and return a
friendly *"no commits yet"* (same spirit as `baselineCommitIfEmpty`). Largely masked now that
first pull baselines, but the error path remains.

---

## Theme
The recurring root cause behind the High items: **an AI agent can't close its own
loop.** It can edit, but it can't *see* (H1), can't *observe runtime* (H2), and its
*safety net leaked* (H4/H5). Fixing those three turns this from "a fast editor a human must
verify" into "an agent that builds, looks, and checks itself" — the actual product.

_Source: real usage during the Chomolokko Beach & Bars build, 2026-05. Update as items land._
