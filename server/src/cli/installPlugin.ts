// `tufan-blox-bridge install-plugin` — copy the Studio plugin (.rbxm) into the local
// Roblox Studio Plugins folder. The npm package ships the plugin, so it always matches
// the server and needs no network; the GitHub release is only a fallback for dev builds.
// Standalone command: runs and exits BEFORE the MCP server starts (see src/index.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_NAME = "TufanBloxBridge.rbxm";
const RELEASES_PAGE = "https://github.com/drgost1/Tufan-Blox-Bridge/releases/latest";
// The direct link, not the GitHub API: the API allows 60 requests an hour per IP.
const DOWNLOAD_URL = `${RELEASES_PAGE}/download/${ASSET_NAME}`;
const BUNDLED_PLUGIN = fileURLToPath(new URL(`../../${ASSET_NAME}`, import.meta.url));

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

async function loadPlugin(): Promise<Buffer> {
  if (existsSync(BUNDLED_PLUGIN)) return readFileSync(BUNDLED_PLUGIN);
  console.log(`Downloading ${ASSET_NAME} from the latest release ...`);
  const res = await fetch(DOWNLOAD_URL, {
    headers: { "User-Agent": "tufan-blox-bridge-installer" },
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`suspiciously small download (${buf.length} bytes), refusing to install`);
  return buf;
}

export async function installPlugin(): Promise<number> {
  const target = pluginsDir();
  if (target.error) {
    console.error(target.error);
    return 1;
  }
  try {
    const buf = await loadPlugin();
    mkdirSync(target.dir!, { recursive: true });
    const dest = join(target.dir!, ASSET_NAME);
    writeFileSync(dest, buf);
    console.log(`  [ok] Installed ${ASSET_NAME} to ${dest} (${(buf.length / 1024).toFixed(0)} KB)`);
    return 0;
  } catch (e) {
    console.error(`Plugin install failed: ${(e as Error).message}\n${manualHint()}`);
    return 1;
  }
}
