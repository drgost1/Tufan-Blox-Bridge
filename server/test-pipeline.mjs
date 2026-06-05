// Keyless validation tests for the v0.11.0 asset pipeline (no Meshy key, no
// Open Cloud key, no Studio, no Blender spawn). Mirrors test-import.mjs.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function run(env, label, tool, args, expectSubstring) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, ...env },
    stderr: "ignore",
  });
  const client = new Client({ name: "pipeline-test", version: "0.0.1" });
  await client.connect(transport);
  const r = await client.callTool({ name: tool, arguments: args });
  const out = r.content?.[0]?.text ?? "(no text)";
  const pass = out.includes(expectSubstring);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) console.log(`  expected substring: ${expectSubstring}\n  got: ${out.slice(0, 300)}`);
  await client.close();
  return pass;
}

const NO_KEYS = { TUFAN_MESHY_KEY: "", TUFAN_OPENCLOUD_KEY: "" };
const FAKE_MESHY = { TUFAN_MESHY_KEY: "fake-key", TUFAN_MESHY_AUTOCONFIRM: "" };

let ok = true;
// --- key gates -------------------------------------------------------------
ok = (await run(NO_KEYS, "meshy_generate no key → setup help", "meshy_generate", { prompt: "a cube" }, "meshy.ai/settings/api")) && ok;
ok = (await run(NO_KEYS, "meshy_task no key → setup help", "meshy_task", { taskId: "xyz" }, "meshy.ai/settings/api")) && ok;
ok = (await run(NO_KEYS, "generate_asset no meshy key → setup help", "generate_asset", { prompt: "a cube" }, "meshy.ai/settings/api")) && ok;
ok = (await run({ ...FAKE_MESHY, TUFAN_OPENCLOUD_KEY: "" }, "generate_asset no OC key → OC setup help", "generate_asset", { prompt: "a cube" }, "create.roblox.com/dashboard/credentials")) && ok;
// --- input validation ------------------------------------------------------
ok = (await run(FAKE_MESHY, "meshy_generate prompt XOR image", "meshy_generate", {}, "exactly ONE")) && ok;
ok = (await run(FAKE_MESHY, "meshy_generate both prompt+imageUrl rejected", "meshy_generate", { prompt: "x", imageUrl: "https://x/y.png" }, "exactly ONE")) && ok;
// --- credit confirm gate (returns BEFORE any API call) ----------------------
ok = (await run(FAKE_MESHY, "meshy_generate unconfirmed → estimate", "meshy_generate", { prompt: "a tiki stool" }, "confirm: true")) && ok;
ok = (await run({ ...FAKE_MESHY, TUFAN_OPENCLOUD_KEY: "fake-oc" }, "generate_asset unconfirmed → estimate", "generate_asset", { prompt: "a tiki stool" }, "confirm: true")) && ok;
// --- blender input validation (no Blender spawn — file check is first) ------
ok = (await run({}, "blender_process missing input file", "blender_process", { inputFile: "C:/definitely-missing-xyz.glb", action: "inspect" }, "not found")) && ok;
ok = (await run({}, "blender_run missing input file", "blender_run", { script: "emit({})", inputFile: "C:/definitely-missing-xyz.glb" }, "not found")) && ok;

process.exit(ok ? 0 : 1);
