// Meshy prop queue for the bathhouse — preview-gated batch generation.
//   node meshy-queue.mjs preview          -> start/resume previews, save thumbnails + state
//   node meshy-queue.mjs refine k1,k2,... -> texture+upload+insert the approved keys
// State: ./meshy-queue-state.json ; thumbnails: ./meshy-queue/<key>.png
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const PROPS = {
  plant: {
    prompt: "potted tropical monstera plant in a round white ceramic pot, large green split leaves, slim curved stems, realistic, game asset",
    poly: 6000, height: 7, name: "MeshPlant",
  },
  pothos: {
    prompt: "small hanging pothos plant with trailing green vines spilling over a woven rattan basket pot, realistic, game asset",
    poly: 5000, height: 3.5, name: "MeshPothos",
  },
  strawbag: {
    prompt: "round flat woven straw beach bag with two short rope handles, circular rattan handbag, natural fiber, realistic",
    poly: 4000, height: 2.2, name: "MeshStrawBag",
  },
  sconce: {
    prompt: "simple solid drum lamp shade wrapped in tight rattan weave, smooth closed cylinder shape, clean silhouette, no holes, realistic, game asset",
    poly: 3000, height: 2.0, name: "MeshSconce",
  },
  basket: {
    prompt: "round open wicker storage basket with a rolled rim, natural rattan weave, realistic, game asset",
    poly: 3000, height: 1.5, name: "MeshBasket",
  },
  hamper: {
    prompt: "tall round wicker laundry hamper with a flat lid, natural woven rattan, slightly tapered, realistic, game asset",
    poly: 4000, height: 2.6, name: "MeshHamper",
  },
};

const STATE_FILE = "meshy-queue-state.json";
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8").replace(/^﻿/, "")) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
mkdirSync("meshy-queue", { recursive: true });

const t = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: process.env, stderr: "ignore" });
const c = new Client({ name: "meshy-queue", version: "0.0.1" });
await c.connect(t);
process.on("unhandledRejection", (e) => { console.log(`UNHANDLED: ${e?.message ?? e}`); process.exit(1); });

async function call(args) {
  return c.callTool({ name: "generate_asset", arguments: args }, undefined, { timeout: 340_000 });
}
const textOf = (r) => r.content?.find((x) => x.type === "text")?.text ?? "";
const imgOf = (r) => r.content?.find((x) => x.type === "image");

const mode = process.argv[2] ?? "preview";

if (mode === "preview") {
  for (const [key, p] of Object.entries(PROPS)) {
    state[key] = state[key] ?? {};
    if (state[key].previewDone) { console.log(`${key}: preview already done`); continue; }
    console.log(`=== ${key}: preview ===`);
    let r = state[key].taskId
      ? await call({ meshyTaskId: state[key].taskId, previewFirst: true, waitSeconds: 300 })
      : await call({ prompt: p.prompt, targetPolycount: p.poly, previewFirst: true, confirm: true, waitSeconds: 300 });
    let text = textOf(r), img = imgOf(r), guard = 0;
    while (!r.isError && !img && /meshyTaskId/.test(text) && guard++ < 8) {
      state[key].taskId = (text.match(/meshyTaskId:\s*"([^"]+)"/) ?? [])[1] ?? state[key].taskId;
      save();
      console.log(`${key}: still generating (${state[key].taskId})`);
      r = await call({ meshyTaskId: state[key].taskId, previewFirst: true, waitSeconds: 300 });
      text = textOf(r); img = imgOf(r);
    }
    state[key].taskId = (text.match(/meshyTaskId:\s*"([^"]+)"/) ?? [])[1] ?? state[key].taskId;
    if (img) {
      writeFileSync(`meshy-queue/${key}.png`, Buffer.from(img.data, "base64"));
      state[key].previewDone = true;
      console.log(`${key}: PREVIEW READY -> meshy-queue/${key}.png (task ${state[key].taskId})`);
    } else {
      console.log(`${key}: NO IMAGE — ${text.slice(0, 200)}`);
    }
    save();
  }
} else if (mode === "refine") {
  const keys = (process.argv[3] ?? "").split(",").filter(Boolean);
  for (const key of keys) {
    const p = PROPS[key];
    const st = state[key];
    if (!p || !st?.taskId) { console.log(`${key}: no task — skip`); continue; }
    if (st.assetId) { console.log(`${key}: already uploaded ${st.assetId}`); continue; }
    console.log(`=== ${key}: refine + upload + insert ===`);
    let r = await call({ meshyTaskId: st.taskId, name: p.name, targetHeightStuds: p.height, anchor: true, parentPath: "Workspace", waitSeconds: 300, place: 77715802764272 });
    let text = textOf(r), guard = 0;
    while (!r.isError && !text.includes("assetId") && /meshyTaskId/.test(text) && guard++ < 8) {
      const resume = (text.match(/meshyTaskId:\s*"([^"]+)"/) ?? [])[1] ?? st.taskId;
      console.log(`${key}: refining (${resume})`);
      r = await call({ meshyTaskId: resume, name: p.name, targetHeightStuds: p.height, anchor: true, parentPath: "Workspace", waitSeconds: 300, place: 77715802764272 });
      text = textOf(r);
    }
    st.assetId = (text.match(/assetId (\d+)/) ?? [])[1];
    st.report = text.slice(0, 600);
    console.log(`${key}: ${st.assetId ? "DONE assetId " + st.assetId : "FAILED"}\n${text.slice(0, 300)}`);
    save();
  }
}
await c.close();
console.log("queue pass complete");
process.exit(0);
