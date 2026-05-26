import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

// Turn the plugin's raw counts into a ranked, actionable report. Each finding is
// scored so the worst frame-killers float to the top.
function report(r: any): string {
  const s = r?.stats ?? {};
  const findings: { sev: number; line: string }[] = [];
  const add = (sev: number, line: string) => findings.push({ sev, line });

  // 1. StreamingEnabled off with a big map = the highest-leverage single toggle.
  if (!r?.streamingEnabled && (s.parts ?? 0) > 1000) {
    add(3, `🔴 StreamingEnabled is OFF with ${s.parts} parts — turn it on (Workspace.StreamingEnabled) for a big memory/load win.`);
  }
  // 2. Unanchored parts = physics solver cost.
  if ((s.unanchored ?? 0) > 200) {
    add(3, `🔴 ${s.unanchored} unanchored parts — anchor anything that shouldn't simulate (physics runs on all of them every frame).`);
  } else if ((s.unanchored ?? 0) > 50) {
    add(2, `⚠️ ${s.unanchored} unanchored parts — review; anchor static geometry.`);
  }
  // 3. Busy loops with no yield = hangs / frame stalls.
  if (Array.isArray(r?.busyLoops) && r.busyLoops.length) {
    add(3, `🔴 ${r.busyLoops.length} script(s) with a \`while true do\` and no yield (possible busy-loop):\n   - ` + r.busyLoops.join("\n   - "));
  }
  // 4. CSG unions are expensive to render + collide.
  if ((s.unions ?? 0) > 200) {
    add(2, `⚠️ ${s.unions} CSG unions — heavy to render/collide; bake hero unions to MeshParts where you can.`);
  }
  // 5. Precise render fidelity on many meshes.
  if ((s.preciseMesh ?? 0) > 50) {
    add(2, `⚠️ ${s.preciseMesh} MeshParts at RenderFidelity=Precise — set distant/small ones to Automatic.`);
  }
  // 6. Shadow-casting lights.
  if ((s.shadowLights ?? 0) > 40) {
    add(2, `⚠️ ${s.shadowLights} shadow-casting lights — shadows are per-light per-frame; disable Shadows on minor lights.`);
  }
  // 7. Particle emitters.
  if ((s.particles ?? 0) > 150) {
    add(1, `• ${s.particles} ParticleEmitters — cap Rate and disable off-screen ones.`);
  }
  // 8. Raw instance count.
  if ((s.total ?? 0) > 40000) {
    add(2, `⚠️ ${s.total} total instances — high; consider StreamingEnabled + merging static decor.`);
  }

  findings.sort((a, b) => b.sev - a.sev);

  const summary =
    `Scan: ${s.total ?? 0} instances · ${s.parts ?? 0} parts (${s.unanchored ?? 0} unanchored) · ` +
    `${s.meshparts ?? 0} meshes (${s.untexturedMesh ?? 0} untextured) · ${s.unions ?? 0} unions · ` +
    `${s.lights ?? 0} lights · ${s.particles ?? 0} particles · ${s.scripts ?? 0} scripts · ` +
    `Streaming ${r?.streamingEnabled ? "ON" : "OFF"}`;

  if (!findings.length) return summary + "\n\n✅ No major frame-killers found.";
  return summary + "\n\n" + findings.map((f) => f.line).join("\n");
}

export function registerPerfTools(server: McpServer) {
  server.registerTool(
    "scan_perf",
    {
      description:
        "Audit the place for runtime frame-killers in one pass (part/physics load, " +
        "StreamingEnabled, CSG unions, precise meshes, shadow lights, particles, and " +
        "scripts with un-yielded `while true do` loops). Returns a ranked fix list.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) => runStudio("scanPerf", {}, report, place),
  );
}
