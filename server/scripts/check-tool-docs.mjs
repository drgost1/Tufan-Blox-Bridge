// Release gate for tool definitions: starts the built server over stdio, reads
// tools/list, and fails if any tool lacks annotations or a usable description,
// or if any input property has no description.
// Usage (after `npm run build`): node scripts/check-tool-docs.mjs [--dump out.json]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const dumpIndex = process.argv.indexOf("--dump");
const dumpPath = dumpIndex > -1 ? process.argv[dumpIndex + 1] : null;

const child = spawn(process.execPath, [join(serverDir, "dist", "index.js")], {
  cwd: serverDir,
  env: { ...process.env, TUFAN_PROJECT: serverDir },
  stdio: ["pipe", "pipe", "ignore"],
});

const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const timer = setTimeout(() => {
  console.error("timed out waiting for tools/list");
  child.kill();
  process.exit(2);
}, 30_000);

let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === 1) {
      send({ method: "notifications/initialized" });
      send({ id: 2, method: "tools/list" });
    } else if (message.id === 2) {
      clearTimeout(timer);
      child.kill();
      report(message.result.tools);
    }
  }
});

send({
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-tool-docs", version: "1" } },
});

function report(tools) {
  if (dumpPath) writeFileSync(dumpPath, JSON.stringify(tools, null, 1));
  const problems = [];
  for (const tool of tools) {
    const annotations = tool.annotations ?? {};
    if (typeof annotations.readOnlyHint !== "boolean") problems.push(`${tool.name}: no readOnlyHint annotation`);
    if (!annotations.title) problems.push(`${tool.name}: no title annotation`);
    if ((tool.description ?? "").length < 80) problems.push(`${tool.name}: description under 80 characters`);
    for (const [name, schema] of Object.entries(tool.inputSchema?.properties ?? {})) {
      if (!schema.description) problems.push(`${tool.name}.${name}: no description`);
    }
  }
  console.log(`${tools.length} tools checked`);
  if (problems.length) {
    console.log(problems.join("\n"));
    console.log(`${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log("all tools have annotations, descriptions and described parameters");
}
