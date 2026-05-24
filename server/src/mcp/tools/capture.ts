import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dispatch } from "../../bridge/queue.js";
import { errorText, type ToolText } from "../helpers.js";

export function registerCaptureTools(server: McpServer) {
  server.registerTool(
    "capture_screenshot",
    {
      description: "Capture a screenshot of the Studio viewport and return it as an image.",
      inputSchema: {},
    },
    async (): Promise<ToolText | any> => {
      try {
        const r: any = await dispatch("captureScreenshot", {}, 45_000);
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
