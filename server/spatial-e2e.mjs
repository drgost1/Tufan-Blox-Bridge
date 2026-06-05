// E2E for the spatial tools against a live connected place.
// Usage: node spatial-e2e.mjs <placeId>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const place = process.argv[2] ? (isNaN(Number(process.argv[2])) ? process.argv[2] : Number(process.argv[2])) : undefined;
const t = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env }, stderr: "ignore" });
const c = new Client({ name: "spatial-e2e", version: "1.0.0" });
await c.connect(t);

const txt = (r) => r.content?.map((b) => b.text).filter(Boolean).join("\n") ?? "(no text)";
const call = async (name, args) => {
  const r = await c.callTool({ name, arguments: { ...args, place } });
  return { err: !!r.isError, out: txt(r) };
};

// wait for the place to be reachable
for (let i = 0; i < 12; i++) {
  const p = await call("ping", {});
  if (p.out.startsWith("pong")) { console.log(p.out); break; }
  await new Promise((r) => setTimeout(r, 2000));
}

console.log("\n=== scene_state (maxObjects 8) ===");
console.log((await call("scene_state", { maxObjects: 8, onScreenOnly: false })).out.slice(0, 1600));

console.log("\n=== pick (viewport center) ===");
console.log((await call("pick", {})).out);

console.log("\n=== objects_in_region around KitsuneLogoDisplay (radius via around+pad) ===");
console.log((await call("objects_in_region", { around: "Workspace.KitsuneLogoDisplay", pad: 30, maxParts: 10 })).out.slice(0, 1200));

console.log("\n=== place_on dryRun (drop KitsuneLogoDisplay onto ground) ===");
console.log((await call("place_on", { path: "Workspace.KitsuneLogoDisplay", ground: true, dryRun: true })).out);

await c.close();
process.exit(0);
