// Dev smoke check: spawn the built server over stdio (as an MCP client would),
// list its tools, and probe the bridge liveness endpoint. No Studio needed.
// Run: node smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\nRegistered ${tools.length} tools:`);
for (const t of tools) console.log(`  - ${t.name}`);

// Bridge liveness
const res = await fetch("http://127.0.0.1:58741/");
console.log(`\nBridge GET / -> ${res.status} ${await res.text()}`);

await client.close();
process.exit(0);
