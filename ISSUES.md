# Tufan-Blox-Bridge — Known Issues & Improvement Roadmap

Real problems hit while **using the plugin for a full day of game-dev work** on a
live place (Chomolokko Beach & Bars), with evidence, impact, and concrete fixes.

**Status:** ✅ Fixed · 🛠️ Partially fixed · ⛔ Open · ℹ️ Not our bug

> Current version: **v0.9.0** (server-only — the v0.8.0 plugin `.rbxm` stays
> current). After upgrading, restart the MCP client (npx pulls latest).

## ✅ What landed in v0.6.1 → v0.9.0
- **Local file import (v0.9.0)** — new `import_file` tool: uploads `.rbxm`/`.rbxmx`/`.fbx`/`.gltf`/`.glb`/audio/images from disk to the user's own account via the Open Cloud Assets API (`TUFAN_OPENCLOUD_KEY`), polls processing, then inserts into the place (Model → `insertAsset`; audio/image/animation → `Sound`/`Decal`/`Animation` wrapper instance). Your own uploads always pass the H3 LoadAsset ownership wall. Resumable via `operationId` for slow audio moderation; quota + moderation surfaced. Server-side only — zero plugin changes.
- **Serialization round-trip (v0.8.0 keystone)** — NumberSequence, ColorSequence, NumberRange, Rect, Font, PhysicalProperties now round-trip through `get_properties`/`set_property`/`mass_edit`/`describe`; particle curves, UI gradients, and springs are finally editable (they silently broke before).
- **Surgical tool merges (v0.8.0, breaking renames)** — `script_source` (read+write), `tag` (get/add/remove), `playtest` (start/stop/pause).
- **New tools** — `describe`, `batch`, `patch_script`, `snapshot`/`restore`/`list_snapshots`/`delete_snapshot`, `get_recent_errors`, `scan_perf`, `playtest_probe`, `playtest_input` (v0.6.1); `make_responsive`, `scan_responsive` (v0.7.0); `project_health`, `find_duplicates`, `mass_set_attribute` (v0.8.0).
- **Tool surface trimmed 79 → 71 (v0.7.0)** — 8 redundant tools killed, each with an exact survivor (`get_children`→`get_tree`, `get_script_tree`→`search_objects`, `mass_set_property`→`mass_edit`, `mass_create`/`mass_duplicate`→`batch`/`create_tree`, `insert_script_lines`/`delete_script_lines`→`edit_script_lines`, `get_playtest_output`→`get_output_log`). New `TUFAN_TOOLSET=core` tiering exposes a lean everyday core (~20 tools at v0.7.0, ~22 at v0.8.0).
- **Read-only mode hardened (v0.7.1/v0.8.0)** — `copy_script_across`/`playtest_probe`/`pull_place` no longer leak as callable; mixed tools (`script_source`, `tag`) stay visible but write-guarded, so inspector mode can still read.
- **Pre-pull data-loss residual closed (v0.7.1)** — a failed protective snapshot now *aborts* the pull instead of silently overwriting the dirty mirror.
- **Watchdog (v0.7.1)** — `run_luau`/`playtest_probe` return a clear error on infinite-yield payloads (default 30s, `timeoutBudget` overridable).
- **Mass ops report per-item failures (v0.7.1)** — partial failures are no longer hidden.
- **Playtest-persist fix (v0.6.1)** — only the edit-context plugin instance serves; edits made during a playtest land in the edit DataModel and survive the run.

## ✅ What landed in v0.2.0
- **H1 capture_screenshot** — works now (server-side OS capture → MCP image; verified producing real PNGs).
- **H4 pre-pull data loss** — closed: a re-pull auto-commits any dirty mirror state first, so uncommitted work is never overwritten.
- **M6 connection instability** — self-healing port: a new instance asks a stale one to step down and retries, instead of dying on `EADDRINUSE`.
- **M7 partial pull** — pull now self-verifies (Studio count vs files written) and warns on mismatch.
- **M8 noisy search** — `search_objects` gained `matchMode` (substring/exact/wholeWord/regex) + `caseSensitive`.
- **H5 (partial)** — new `list_studio_plugins` surfaces installed plugins (the remote-code-plugin blind spot).
- **m9 / m12 / m13** — fixed (empty-children clarity, audit temp cleanup, graceful `git_log`).

---

## 🔴 High impact

### H1 · `capture_screenshot` &nbsp; ✅ Fixed (v0.2.0)
Was unsupported (no plugin pixel API). Now the **server** captures the Roblox
Studio window at the OS level (PowerShell `CopyFromScreen`, downscaled to 1280px,
PNG → base64 → MCP image block); falls back to the primary screen if the window
isn't found. Windows-only for now. **Verified** producing valid ~1.3 MB PNGs.
The AI can finally see its own work. _Future: macOS support, region/element crop._

### H2 · Runtime introspection &nbsp; 🛠️ Partially fixed
**Output reliability — fixed:** the plugin now keeps a continuous `LogService`
ring buffer from boot (survives `ClearOutput`, captures streamed playtest output),
so `get_output_log` returns instantly and complete instead of risking a 30 s
stall. **Run-mode introspection — fixed (v0.6.1):** `playtest_probe` runs
structured Luau inside a running Run-mode sim, and `playtest_input` drives the
character — the build→test→inspect loop closes for Run mode.
**Still open:** no tool can execute in a full Play Solo (F5) session's
server/client DataModel. Real fix = inject companion runtime agents (a
`Script`/`LocalScript` that open their own bridge channel during play) + a
`context` arg. Needs runtime testing — deferred.

### H3 · `insert_asset` free models &nbsp; 🛠️ Partially fixed
A 403 now returns an **actionable message** ("you don't own this asset — take it
via Toolbox → Add to Inventory, then retry") instead of a raw error, and the tool
description states the ownership rule. **v0.9.0:** `import_file` sidesteps the
wall entirely for the user's own content — local files upload to their account
(Open Cloud) and insert cleanly, since you always own what you upload.
**Still open:** a dedicated `insert_owned_asset` (browse/insert from the user's
existing inventory) — Roblox's `LoadAsset` fundamentally can't load unowned
assets, so inventory browse + take is the remaining path for marketplace items.

### H4 · `pull_place` overwrote uncommitted files &nbsp; ✅ Fixed (v0.2.0)
The data-loss bug. `pullPlace` now calls `snapshotIfDirty()` **before** writing —
any dirty mirror state is committed (`pre-pull snapshot (auto)`) so a re-pull is
always recoverable via `git log`/restore. Combined with v0.1.1 `baselineCommitIfEmpty`
and v0.1.2's loop-guard, the mirror no longer loses work silently. _(Verified by unit tests.)_

### H5 · `scan_backdoors` blind to installed plugins &nbsp; 🛠️ Partially fixed
The scanner's **source** detection was already strong (require-of-Value,
require-by-id, loadstring, HttpGet, getfenv, entropy blobs, attribute/Value
payloads). The gap was installed plugins (not in the DataModel — a Roblox limit).
New **`list_studio_plugins`** reads Studio's local plugin folders server-side and
lists what's installed, surfacing the remote-code-plugin vector (e.g. the UITools
plugin that bit this project). Reading a *compiled* installed plugin's source from
another plugin remains impossible in Roblox; documented in the tool.

### H6 · Main-thread starvation → false "plugin unresponsive" / disconnect &nbsp; ✅ Fixed (v0.6.1)
The real workflow blocker from the Chomolokko build: ~7 episodes of
`Plugin (place …) did not respond within 30000ms` / `No Studio place is connected`,
clustered around **heavy single ops** (an 8,000-part edit, large mass-sets) and a
**concurrent Play client**. v0.2.0's M6 fixed multi-session port disconnect — but
not this. Root cause: the plugin runs on Studio's **single main thread**. The poll
loop already `task.spawn`s each handler, but Luau `task.spawn` is cooperative, not
parallel — a handler that loops over thousands of instances **without yielding**
monopolizes the VM, so the loop's next `GET /poll` can't fire. The server then
(a) marks the session stale after 15s (`startHeartbeat`) → "No place connected",
and (b) rejects the in-flight command at the 30s `dispatchTo` timeout. One long
non-yielding op trips both; a running Play client starves the edit-mode plugin
further. Three-part fix:
- **Server — pending-aware heartbeat** (`sessions.ts`): a session with an in-flight
  command is *busy*, not dead — `alive = … || s.pending.size > 0`. Kills the false
  disconnect during any long op (including `run_luau`, which the plugin can't chunk).
- **Server — generous default command timeout** (`sessions.ts`): 30s → 90s
  (`DEFAULT_TIMEOUT_MS`), still per-call overridable. Legit heavy ops finish instead
  of erroring at 30s.
- **Plugin — yielding mass loops** (`Handlers/Properties.luau`, `Handlers/Instances.luau`):
  the internal mass handlers (`massSetProperty` / `massEdit` / `massCreate` /
  `massDuplicate` / `createTree` — surfaced today via the `mass_edit`, `batch`, and
  `create_tree` tools) now `task.wait()` every 250 items, so the poll loop breathes
  mid-batch and the session stays live.

  _Caller discipline still matters for `run_luau`_: arbitrary user code can't be
  auto-chunked — batch big edits (≤1,000) with a `task.wait()`/`RunService.Heartbeat:Wait()`
  between chunks, and don't run a Play client while building via MCP in edit mode.

---

## 🟡 Medium

### M6 · MCP connection instability &nbsp; ✅ Fixed (v0.2.0)
The `-32000` reconnect failure: a stale 0.1.0 server held port 58741, so every new
spawn died on `EADDRINUSE`. Now a new instance checks the holder — if it's a Tufan
bridge, it POSTs `/shutdown`, waits, and retries the bind; only a non-Tufan process
is left alone (clear message + exit). Reconnect self-heals, no manual kill.

### M7 · `pull_place` inconsistent / partial &nbsp; ✅ Fixed (v0.2.0)
Pull now counts what Studio reported vs what was written and logs a ⚠ mismatch
(with failed-write count) instead of trusting the mirror blindly. _Future: temp-dir
+ atomic swap for full transactional pulls._

### M8 · `search_objects` noisy substring &nbsp; ✅ Fixed (v0.2.0)
Added `matchMode` (`substring` default, `exact`, `wholeWord`, `regex`/Lua-pattern)
+ `caseSensitive`. Results cap at 200 with a `truncated` hint to narrow the query.

---

## 🟢 Minor

### m9 · `get_children` empty vs error &nbsp; ✅ Fixed (v0.2.0)
Now returns `(empty — node exists, 0 children)` vs `(could not resolve path)`.
_(`get_children` itself was merged into `get_tree`/`get_descendants` in v0.7.0;
the empty-vs-error distinction lives on in the tree tools.)_

### m10 · Nested-git footgun &nbsp; ✅ Fixed (v0.1.1)
`ensureMirrorIgnored()` auto-adds `projects/` to the parent repo's `.gitignore`.
_Future: option to place the mirror outside the user's repo entirely._

### m11 · "Unable to load plugin icon" &nbsp; ℹ️ Not our bug
Asset `118914904301383` is **not referenced anywhere in Tufan's source** (the
toolbar button uses no icon). That error belongs to another installed plugin.
_Polish todo: give Tufan a proper toolbar icon (currently none)._

### m12 · `audit.mjs` leaked temp on interrupt &nbsp; ✅ Fixed (v0.2.0)
The CRUD probe is wrapped in try/finally and cleans `TufanAudit*` on start and end.

### m13 · `git_log` raw error on empty repo &nbsp; ✅ Fixed (v0.2.0)
Returns `(no commits yet)` instead of the raw git error.

---

_Source: real usage during the Chomolokko Beach & Bars build, 2026-05 → 2026-06. Update as items land._
