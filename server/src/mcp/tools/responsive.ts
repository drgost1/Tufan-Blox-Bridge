import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerResponsiveTools(server: McpServer) {
  server.registerTool(
    "make_responsive",
    {
      description:
        "Make a UI subtree resolution-proof. Converts Offset→Scale across ALL the properties " +
        "that break responsiveness — Position, Size, CanvasSize, CellSize, CellPadding, UIPadding, " +
        "UICorner CornerRadius (validated formula: ÷ parent AbsoluteSize per axis; CornerRadius ÷ " +
        "min-axis). Skips runtime-driven elements (tagged Draggable/Resizable, or in `exclude`) so it " +
        "never shatters draggable/resizable panels. ALWAYS dryRun first to preview.\n" +
        "modes: scale (default, Offset→Scale) · offset (reverse) · fit (root fills parent: Size {1,1} " +
        "+ Pos 0 + Anchor 0) · uiscale (keep Offset, add a UIScale + a real viewport-fit driver).\n" +
        "Flags: aspectRatio (add UIAspectRatioConstraint at current aspect, skips layout-managed kids), " +
        "minSize (UISizeConstraint 44×44 on buttons).",
      inputSchema: {
        path: z.string(),
        mode: z.enum(["scale", "offset", "fit", "uiscale"]).optional().describe("default scale"),
        dryRun: z.boolean().optional().describe("preview without writing (do this first)"),
        aspectRatio: z.boolean().optional().describe("add UIAspectRatioConstraint at current aspect"),
        minSize: z.boolean().optional().describe("add 44×44 UISizeConstraint to buttons"),
        exclude: z.array(z.string()).optional().describe("paths to leave untouched (runtime-driven elements)"),
        referenceResolution: z.object({ x: z.number(), y: z.number() }).optional().describe("uiscale mode design res (default 1280×720)"),
        place: placeArg,
      },
    },
    async ({ path, mode, dryRun, aspectRatio, minSize, exclude, referenceResolution, place }) =>
      runStudio(
        "makeResponsive",
        { path, mode: mode ?? "scale", dryRun: dryRun ?? false, aspectRatio: aspectRatio ?? false, minSize: minSize ?? false, exclude: exclude ?? [], referenceResolution },
        (r) => {
          const head = `${r.dryRun ? "[dry run] " : ""}make_responsive (${r.mode}) — ${r.count ?? r.changes?.length ?? 0} change(s)`;
          if (!Array.isArray(r.changes) || !r.changes.length) return head;
          const lines = r.changes.slice(0, 60).map((c: any) =>
            c.before === "-" ? `  ${c.path}  ${c.prop} → ${c.after}` : `  ${c.path}  ${c.prop}: ${c.before} → ${c.after}`,
          );
          const more = r.changes.length > 60 ? `\n  … +${r.changes.length - 60} more` : "";
          return `${head}:\n${lines.join("\n")}${more}`;
        },
        place,
      ),
  );

  server.registerTool(
    "scan_responsive",
    {
      description:
        "Audit a UI subtree for what breaks on other resolutions — across the tree AND the scripts. " +
        "Flags Offset-locked Position/Size/CanvasSize/CellSize/CellPadding/Padding/CornerRadius, sub-44 " +
        "tap targets, and runtime pixel-positioning in code. Recognizes intentional draggable/resizable " +
        "elements (tagged) and instead checks their drag logic (clamps to viewport?). Read-only.",
      inputSchema: { path: z.string(), place: placeArg },
    },
    async ({ path, place }) =>
      runStudio("scanResponsive", { path }, (r) => {
        const c = r?.counts ?? {};
        const findings = (r?.findings ?? []).sort((a: any, b: any) => b.sev - a.sev);
        const code = r?.codeIssues ?? [];
        const sev = (n: number) => (n >= 3 ? "🔴" : n >= 2 ? "⚠️" : "•");

        const summary =
          `Responsive scan: ${c.offsetPos ?? 0} offset Position · ${c.offsetSize ?? 0} offset Size · ` +
          `${c.offsetCanvas ?? 0} offset CanvasSize · ${c.offsetCell ?? 0} offset CellSize · ` +
          `${c.offsetPad ?? 0} offset Padding · ${c.offsetCorner ?? 0} offset CornerRadius · ` +
          `${c.smallTap ?? 0} sub-44 taps · ${c.draggable ?? 0} runtime-driven (skipped)`;

        const out: string[] = [summary];
        if (findings.length) {
          out.push("\nTree:");
          for (const f of findings.slice(0, 80)) out.push(`  ${sev(f.sev)} ${f.path} — ${f.msg}`);
          if (findings.length > 80) out.push(`  … +${findings.length - 80} more`);
        }
        if (code.length) {
          out.push("\nCode:");
          for (const ci of code) {
            const warn = ci.kind.includes("drag") ? (ci.clampsToViewport ? " (clamps to viewport ✓)" : " (⚠️ no viewport clamp — can drag off small screens)") : "";
            out.push(`  • ${ci.script} — ${ci.kind}${warn}`);
          }
        }
        if (!findings.length && !code.length) out.push("\n✅ No responsiveness issues found.");
        return out.join("\n");
      }, place),
  );
}
