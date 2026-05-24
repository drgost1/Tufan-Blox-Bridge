import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFile } from "node:child_process";
import { errorText } from "../helpers.js";

// Roblox plugins have no pixel-read API (CaptureService returns an rbxtemp:// id
// whose bytes a plugin can't read). The bridge server runs on the same machine
// as Studio, so we capture the Studio window at the OS level instead — giving
// the AI real eyes on its work. Windows-only for now (the common case).

// PowerShell: capture the Roblox Studio window (fallback: primary screen),
// downscale to maxW, and write base64 PNG to stdout.
function captureScript(maxW: number): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; } }
"@
$b = $null
$p = Get-Process RobloxStudioBeta -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  $r = New-Object W+R
  if ([W]::GetWindowRect($p.MainWindowHandle, [ref]$r)) {
    $w = $r.Rt - $r.L; $h = $r.B - $r.T
    if ($w -gt 100 -and $h -gt 100 -and $r.L -gt -30000) { $b = @($r.L, $r.T, $w, $h) }
  }
}
if (-not $b) { $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $b = @($s.X, $s.Y, $s.Width, $s.Height) }
$sw = $b[2]; $sh = $b[3]
$full = New-Object System.Drawing.Bitmap $sw, $sh
$g = [System.Drawing.Graphics]::FromImage($full)
$g.CopyFromScreen($b[0], $b[1], 0, 0, (New-Object System.Drawing.Size($sw, $sh)))
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
        "Capture a PNG screenshot of the Roblox Studio window (server-side OS capture; falls back to the primary screen if the Studio window isn't found). Use this to visually verify UI/scene/VFX you just built. Windows-only.",
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
