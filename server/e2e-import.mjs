// E2E harness for import_file against the REAL Open Cloud API + live Studio.
// Reads the key from TUFAN_OPENCLOUD_KEY in the parent env — no secrets in this file.
// Usage: node e2e-import.mjs <filePath> [assetType] [parentPath]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [, , filePath, assetType, parentPath, place] = process.argv;
if (!filePath) {
  console.error("usage: node e2e-import.mjs <filePath> [assetType] [parentPath]");
  process.exit(2);
}
if (!process.env.TUFAN_OPENCLOUD_KEY) {
  console.error("TUFAN_OPENCLOUD_KEY not set in env");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "e2e-import", version: "0.0.1" });
await client.connect(transport);

// wait for the bridge/proxy to see the Studio place
let connected = false;
for (let i = 0; i < 10; i++) {
  const r = await client.callTool({ name: "ping", arguments: {} });
  const t = r.content?.[0]?.text ?? "";
  if (t.startsWith("pong")) { console.log(t); connected = true; break; }
  await new Promise((r2) => setTimeout(r2, 2000));
}
if (!connected) console.log("(no Studio connection — upload will still run, insert will be skipped)");

const args = { filePath, waitSeconds: 90 };
if (assetType) args.assetType = assetType;
if (parentPath) args.parentPath = parentPath;
if (place) args.place = isNaN(Number(place)) ? place : Number(place);
console.log(`\ncalling import_file(${JSON.stringify(args)})...`);
const started = Date.now();
const res = await client.callTool({ name: "import_file", arguments: args });
console.log(`\n--- result (${((Date.now() - started) / 1000).toFixed(1)}s${res.isError ? ", ERROR" : ""}) ---`);
console.log(res.content?.[0]?.text ?? "(no text)");
await client.close();
process.exit(res.isError ? 1 : 0);
