// Query Open Cloud for the real metadata of an uploaded asset.
// Usage: node get-asset.mjs <assetId>   (key from TUFAN_OPENCLOUD_KEY)
const key = process.env.TUFAN_OPENCLOUD_KEY;
const id = process.argv[2];
if (!key || !id) { console.error("need TUFAN_OPENCLOUD_KEY env + <assetId> arg"); process.exit(2); }

const r = await fetch(`https://apis.roblox.com/assets/v1/assets/${id}`, {
  headers: { "x-api-key": key },
  signal: AbortSignal.timeout(15000),
});
console.log("HTTP", r.status);
const text = await r.text();
try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
catch { console.log(text.slice(0, 800)); }
