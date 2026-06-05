// Live-Studio E2E for the v0.12 post-insert finishing layer. NO API keys, NO
// credits: inserts the already-owned palm asset (uploaded in the v0.11 test),
// then drives the EXACT shipped finisher Luau (FINISH_BODY from dist) through
// the run_luau tool and verifies every op with property read-backs.
//
//   node finishing-e2e.mjs [placeId]   (default 77715802764272)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FINISH_BODY } from "./dist/finishing.js";
import { lua, PRELUDE } from "./dist/luauLiteral.js";

const PLACE = Number(process.argv[2] ?? 77715802764272);
const PALM_ASSET = 114914151264389;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "ignore",
});
const client = new Client({ name: "finishing-e2e", version: "0.0.1" });
await client.connect(transport);

async function call(tool, args) {
  const r = await client.callTool({ name: tool, arguments: { ...args, place: PLACE } });
  return { text: r.content?.[0]?.text ?? "", isError: Boolean(r.isError) };
}

let ok = true;
const check = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass || !detail ? "" : `\n  ${detail}`}`);
  ok = ok && pass;
};

// wait for the in-Studio plugin to bind
let bound = false;
for (let i = 0; i < 20 && !bound; i++) {
  const ping = await call("ping", {});
  bound = ping.text.includes("pong");
  if (!bound) await new Promise((r) => setTimeout(r, 2000));
}
if (!bound) {
  console.log("FAIL — no Studio place connected (open Studio with the Tufan plugin first)");
  process.exit(1);
}

// 1. insert the owned palm asset fresh
const ins = await call("insert_asset", { assetId: PALM_ASSET, parentPath: "Workspace" });
const insPath = (ins.text.match(/(Workspace[\w.]*)/) ?? [])[1];
check("insert owned palm asset", !ins.isError && Boolean(insPath), ins.text.slice(0, 200));
if (!insPath) process.exit(1);

// 2. run the EXACT shipped finisher Luau via run_luau
const P = lua({
  path: insPath,
  anchor: true,
  targetHeight: 28,
  collision: "Hull",
  rename: true,
  recolor: [
    { object: "Trunk", color: [0.36, 0.23, 0.12] },
    { object: "Fronds", color: [0.12, 0.42, 0.16] },
    { object: "Coconuts", color: [0.24, 0.14, 0.07] },
  ],
  attrs: { TufanPrompt: "finishing-e2e palm", TufanAssetId: String(PALM_ASSET), TufanGeneratedAt: "e2e" },
  onGround: true,
});
const fin = await call("run_luau", { code: `${PRELUDE}\nlocal P = ${P}\n${FINISH_BODY}` });
console.log(`--- finisher output ---\n${fin.text.slice(0, 600)}\n`);
check("finisher runs without error", !fin.isError && !fin.text.includes('"error"'), fin.text.slice(0, 300));
check("finisher renamed leaked datablock names", fin.text.includes("renamed"), fin.text.slice(0, 300));
check("finisher recolored parts", fin.text.includes("recolored"), "");
check("finisher scaled", fin.text.includes("scaled"), "");
check("finisher anchored parts", fin.text.includes("anchored"), "");
check("finisher grounded", fin.text.includes("grounded flush"), "");

// 3. ground truth via property read-backs
const finalPath = (fin.text.match(/"finalPath"\s*:\s*"([^"]+)"/) ?? [])[1] ?? insPath;
const trunk = await call("get_properties", { path: `${finalPath}.Trunk.Trunk`, names: ["Anchored", "Color", "CollisionFidelity", "Size"] });
check(
  "Trunk MeshPart renamed + anchored + Hull",
  !trunk.isError && trunk.text.includes("true") && trunk.text.includes("Hull"),
  trunk.text.slice(0, 300),
);
// height ≈ 28: read the model bounding box via run_luau
const bb = await call("run_luau", {
  code: `local m = ${JSON.stringify(finalPath)} local r = nil for seg in string.gmatch(m, "[^%.]+") do r = r and r:FindFirstChild(seg) or (seg ~= "Workspace" and workspace:FindFirstChild(seg) or workspace) end local _, s = r:GetBoundingBox() return s.Y`,
});
const height = Number((bb.text.match(/([\d.]+)/) ?? [])[1]);
check("model scaled to ~28 studs", Number.isFinite(height) && Math.abs(height - 28) < 1.5, `height=${height}`);
// attributes present
const attrs = await call("run_luau", {
  code: `local r = workspace:FindFirstChild(${JSON.stringify(finalPath.split(".").pop())}) return r and tostring(r:GetAttribute("TufanAssetId"))`,
});
check("attributes stamped", attrs.text.includes(String(PALM_ASSET)), attrs.text.slice(0, 200));

await client.close();
console.log(ok ? "\nALL PASS" : "\nFAILURES PRESENT");
process.exit(ok ? 0 : 1);
