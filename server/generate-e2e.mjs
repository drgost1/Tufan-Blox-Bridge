// FULL pipeline E2E: prompt → Meshy → Blender lint/fix → Open Cloud upload →
// insert into the open place. SPENDS ~30 MESHY CREDITS + uses the Open Cloud
// quota. Gated on BOTH keys; needs Studio open with the Tufan plugin connected.
//
//   TUFAN_MESHY_KEY=<key> TUFAN_OPENCLOUD_KEY=<key> node generate-e2e.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.TUFAN_MESHY_KEY?.trim() || !process.env.TUFAN_OPENCLOUD_KEY?.trim()) {
  console.log("SKIP — set TUFAN_MESHY_KEY and TUFAN_OPENCLOUD_KEY to run the full pipeline E2E");
  process.exit(0);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "ignore",
});
const client = new Client({ name: "generate-e2e", version: "0.0.1" });
await client.connect(transport);

// Wait for the in-Studio plugin to bind (same pattern as e2e-import.mjs).
let bound = false;
for (let i = 0; i < 30 && !bound; i++) {
  const ping = await client.callTool({ name: "ping", arguments: {} });
  bound = (ping.content?.[0]?.text ?? "").includes("pong");
  if (!bound) await new Promise((r) => setTimeout(r, 2000));
}
if (!bound) {
  console.log("FAIL — no Studio place connected (open Studio with the Tufan plugin first)");
  process.exit(1);
}

async function call(args) {
  const r = await client.callTool({ name: "generate_asset", arguments: args });
  return { text: r.content?.[0]?.text ?? "", isError: Boolean(r.isError) };
}

const base = { name: "Tufan E2E Tiki Stool", parentPath: "Workspace", waitSeconds: 240 };
let r = await call({ ...base, prompt: "a simple wooden tiki bar stool, low poly, game asset", confirm: true });
console.log(`--- round 0 ---\n${r.text}\n`);

// Resume across budget exhaustions.
let rounds = 0;
let meshyTaskId = (r.text.match(/meshyTaskId:\s*"([^"]+)"/) ?? [])[1];
while (!r.isError && meshyTaskId && !r.text.includes("assetId") && rounds < 10) {
  rounds++;
  r = await call({ ...base, meshyTaskId });
  console.log(`--- round ${rounds} ---\n${r.text}\n`);
  meshyTaskId = (r.text.match(/meshyTaskId:\s*"([^"]+)"/) ?? [])[1] ?? meshyTaskId;
}

const pass =
  !r.isError &&
  r.text.includes("assetId") &&            // uploaded
  r.text.includes("inserted") &&           // in the place
  (r.text.includes("lint:") || r.text.includes("lint skipped")); // lint stage ran/reported
console.log(pass ? "PASS — full pipeline: prompt → mesh → lint → upload → inserted" : "FAIL — see output above");
await client.close();
process.exit(pass ? 0 : 1);
