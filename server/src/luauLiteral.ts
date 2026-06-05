// Shared canned-Luau plumbing for server-side tools that dispatch fixed Luau
// through the runLuau bridge op (spatial.ts, finishing.ts). Extracted from
// spatial.ts in v0.12 so the finishing layer can reuse it.
//
// runLuau runs chunks via loadstring → NO `script` global → canned code cannot
// require plugin modules. Primitives + the inlined resolver only.

/** Serialize a JS value to a Luau literal for safe interpolation into canned code. */
export function lua(v: unknown): string {
  if (v === undefined || v === null) return "nil";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "nil";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v); // valid Luau string for ASCII
  if (Array.isArray(v)) return "{" + v.map(lua).join(",") + "}";
  if (typeof v === "object") {
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue;
      parts.push(`${k}=${lua(val)}`);
    }
    return "{" + parts.join(",") + "}";
  }
  return "nil";
}

/** Shared helpers prepended to every canned script. No `script` global available. */
export const PRELUDE = `
local function resolve(path)
  if not path or path == "" then return nil end
  local parts = {}
  for seg in string.gmatch(path, "[^%.]+") do parts[#parts+1] = seg end
  local i = 1
  if parts[1] == "game" then i = 2 end
  local svc = parts[i]; if not svc then return nil end
  local cur
  local ok, s = pcall(function() return game:GetService(svc) end)
  cur = (ok and s) or game:FindFirstChild(svc)
  i = i + 1
  while cur and i <= #parts do cur = cur:FindFirstChild(parts[i]); i = i + 1 end
  return cur
end
local function round(n) return math.floor(n * 1000 + 0.5) / 1000 end
local function v3(v) return { round(v.X), round(v.Y), round(v.Z) } end
local function cf12(c) local t = { c:GetComponents() } for k = 1, #t do t[k] = round(t[k]) end return t end
local function degs(c) local rx, ry, rz = c:ToOrientation() return { round(math.deg(rx)), round(math.deg(ry)), round(math.deg(rz)) } end
`;
