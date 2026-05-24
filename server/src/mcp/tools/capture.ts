import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dispatchTo, resolveTargetPlace } from "../../bridge/sessions.js";
import { placeArg, errorText } from "../helpers.js";

export function registerCaptureTools(server: McpServer) {
  server.registerTool(
    "capture_screenshot",
    {
      description: "Capture the Studio viewport as an image. (Currently unsupported — no plugin pixel-capture API.)",
      inputSchema: { place: placeArg },
    },
    async ({ place }) => {
      const target = resolveTargetPlace(place);
      if (target.error) return errorText(target.error);
      try {
        const r: any = await dispatchTo(target.placeId!, "captureScreenshot", {}, 45_000);
        if (r?.pngBase64) {
          return { content: [{ type: "image", data: r.pngBase64, mimeType: "image/png" }] };
        }
        return errorText("Plugin returned no image data.");
      } catch (e) {
        return errorText(`captureScreenshot failed: ${(e as Error).message}`);
      }
    },
  );
}
