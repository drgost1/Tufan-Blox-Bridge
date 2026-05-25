import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFile } from "node:child_process";
import { errorText, placeArg } from "../helpers.js";
import { dispatchTo, resolveTargetPlace } from "../../bridge/sessions.js";

// Roblox plugins have no pixel-read API (CaptureService returns an rbxtemp:// id
// whose bytes a plugin can't read). The bridge server runs on the same machine
// as Studio, so we capture the Studio window at the OS level instead — giving
// the AI real eyes on its work. Windows-only for now (the common case).

// Ask the plugin for the 3D editor viewport size (logical px). Roblox exposes
// no API for the viewport's *screen position*, only its size — so we use the
// size to crop the captured window, anchored to the default layout (ribbon on
// top, Explorer/Properties docked right => viewport flush to the bottom-left).
async function getViewportSize(place?: string | number): Promise<{ w: number; h: number } | null> {
  const target = resolveTargetPlace(place);
  if (target.error || target.placeId == null) return null;
  try {
    const r: any = await dispatchTo(target.placeId, "runLuau", {
      code:
        "local c = workspace.CurrentCamera; if not c then return '0x0' end; " +
        "return math.floor(c.ViewportSize.X)..'x'..math.floor(c.ViewportSize.Y)",
    });
    const s = r?.result == null ? "" : String(r.result);
    const m = s.match(/(\d+)x(\d+)/);
    if (!m) return null;
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (w < 50 || h < 50) return null;
    return { w, h };
  } catch {
    return null;
  }
}

// PowerShell: capture the Roblox Studio window (no full-screen fallback). If a
// viewport size is given, crop to just the 3D viewport (bottom-left anchored,
// DPI-scaled); otherwise capture the whole window. Downscale to maxW, write
// base64 PNG to stdout. Exits non-zero with a clear message if Studio isn't found.
function captureScript(maxW: number, vp?: { w: number; h: number }): string {
  const vpW = vp ? vp.w : 0;
  const vpH = vp ? vp.h : 0;
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out R r, int s);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
}
"@
# True visible bounds: DWMWA_EXTENDED_FRAME_BOUNDS (9) excludes the invisible
# resize border Windows adds; fall back to GetWindowRect if DWM is unavailable.
function Get-Bounds($h) {
  $r = New-Object W+R
  $ok = $false
  try { if ([W]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -eq 0) { $ok = $true } } catch {}
  if (-not $ok) { [void][W]::GetWindowRect($h, [ref]$r) }
  return $r
}
# Match the Studio process by name (RobloxStudio / RobloxStudioBeta) or window title.
$p = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like 'RobloxStudio*' -or $_.MainWindowTitle -like '*Roblox Studio*') } |
  Select-Object -First 1
if (-not $p) { [Console]::Error.WriteLine('Roblox Studio window not found — open Studio and bring it on-screen.'); exit 2 }
$r = Get-Bounds $p.MainWindowHandle
$winL = $r.L; $winT = $r.T; $winW = $r.Rt - $r.L; $winH = $r.B - $r.T
if ($winW -lt 100 -or $winH -lt 100) { [Console]::Error.WriteLine('Roblox Studio window is minimized or off-screen — restore it and retry.'); exit 2 }
# Default region: the whole window.
$cx = $winL; $cy = $winT; $cw = $winW; $ch = $winH
$vpW = ${vpW}; $vpH = ${vpH}
if ($vpW -gt 0 -and $vpH -gt 0) {
  $dpi = 96
  try { $d = [W]::GetDpiForWindow($p.MainWindowHandle); if ($d -ge 48) { $dpi = $d } } catch {}
  $scale = $dpi / 96.0
  $pw = [int][math]::Round($vpW * $scale); $ph = [int][math]::Round($vpH * $scale)
  # If scaled size overflows the window, assume ViewportSize was already physical.
  if ($pw -gt $winW -or $ph -gt $winH) { $pw = $vpW; $ph = $vpH }
  if ($pw -gt $winW) { $pw = $winW }
  if ($ph -gt $winH) { $ph = $winH }
  # Bottom-left anchor (ribbon on top, panels docked right in the default layout).
  $cx = $winL; $cy = $winT + $winH - $ph; $cw = $pw; $ch = $ph
}
$full = New-Object System.Drawing.Bitmap $cw, $ch
$g = [System.Drawing.Graphics]::FromImage($full)
$g.CopyFromScreen($cx, $cy, 0, 0, (New-Object System.Drawing.Size($cw, $ch)))
$scaleOut = 1.0; if ($cw -gt ${maxW}) { $scaleOut = ${maxW} / $cw }
$ow = [int]($cw * $scaleOut); $oh = [int]($ch * $scaleOut)
$out = New-Object System.Drawing.Bitmap $ow, $oh
$g2 = [System.Drawing.Graphics]::FromImage($out)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($full, 0, 0, $ow, $oh)
$ms = New-Object System.IO.MemoryStream
$out.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
$g.Dispose(); $g2.Dispose(); $full.Dispose(); $out.Dispose(); $ms.Dispose()
`.trim();
}

function runPowerShell(script: string): Promise<string> {
  // -EncodedCommand (UTF16-LE base64) avoids all quoting/escaping headaches.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 20_000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr?.trim() || err.message));
        resolve((stdout || "").trim());
      },
    );
  });
}

export function registerCaptureTools(server: McpServer) {
  server.registerTool(
    "capture_screenshot",
    {
      description:
        "Capture a PNG screenshot of the Roblox Studio 3D viewport only — cropped to the editor viewport, excluding the ribbon and docked panels (assumes the default layout: ribbon on top, Explorer/Properties docked right). Pass fullWindow:true to capture the entire Studio window instead. Server-side OS capture; errors if Studio isn't open/on-screen. Use this to visually verify UI/scene/VFX you just built. Windows-only.",
      inputSchema: {
        place: placeArg,
        fullWindow: z
          .boolean()
          .optional()
          .describe("Capture the whole Studio window instead of just the 3D viewport (default false)."),
      },
    },
    async ({ place, fullWindow }) => {
      if (process.platform !== "win32") {
        return errorText("capture_screenshot is currently Windows-only (server-side OS capture).");
      }
      try {
        const vp = fullWindow ? null : await getViewportSize(place);
        const b64 = await runPowerShell(captureScript(1280, vp ?? undefined));
        if (!b64 || b64.length < 100) return errorText("Capture produced no image (is Studio open and on-screen?).");
        const content: any[] = [];
        if (!fullWindow && !vp) {
          content.push({
            type: "text",
            text: "(viewport size unavailable — captured the whole Studio window; connect a place or pass fullWindow:true)",
          });
        }
        content.push({ type: "image", data: b64, mimeType: "image/png" });
        return { content };
      } catch (e) {
        return errorText(`capture_screenshot failed: ${(e as Error).message}`);
      }
    },
  );
}
