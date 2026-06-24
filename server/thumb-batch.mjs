// Thumbnail a batch of local 3D files via the headless pipeline.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const files = process.argv.slice(2);
const t = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: process.env, stderr: "ignore" });
const c = new Client({ name: "thumbs", version: "0.0.1" });
await c.connect(t);
for (const f of files) {
  const r = await c.callTool({ name: "blender_process", arguments: { inputFile: f, action: "thumbnail" } }, undefined, { timeout: 300_000 });
  console.log(r.content?.find((x) => x.type === "text")?.text ?? "(failed)");
}
await c.close();
process.exit(0);
