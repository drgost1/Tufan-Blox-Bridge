// Keyless smoke: spawn the built server over stdio, list tools, verify the new
// Open Cloud server-management tools exist with correct schemas, and confirm the
// key-missing error path fires without TUFAN_OPENCLOUD_KEY. Run: node smoke-serverlogs.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

delete process.env.TUFAN_OPENCLOUD_KEY; // force the keyless path

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  stderr: "inherit",
  env: { ...process.env },
});
const client = new Client({ name: "smoke-serverlogs", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\nRegistered ${tools.length} tools`);
const names = new Set(tools.map((t) => t.name));
for (const want of ["get_server_logs", "get_server_history"]) {
  console.log(`  ${want}: ${names.has(want) ? "PRESENT" : "MISSING!"}`);
  const t = tools.find((x) => x.name === want);
  if (t) console.log(`    schema props: ${Object.keys(t.inputSchema?.properties ?? {}).join(", ")}`);
}

// Keyless call → repo-standard setup-help error (isError, mentions TUFAN_OPENCLOUD_KEY)
for (const name of ["get_server_logs", "get_server_history"]) {
  const r = await client.callTool({ name, arguments: {} });
  const txt = r.content?.[0]?.text ?? "";
  const ok = r.isError === true && txt.includes("TUFAN_OPENCLOUD_KEY");
  console.log(`  call ${name} keyless → isError=${r.isError} mentions TUFAN_OPENCLOUD_KEY=${txt.includes("TUFAN_OPENCLOUD_KEY")} ${ok ? "OK" : "FAIL"}`);
  console.log(`    first line: ${txt.split("\n")[0]}`);
}

await client.close();
process.exit(0);
