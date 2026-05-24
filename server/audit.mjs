// Capability audit: spawn the server, wait for the live Studio plugin to
// connect, then drive real tool calls and report pass/fail per capability.
// Run: node audit.mjs   (kill any other server on 58741 first)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env, TUFAN_PROJECT: "C:\\Users\\drgos_5ax3dfg\\roblox" },
  stderr: "inherit",
});
const client = new Client({ name: "audit", version: "1.0.0" });
await client.connect(transport);

async function call(name, args = {}) {
  try {
    const r = await client.callTool({ name, arguments: args });
    const txt = (r.content ?? []).map((c) => c.text ?? `[${c.type}]`).join("\n");
    return { ok: !r.isError, txt };
  } catch (e) {
    return { ok: false, txt: String(e.message ?? e) };
  }
}

// Wait for the plugin to connect (retry ping).
console.log("\nWaiting for Studio plugin to connect...");
let connected = false;
for (let i = 0; i < 20; i++) {
  const r = await call("ping");
  if (r.ok && !/did not respond/.test(r.txt)) {
    console.log("PING ok:", r.txt);
    connected = true;
    break;
  }
  await new Promise((s) => setTimeout(s, 2000));
}
if (!connected) {
  console.log("\n❌ Plugin never connected. Is Studio open with the Tufan plugin?");
  await client.close();
  process.exit(1);
}

const tests = [
  ["list_places", {}],
  ["get_services", {}],
  ["get_descendants", { path: "ReplicatedStorage", maxDepth: 1 }],
  ["get_script_tree", {}],
  ["run_luau", { code: "return 2 + 2" }],
  ["run_luau", { code: 'print("hello from audit"); return game.PlaceId' }],
  ["get_output_log", { maxEntries: 5 }],
  ["create_instance", { className: "Folder", parentPath: "ReplicatedStorage", name: "TufanAuditTemp" }],
  ["set_property", { path: "ReplicatedStorage.TufanAuditTemp", name: "Name", value: "TufanAuditRenamed" }],
  ["get_properties", { path: "ReplicatedStorage.TufanAuditRenamed", names: ["Name", "ClassName"] }],
  ["search_objects", { rootPath: "ReplicatedStorage", name: "TufanAudit" }],
  ["delete_instance", { path: "ReplicatedStorage.TufanAuditRenamed" }],
  ["git_status", {}],
  ["git_log", { count: 3 }],
];

let pass = 0, fail = 0;
for (const [name, args] of tests) {
  const r = await call(name, args);
  if (r.ok) pass++; else fail++;
  console.log(`\n## ${name} -> ${r.ok ? "OK" : "FAIL"}`);
  console.log(r.txt.slice(0, 400));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await client.close();
process.exit(0);
