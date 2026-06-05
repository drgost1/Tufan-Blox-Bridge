// Live Meshy E2E — SPENDS REAL CREDITS (~30 ≈ $0.60). Gated on TUFAN_MESHY_KEY.
// Verifies: credit gate bypass via confirm, the budget/resume-token contract,
// full preview→refine chain, and the downloaded GLB landing on disk.
//
//   TUFAN_MESHY_KEY=<key> node meshy-e2e.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";

if (!process.env.TUFAN_MESHY_KEY?.trim()) {
  console.log("SKIP — set TUFAN_MESHY_KEY to run the live Meshy E2E (spends ~30 credits)");
  process.exit(0);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "ignore",
});
const client = new Client({ name: "meshy-e2e", version: "0.0.1" });
await client.connect(transport);

async function call(args) {
  // SDK default request timeout is 60s — generation polls run longer.
  const r = await client.callTool({ name: "meshy_generate", arguments: args }, undefined, { timeout: 330_000 });
  return { text: r.content?.[0]?.text ?? "", isError: Boolean(r.isError) };
}
process.on("unhandledRejection", (e) => {
  console.log(`UNHANDLED: ${e?.message ?? e}`);
  process.exit(1);
});

let ok = true;
const check = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass || !detail ? "" : `\n  ${detail}`}`);
  ok = ok && pass;
};

// 1. Short budget → must come back fast with EITHER a resume token or (unlikely) completion.
let r = await call({ prompt: "a simple wooden tiki bar stool, low poly", targetPolycount: 18000, confirm: true, waitSeconds: 15 });
const gotResume = r.text.includes("Resume with") && r.text.includes("taskId");
const gotDone = r.text.includes("GLB:");
check("short budget → resume token or done", !r.isError && (gotResume || gotDone), r.text.slice(0, 300));

// 2. Resume loop until done (covers preview→refine chaining across calls).
let taskId = (r.text.match(/taskId:\s*"([^"]+)"/) ?? [])[1];
let rounds = 0;
while (!r.text.includes("GLB:") && !r.isError && taskId && rounds < 10) {
  rounds++;
  console.log(`  …resuming ${taskId} (round ${rounds})`);
  r = await call({ taskId, waitSeconds: 120 });
  taskId = (r.text.match(/taskId:\s*"([^"]+)"/) ?? [])[1] ?? taskId;
}
check("resume loop reaches downloaded GLB", !r.isError && r.text.includes("GLB:"), r.text.slice(0, 400));

// 3. The GLB actually exists on disk.
const glbPath = (r.text.match(/GLB:\s*(.+)/) ?? [])[1]?.trim();
check("GLB file exists on disk", Boolean(glbPath) && existsSync(glbPath), `path=${glbPath}`);
console.log(`\nGenerated file: ${glbPath}`);
console.log("Tip: blender_process({ inputFile, action: 'inspect' }) next, or import_file to upload.");

await client.close();
process.exit(ok ? 0 : 1);
