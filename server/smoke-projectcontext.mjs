// Keyless smoke for project_context: set → get → append → get round-trip against a
// FAKE numeric placeId (bypasses Studio), then cleanup. Run: node smoke-projectcontext.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const FAKE_PLACE = 424242001;
const ctxFile = join(homedir(), ".tufan-blox-bridge", "context", `${FAKE_PLACE}.md`);
if (existsSync(ctxFile)) rmSync(ctxFile);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  stderr: "inherit",
});
const client = new Client({ name: "smoke-projectcontext", version: "1.0.0" });
await client.connect(transport);

const call = (args) => client.callTool({ name: "project_context", arguments: args });
const txt = (r) => r.content?.[0]?.text ?? "";
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${name}${detail ? " — " + detail : ""}`);
  ok ? pass++ : fail++;
};

// 1. get with nothing stored → friendly message
let r = await call({ action: "get", place: FAKE_PLACE });
check("get (empty) friendly message", !r.isError && txt(r).includes("no project context stored yet"));

// 2. set
r = await call({ action: "set", place: FAKE_PLACE, content: "# Chomolokko\n\n- Main module is ReplicatedStorage.Shared.Config\n" });
check("set", !r.isError && txt(r).startsWith("✓"), txt(r));

// 3. get round-trip
r = await call({ action: "get", place: FAKE_PLACE });
check("get returns what set wrote", txt(r).includes("ReplicatedStorage.Shared.Config"));

// 4. append adds a dated entry
r = await call({ action: "append", place: FAKE_PLACE, content: "WeatherService: do not touch RainIntensity directly (use SetWeather)." });
check("append", !r.isError, txt(r));
r = await call({ action: "get", place: FAKE_PLACE });
check("append dated + content landed", /## \d{4}-\d{2}-\d{2}/.test(txt(r)) && txt(r).includes("SetWeather"));
check("append preserved old content", txt(r).includes("ReplicatedStorage.Shared.Config"));

// 5. set/append without content → clear error
r = await call({ action: "set", place: FAKE_PLACE });
check("set without content errors", r.isError === true);

// 6. oversize set → 64 KB cap error
r = await call({ action: "set", place: FAKE_PLACE, content: "x".repeat(70 * 1024) });
check("oversize set rejected with cap message", r.isError === true && txt(r).includes("64 KB"), txt(r).split("\n")[0]);

// 7. file actually on disk
check("file on disk at ~/.tufan-blox-bridge/context/", existsSync(ctxFile), ctxFile);

// 8. read-only mode: get works, set is write-gated (separate server instance)
const roTransport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  stderr: "pipe",
  env: { ...process.env, TUFAN_READONLY: "1" },
});
const ro = new Client({ name: "smoke-ro", version: "1.0.0" });
await ro.connect(roTransport);
const roTools = (await ro.listTools()).tools.map((t) => t.name);
check("project_context visible in read-only mode", roTools.includes("project_context"));
let rr = await ro.callTool({ name: "project_context", arguments: { action: "get", place: FAKE_PLACE } });
check("get works in read-only mode", !rr.isError && txt(rr).includes("ReplicatedStorage.Shared.Config"));
rr = await ro.callTool({ name: "project_context", arguments: { action: "set", place: FAKE_PLACE, content: "nope" } });
check("set write-gated in read-only mode", rr.isError === true && txt(rr).includes("read-only mode"), txt(rr).split("\n")[0]);
await ro.close();

await client.close();
if (existsSync(ctxFile)) rmSync(ctxFile); // cleanup the fake-place blob
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
