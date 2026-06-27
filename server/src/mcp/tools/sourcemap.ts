import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import { resolveTargetPlace, getSessionByPlace } from "../../bridge/sessions.js";
import { buildSourcemap, countScripts } from "../../sourcemap/build.js";

// Windows 260-char path cap workaround (matches sync/mirror.ts).
function longPath(p: string): string {
  if (process.platform !== "win32") return p;
  const native = p.replace(/\//g, "\\");
  return native.startsWith("\\\\?\\") ? native : "\\\\?\\" + native;
}

// Resolve the on-disk script-mirror root + place name for a place.
function mirrorFor(place?: string | number): { root?: string; name?: string; error?: string } {
  const t = resolveTargetPlace(place);
  if (t.error) return { error: t.error };
  const s = getSessionByPlace(t.placeId!);
  if (!s) return { error: `Place ${t.placeId} not connected.` };
  return { root: s.mirrorRoot ?? s.root, name: s.placeName };
}

export function registerSourcemapTools(server: McpServer) {
  // Read-of-disk + writes a derived build artifact (sourcemap.json). Doesn't
  // mutate the place or any user source, so it stays visible in read-only mode.
  server.registerTool(
    "export_sourcemap",
    {
      description:
        "Generate a Rojo-style sourcemap.json from a place's synced script mirror — the file luau-lsp " +
        "needs to resolve `require` paths and give IntelliSense/type info in VS Code (and the foundation " +
        "the typecheck tool will build on). Pure filesystem walk of the on-disk mirror: no Studio " +
        "round-trip, no mutation. Writes to <mirror>/sourcemap.json by default. Point luau-lsp at it via " +
        "the luau-lsp.sourcemap.sourcemapFile setting. (Reflects scripts + folders in the mirror; non-" +
        "script instances aren't on disk so aren't represented — that's all luau-lsp needs for requires.)",
      inputSchema: {
        output: z
          .string()
          .optional()
          .describe("output path (absolute, or relative to the mirror root; default sourcemap.json)"),
        place: placeArg,
      },
    },
    async ({ output, place }) => {
      const m = mirrorFor(place);
      if (m.error) return errorText(m.error);

      let map;
      try {
        map = buildSourcemap(m.root!, m.name || "game");
      } catch (e) {
        return errorText(`sourcemap build failed: ${(e as Error).message}`);
      }
      const n = countScripts(map);

      const outPath = output
        ? isAbsolute(output)
          ? output
          : join(m.root!, output)
        : join(m.root!, "sourcemap.json");
      // keep the write inside the mirror root — no arbitrary-path writes
      const relOut = relative(m.root!, outPath);
      if (relOut === ".." || relOut.startsWith(".." + sep) || isAbsolute(relOut)) {
        return errorText(`output must stay within the script-mirror root, refusing: ${output}`);
      }
      try {
        mkdirSync(longPath(dirname(outPath)), { recursive: true });
        writeFileSync(longPath(outPath), JSON.stringify(map, null, 2), "utf8");
      } catch (e) {
        return errorText(`failed to write sourcemap: ${(e as Error).message}`);
      }

      if (n === 0) {
        return text(
          `Wrote ${outPath}, but found 0 scripts in the mirror (${m.root}). Is the place synced to disk? ` +
            `export_sourcemap reads the on-disk script mirror.`,
        );
      }
      return text(
        `✓ wrote ${outPath} — ${n} script${n === 1 ? "" : "s"}. ` +
          `Point luau-lsp at it (luau-lsp.sourcemap.sourcemapFile) for require resolution + IntelliSense.`,
      );
    },
  );
}
