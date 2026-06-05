// FULL pipeline E2E: prompt → Meshy preview (+thumbnail approve) → refine →
// Blender lint/fix → Open Cloud upload → insert → post-insert finishing.
// SPENDS ~30 MESHY CREDITS. Gated on BOTH keys; needs Studio + Tufan plugin.
//
//   TUFAN_MESHY_KEY=<key> TUFAN_OPENCLOUD_KEY=<key> node generate-e2e.mjs [placeId]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.TUFAN_MESHY_KEY?.trim() || !process.env.TUFAN_OPENCLOUD_KEY?.trim()) {
  console.log("SKIP — set TUFAN_MESHY_KEY and TUFAN_OPENCLOUD_KEY to run the full pipeline E2E");
  process.exit(0);
}
const PLACE = Number(process.argv[2] ?? 77715802764272);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "ignore",
});
const client = new Client({ name: "generate-e2e", version: "0.0.1" });
await client.connect(transport);

// SDK default request timeout is 60s — generate_asset legitimately runs for
// minutes (waitSeconds budget), so every call gets an explicit longer timeout.
async function callRaw(tool, args) {
  return client.callTool({ name: tool, arguments: { ...args, place: PLACE } }, undefined, { timeout: 330_000 });
}
process.on("unhandledRejection", (e) => {
  console.log(`UNHANDLED: ${e?.message ?? e}`);
  process.exit(1);
});
async function call(tool, args) {
  const r = await callRaw(tool, args);
  return { text: r.content?.find((c) => c.type === "text")?.text ?? "", isError: Boolean(r.isError), raw: r };
}

let ok = true;
const check = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass || !detail ? "" : `\n  ${detail}`}`);
  ok = ok && pass;
};

// Studio bind
let bound = false;
for (let i = 0; i < 20 && !bound; i++) {
  const ping = await call("ping", {});
  bound = ping.text.includes("pong");
  if (!bound) await new Promise((r) => setTimeout(r, 2000));
}
if (!bound) {
  console.log("FAIL — no Studio place connected");
  process.exit(1);
}

// 0. balance (free — validates the key + the new balance action)
{
  const r = await call("meshy_task", { action: "balance" });
  console.log(`balance: ${r.text}`);
  check("meshy balance reachable", !r.isError && /\d/.test(r.text), r.text.slice(0, 200));
}

const PROMPT = "a simple wooden tiki bar stool, low poly, game asset";
const FINISH = { name: "Tufan E2E Tiki Stool", parentPath: "Workspace", targetHeightStuds: 4, onGround: true, collisionFidelity: "Hull", waitSeconds: 300 };

// 1. previewFirst: geometry preview + rendered thumbnail (20cr).
//    E2E_RESUME_TASK env resumes an existing preview task (no new spend).
let taskId = process.env.E2E_RESUME_TASK?.trim() || undefined;
{
  let r = await callRaw(
    "generate_asset",
    taskId
      ? { meshyTaskId: taskId, previewFirst: true, waitSeconds: 300, place: PLACE }
      : { prompt: PROMPT, targetPolycount: 6000, previewFirst: true, confirm: true, waitSeconds: 300, place: PLACE },
  );
  let text = r.content?.find((c) => c.type === "text")?.text ?? "";
  let img = (r.content ?? []).find((c) => c.type === "image");
  let rounds = 0;
  // ready = thumbnail image present (or the no-Blender "Approve" fallback text)
  while (!r.isError && !img && !text.includes("Approve") && rounds < 8 && /meshyTaskId/.test(text)) {
    taskId = (text.match(/meshyTaskId:\s*"([^"]+)"/) ?? [])[1] ?? taskId;
    console.log(`  …preview still generating, resuming ${taskId} (round ${++rounds})`);
    r = await callRaw("generate_asset", { meshyTaskId: taskId, previewFirst: true, waitSeconds: 300, place: PLACE });
    text = r.content?.find((c) => c.type === "text")?.text ?? "";
    img = (r.content ?? []).find((c) => c.type === "image");
  }
  taskId = (text.match(/meshyTaskId:\s*"([^"]+)"/) ?? [])[1] ?? taskId;
  console.log(`--- preview stage ---\n${text.slice(0, 500)}\n`);
  check("previewFirst returns thumbnail image + resume token", !r.isError && Boolean(taskId) && Boolean(img) && (img?.data?.length ?? 0) > 4000, `taskId=${taskId} imgBytes=${img?.data?.length ?? 0}`);
}
if (!taskId) {
  console.log("cannot continue without a preview taskId");
  process.exit(1);
}

// 2. approve: refine (+10cr) → download → lint/fix → upload → insert → finishing
{
  let r = await call("generate_asset", { meshyTaskId: taskId, ...FINISH });
  let rounds = 0;
  while (!r.isError && !r.text.includes("assetId") && rounds < 8 && /meshyTaskId/.test(r.text)) {
    const resume = (r.text.match(/meshyTaskId:\s*"([^"]+)"/) ?? [])[1] ?? taskId;
    console.log(`  …refining, resuming ${resume} (round ${++rounds})`);
    r = await call("generate_asset", { meshyTaskId: resume, ...FINISH });
  }
  console.log(`--- final report ---\n${r.text}\n`);
  check("uploaded (assetId present)", !r.isError && r.text.includes("assetId"), r.text.slice(0, 300));
  check("inserted into place", r.text.includes("inserted"), "");
  check("lint stage ran", r.text.includes("lint:") || r.text.includes("lint skipped"), "");
  check("finishing ran (anchored/scaled/grounded)", r.text.includes("finished:"), "");
  check("credits reported", r.text.includes("credits="), "");
}

await client.close();
console.log(ok ? "\nALL PASS" : "\nFAILURES PRESENT");
process.exit(ok ? 0 : 1);
