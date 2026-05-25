import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFile } from "node:child_process";
import { errorText } from "../helpers.js";

// Roblox plugins have no pixel-read API (CaptureService returns an rbxtemp:// id
// whose bytes a plugin can't read). The bridge server runs on the same machine
// as Studio, so we capture the Studio window at the OS level instead — giving
// the AI real eyes on its work. Windows-only for now (the common case).

// PowerShell: capture ONLY the Roblox Studio window (no full-screen fallback),
// downscale to maxW, and write base64 PNG to stdout. If Studio isn't found we
// exit non-zero with a clear message rather than snapping the whole desktop.
function captureScript(maxW: number): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
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
$sw = $r.Rt - $r.L; $sh = $r.B - $r.T
if ($sw -lt 100 -or $sh -lt 100) { [Console]::Error.WriteLine('Roblox Studio window is minimized or off-screen — restore it and retry.'); exit 2 }
$full = New-Object System.Drawing.Bitmap $sw, $sh
$g = [System.Drawing.Graphics]::FromImage($full)
$g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size($sw, $sh)))
$scale = 1.0; if ($sw -gt ${maxW}) { $scale = ${maxW} / $sw }
$ow = [int]($sw * $scale); $oh = [int]($sh * $scale)
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
        "Capture a PNG screenshot of just the Roblox Studio window (server-side OS capture, tightly cropped to the window — not the full desktop). Errors if Studio isn't open/on-screen. Use this to visually verify UI/scene/VFX you just built. Windows-only.",
      inputSchema: {},
    },
    async () => {
      if (process.platform !== "win32") {
        return errorText("capture_screenshot is currently Windows-only (server-side OS capture).");
      }
      try {
        const b64 = await runPowerShell(captureScript(1280));
        if (!b64 || b64.length < 100) return errorText("Capture produced no image (is Studio open and on-screen?).");
        return { content: [{ type: "image", data: b64, mimeType: "image/png" }] };
      } catch (e) {
        return errorText(`capture_screenshot failed: ${(e as Error).message}`);
      }
    },
  );
}
