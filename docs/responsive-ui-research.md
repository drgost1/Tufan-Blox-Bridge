# Responsive UI — conversion research

Black-box study of **UI Tools v2.6.2** (purchased marketplace plugin) to learn the
exact Offset→Scale math, so Tufan can reproduce the capability as original code
(`make_responsive` + `scan_responsive`). We never read the plugin's source — only
observed input→output property values, which aren't anyone's IP.

- **Date:** 2026-05-27
- **Method:** a sandbox `ScreenGui` in the **UI MAKER** place (placeId 107284224874259),
  with six labeled fixtures, each carrying exactly one convertible property in Offset.
  Read each property, run UI Tools → Transform → *<property>* → **Scale**, read again, diff.
- **Plugin Transform dropdown exposes 6 properties:** Position, Size, CellSize,
  CanvasSize, Padding, CornerRadius. (This list is the real scope of "responsive" —
  not just Position/Size.)

## Why this matters

AI-built UIs break on other resolutions because the model thinks in **Offset** (pixels),
which is resolution-absolute. The fix is converting to **Scale** (resolution-relative).
Everyone converts Position/Size and stops — but **CellSize, CanvasSize, Padding, and
CornerRadius stay pixel-locked**, which is why even "responsive" AI UIs still break
(grid cells, scroll canvas, gaps, and corners don't scale).

## Results

Sandbox parent (`Panel`) `AbsoluteSize = 440 × 380`.

| Property | Before (Offset) | After (Scale) | Derived divisor | Status |
|---|---|---|---|---|
| Position | `{0,10},{0,10}` | `{0.0227,0},{0.0263,0}` | X ÷ 440, Y ÷ 380 | ✅ confirmed |
| Size | `{0,200},{0,110}` | `{0.4545,0},{0.2894,0}` | X ÷ 440, Y ÷ 380 | ✅ confirmed |
| CanvasSize | `{0,0},{0,300}` | `{0,0},{0.7895,0}` | Y ÷ 380 (parent, not self) | ✅ confirmed |
| CellSize | `{0,60},{0,40}` | `{0.30,0},{0.3636,0}` | 60÷200, 40÷110 | ✅ confirmed |
| Padding | `14` (all sides) | L/R `0.07`, T/B `0.1273` | 14÷200 (W), 14÷110 (H) | ✅ confirmed |
| CornerRadius | `18` | `0.1636` | 18 ÷ **110 = min(W,H)** | ✅ confirmed |
| CellPadding | `{0,6},{0,6}` | `{0,6},{0,6}` | — | ⚠️ plugin does NOT convert it (gap) |

## The formula

> **For each axis:  newScale = oldOffset ÷ Parent.AbsoluteSize[axis];  newOffset = 0**

- **Position / Size / CanvasSize / CellSize** (UDim2): X-axis ÷ parent width,
  Y-axis ÷ parent height. Reference is always the element's **parent** AbsoluteSize
  (CanvasSize confirmed using the parent's 380, not the ScrollingFrame's own size).
- **Padding** (UDim ×4): Left/Right ÷ parent width; Top/Bottom ÷ parent height.
- **CornerRadius** (UDim, single): ÷ **min(parent width, height)** — this matches how
  Roblox itself interprets a Scale corner radius (relative to the smaller dimension),
  so the look is preserved and scales correctly.

## Plugin behavior notes (what it does NOT do)

- **Pure Scale** — it zeroes the Offset; no hybrid `{scale, offset}` residual.
- **No `UIAspectRatioConstraint`** injected.
- **No `AnchorPoint`** changes (Anchor is a separate "Open Editor" sub-tool).
- **No `UISizeConstraint`** / min tap-target handling.
- It's a dumb-but-correct per-axis divide. No quadrant logic, no text handling.

## What Tufan's tools add beyond the plugin

`make_responsive` reproduces the 6-property conversion **and**:
- Adds `UIAspectRatioConstraint` where an element would otherwise stretch.
- Adds `UISizeConstraint` for 44×44 min tap targets (mobile-70% rule).
- **Skips runtime-driven elements** (draggable/resizable panels like the Grape phone):
  never force-scales a live-positioned element, which a dumb autoscaler would shatter.
- `dryRun` preview before writing.

`scan_responsive` (read-only audit) cross-references the GUI tree **and the scripts**:
flags Offset-locked properties, missing constraints, sub-44 tap targets, and
runtime pixel-positioning in code — while recognizing intentional draggable/resizable
UI (and instead auditing *its* logic: clamps to viewport? persists as Scale? min size?).

## Resolved

All six confirmed live (2026-05-27). The conversion property lives on the **modifier**
(`UIGridLayout`/`UIPadding`/`UICorner`), not the host frame — select the modifier to
convert CellSize/Padding/CornerRadius. CornerRadius confirmed as ÷ min-axis.

### Plugin gap to beat
- **CellPadding is left unconverted** (`UIGridLayout.CellPadding` stays Offset). Grid
  gaps therefore don't scale. `make_responsive` converts it too (÷ parent, per axis).

## Validation run (2026-05-27) — formula proven

Second pass with fresh, non-round values and a **taller-than-wide** corner box (to
test min-axis flips to width). Predicted every output, then ran the plugin. **All six
matched to 4 decimals:**

| # | Property | Predicted = Actual |
|---|---|---|
| 1 | Position (47,213)/520×360 | 0.0904, 0.5917 ✅ |
| 2 | Size (289,97)/520×360 | 0.5558, 0.2694 ✅ |
| 3 | CellSize (83,117)/240×140 | 0.3458, 0.8357 ✅ |
| 4 | CanvasSize (260,880)/520×360 | 0.5000, 2.4444 ✅ |
| 5 | Padding L11 R29 T19 B41 /180×130 | L.0611 R.1611 T.1462 B.3154 ✅ |
| 6 | CornerRadius 27 / min(90,170)=**90** | 0.3000 ✅ (min-axis = width, confirmed) |

The formula is exact, not approximate. Safe to build `make_responsive` on it.

## Reverse direction (Offset button) — Scale → Offset

The Transform section has two buttons: **Scale** and **Offset**. Offset is the inverse:

> **newOffset = Scale × Parent.AbsoluteSize[axis];  newScale = 0**  (round offset to int)

Verified by running Offset on the all-Scale fixtures from the validation run — every
one round-tripped back to its **exact original pixel value** (47, 213, 289, 97, 83, 117,
260, 880, 11/29/19/41, 27), scale zeroed. **Scale↔Offset is lossless.**

So Tufan owns the conversion both ways: design in pixels → ship in Scale → convert back
anytime with no drift. `make_responsive` exposes both directions (a `mode: scale|offset`).

## Properties editor — 3 higher-level ops (verified 2026-05-27)

Tested on fixtures in a 500×300 parent.

| Op | What it actually does | Gap we beat |
|---|---|---|
| **Fit Parent** | Sets `Size = {1,0},{1,0}` only | leaves Position + AnchorPoint untouched → not a true fit. Ours zeros Position + sets Anchor 0. |
| **Fast Scale with Relative Units** | Size→Scale **and** Position→Scale **+ adds `UIAspectRatioConstraint`** locked to the element's current aspect (150/90 → AR 1.667) | this is the full recipe — `make_responsive`'s default. |
| **Fast Scale with UIScale** | Keeps Offset, **adds a `UIScale` = 1.0** — **no driver script** | static 1.0 never updates → not actually responsive. Ours adds the UIScale **+ a resize driver** (`Scale = min(viewportX/refX, viewportY/refY)`). |

**Takeaways for the build:**
- `make_responsive` default = "Relative Units" behavior: Offset→Scale on Size+Position
  (per the proven formula) **plus** a `UIAspectRatioConstraint` at the current aspect.
- Offer a **UIScale mode** done right (UIScale + working resize driver) for pixel-perfect
  elements that should scale uniformly (good for fixed-aspect art / the draggable phone).
- Offer a **Fit Parent** that actually fits (Size 1,1 + Position 0 + Anchor 0).
