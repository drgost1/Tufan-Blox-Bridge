# Monthly refresh — `feat/refresh-fixes-20260627`

An ecosystem scan (other open-source Roblox Studio MCP/AI plugins) + a repo audit, turned into bug fixes, dead-code removal, and **6 new server-side tools**. Tool surface **81 → 87**.

Everything here is **compile-verified, code-reviewed, and the headline `encodeDeep` fix is VERIFIED LIVE in Studio** (`run_luau` arrays + `scene_state` both confirmed working). Released as **server v0.13.0 / plugin v0.9.0** — merged to `main` + GitHub release. npm publish stays paused per Nafis.

---

## 1. Bug fixes (`ced3e78`) — needs a plugin rebuild + live test

| Fix | What it repairs |
|---|---|
| **`encodeDeep` array corruption (root fix)** | The plugin serializer turned every Luau array into a `{"1":..,"2":..}` object. This **broke `scene_state` and `place_on` outright** and corrupted `run_luau` / `playtest_probe` / `pick` / `objects_in_region`. One fix repairs all six. |
| **`make_responsive` zero-size-parent SKIP** | Children of a zero-size UIScale wrapper were collapsed to `Scale 0` (the full-UI-collapse disaster). Now skipped with a note. Also: apply-mode report now shows real before/after. |
| **`get_tree` className filter** | Collapsed same-class runs now honor the `className` filter. |
| **`scan_perf` busy-loop check** | Now scoped to the loop body + requires a real yield call (was missing genuine frame-killers). |
| **`git_branch` / `git_remote` read-only** | Now usable in `TUFAN_READONLY` for their list (read) action; only the mutating sub-action is gated. |

## 2. Safe removals (`ced3e78`) — dead since v0.7.0

Dead plugin handlers (`getPlaytestOutput`, `getScriptTree`), broken `batch` aliases + `WRITE_OPS` entries, and stale doc/harness references. Doc counts unified.

## 3. New tools (all server-side — no plugin change, safe after `bun run build` + MCP restart)

| Tool | Commit | What it does | Needs |
|---|---|---|---|
| **`format_scripts`** | `e666e61` | StyLua over the script mirror (`check` = pre-commit diff gate). | `stylua` on PATH or `TUFAN_STYLUA_PATH` |
| **`lint_scripts`** | `e666e61` | Selene lint (unused vars, shadowing, deprecated APIs, footguns). | `selene` + a `selene.toml` (`std="roblox"`) |
| **`export_sourcemap`** | `d6812dd` | Rojo-style `sourcemap.json` from the mirror so luau-lsp resolves `require`s + gives IntelliSense. | nothing (pure FS walk) |
| **`typecheck`** | `36051d8` | `luau-lsp analyze` — type errors / undefined globals / bad requires before the code runs. | `luau-lsp` (Roblox defs auto-cached from the luau-lsp CDN; or `TUFAN_LUAU_DEFS`) |
| **`datastore`** | `cf8dcad` | Open Cloud DataStore (standard + ordered): list/get reads; gated set/delete/increment writes. **Read-first; writes warn about the ProfileStore session-lock.** | `TUFAN_OPENCLOUD_KEY` + `universe-datastores` scopes |
| **`cloud_luau`** | `6f5edf2` | Run server Luau against the **published** game (ephemeral server, real server context) → return values + logs. **DataStore/HTTP side effects persist.** | `TUFAN_OPENCLOUD_KEY` + `luau-execution-session` scope |

`format_scripts` + `lint_scripts` + `typecheck` + `export_sourcemap` = a **Luau verify trio + sourcemap**. `datastore` + `cloud_luau` = a **"verify against production"** pillar.

## 4. Needs your verification (the real bottleneck)

1. `cd server && bun run build` + restart the MCP → the 6 new server tools go live.
2. **Live-test the plugin branch:** rebuild the `.rbxm` (`scripts/build-plugin.ps1 -Install`), reload in Studio, confirm `scene_state` / `place_on` work and `run_luau` returns arrays as arrays. → then tag a release.
3. (Optional) install `stylua` / `selene` / `luau-lsp` to exercise the verify trio; add DataStore + luau-execution scopes to the Open Cloud key for `datastore` / `cloud_luau`.

## 5. Held items — RESOLVED (v0.13.0)

- **`get_descendants`** — KEPT. Functionally distinct from `get_tree` (which collapses same-class runs into `ClassName ×N`); removing a useful published tool for marginal tidiness isn't worth a breaking change.
- **`set_property` JSON-stringified value** — DONE (narrow-safe). `set_property` / `mass_edit` / `set_attribute` / `mass_set_attribute` / `search_by_property` now unwrap a string value ONLY when it parses to an object with a recognized tagged-type key (`Vector3`/`Color3`/…); plain strings pass through untouched, so literal string properties can't be corrupted.
- **`make_responsive` auto-exclude** — SKIPPED. The shipped zero-size SKIP is the safe fix; auto-excluding whole UIScale-wrapper subtrees is a speculative behavior change.

## 6. Deliberately deferred (need live test or reachability validation)

`serialize_to_code` (needs Roblox API-dump reflection), `scene_analysis` / `device_screenshots` (may be RobloxScriptSecurity-blocked), `export_instances` / `play_session` / multiplayer eval (plugin handlers + live playtest), and canned-Luau-into-Studio tools (terrain / csg / scatter — can't be verified without a live run). These are the next frontier once the branch is verified.
