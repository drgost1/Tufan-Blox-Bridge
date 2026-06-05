// Throwaway validation-path test for import_file (no Studio / no real key needed).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const call = async (client, args) => {
  const r = await client.callTool({ name: "import_file", arguments: args });
  return r.content?.[0]?.text ?? "(no text)";
};

async function run(env, label, args, expectSubstring) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, ...env },
    stderr: "ignore",
  });
  const client = new Client({ name: "import-test", version: "0.0.1" });
  await client.connect(transport);
  const out = await call(client, args);
  const pass = out.includes(expectSubstring);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) console.log(`  expected substring: ${expectSubstring}\n  got: ${out.slice(0, 300)}`);
  await client.close();
  return pass;
}

let ok = true;
ok = (await run({ TUFAN_OPENCLOUD_KEY: "" }, "no key → setup help", { filePath: "C:/x.rbxm" }, "create.roblox.com/dashboard/credentials")) && ok;
ok = (await run({ TUFAN_OPENCLOUD_KEY: "   " }, "whitespace key → setup help", { filePath: "C:/x.rbxm" }, "create.roblox.com/dashboard/credentials")) && ok;
ok = (await run({ TUFAN_OPENCLOUD_KEY: "fake" }, ".obj rejected", { filePath: "C:/model.obj" }, "convert to .fbx")) && ok;
ok = (await run({ TUFAN_OPENCLOUD_KEY: "fake" }, "bad extension", { filePath: "C:/notes.txt" }, "Unsupported extension")) && ok;
ok = (await run({ TUFAN_OPENCLOUD_KEY: "fake" }, "missing file", { filePath: "C:/definitely-missing-xyz.rbxm" }, "File not found")) && ok;
ok = (await run({ TUFAN_OPENCLOUD_KEY: "fake" }, "neither filePath nor operationId", {}, "Provide filePath")) && ok;
process.exit(ok ? 0 : 1);
