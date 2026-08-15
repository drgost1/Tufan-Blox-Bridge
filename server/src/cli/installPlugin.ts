// `tufan-blox-bridge install-plugin` — download the Studio plugin (.rbxm) from the
// LATEST GitHub release of drgost1/Tufan-Blox-Bridge and drop it into the local
// Roblox Studio Plugins folder. Public repo → no auth. Standalone command: runs
// and exits BEFORE the MCP server starts (see src/index.ts).

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RELEASE_API = "https://api.github.com/repos/drgost1/Tufan-Blox-Bridge/releases/latest";
const ASSET_NAME = "TufanBloxBridge.rbxm";
const RELEASES_PAGE = "https://github.com/drgost1/Tufan-Blox-Bridge/releases/latest";

function pluginsDir(): { dir?: string; error?: string } {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return { dir: join(local, "Roblox", "Plugins") };
  }
  if (process.platform === "darwin") {
    return { dir: join(homedir(), "Documents", "Roblox", "Plugins") };
  }
  return {
    error:
      `No known Roblox Studio Plugins path for ${process.platform}. Download ${ASSET_NAME} manually from\n` +
      `  ${RELEASES_PAGE}\n` +
      `and drop it into Studio's Plugins folder (Studio → Plugins tab → Plugins Folder button).`,
  };
}

function manualHint(): string {
  return `Manual fallback: download ${ASSET_NAME} from\n  ${RELEASES_PAGE}\nand copy it into your Studio Plugins folder, then restart Studio.`;
}

export async function installPlugin(): Promise<number> {
  const target = pluginsDir();
  if (target.error) {
    console.error(target.error);
    return 1;
  }
  console.log(`Plugins folder: ${target.dir}`);
  console.log(`Fetching latest release info from ${RELEASE_API} ...`);

  let downloadUrl: string | undefined;
  let tag = "";
  try {
    const res = await fetch(RELEASE_API, {
      headers: { "User-Agent": "tufan-blox-bridge-installer", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    const rel: any = await res.json();
    tag = rel?.tag_name ?? "";
    const asset = (rel?.assets ?? []).find((a: any) => a?.name === ASSET_NAME);
    downloadUrl = asset?.browser_download_url;
    if (!downloadUrl) throw new Error(`release ${tag || "(untagged)"} has no ${ASSET_NAME} asset`);
  } catch (e) {
    console.error(`Couldn't resolve the latest release: ${(e as Error).message}\n${manualHint()}`);
    return 1;
  }

  console.log(`Downloading ${ASSET_NAME} (${tag}) ...`);
  try {
    const res = await fetch(downloadUrl, {
      headers: { "User-Agent": "tufan-blox-bridge-installer" },
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error(`suspiciously small download (${buf.length} bytes) — refusing to install`);
    mkdirSync(target.dir!, { recursive: true });
    const dest = join(target.dir!, ASSET_NAME);
    writeFileSync(dest, buf);
    console.log(`✓ Installed ${ASSET_NAME} ${tag} → ${dest} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.error(`Download/install failed: ${(e as Error).message}\n${manualHint()}`);
    return 1;
  }

  console.log(
    `\nNext steps:\n` +
      `  1. Restart Roblox Studio (fully close it first) — the Tufan Blox Bridge plugin appears in the Plugins tab.\n` +
      `  2. Open a place and make sure Game Settings → Security → "Allow HTTP Requests" is ON.\n` +
      `  3. Connect your MCP client to the tufan-blox-bridge server and run the "ping" tool.`,
  );
  return 0;
}
