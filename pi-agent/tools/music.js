import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { checkPermission } from "../lib/users.js";

// hey-ribo (Port 8085). RIBO_SERVICE_URL = sprechender Name, MUSIC_SERVICE_URL als Fallback.
const RIBO_SERVICE_URL = process.env.RIBO_SERVICE_URL || process.env.MUSIC_SERVICE_URL || "http://host.docker.internal:8085";

export default defineTool({
  name: "music",
  label: "Music",
  description: "Steuert Musik/Radio-Wiedergabe am Mac Mini. Actions: play (Sender abspielen), stop (Wiedergabe stoppen), volume (Lautstärke ändern), status (Was läuft gerade?).",
  parameters: Type.Object({
    action: Type.String({ description: "play, stop, volume, status" }),
    station: Type.Optional(Type.String({ description: "Sendername, z.B. radio teddy, swr3" })),
    url: Type.Optional(Type.String({ description: "Direkte Stream-URL" })),
    volume: Type.Optional(Type.Number({ description: "Lautstärke 0-100" })),
  }),
  execute: async (_toolCallId, { action, station, url, volume }) => {
    const denied = checkPermission("music");
    if (denied) return denied;
    try {
      switch (action) {
        case "play": {
          const resp = await fetch(`${RIBO_SERVICE_URL}/music/play`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ station, url }),
          });
          return { content: [{ type: "text", text: JSON.stringify(await resp.json()) }], details: {} };
        }
        case "stop": {
          const resp = await fetch(`${RIBO_SERVICE_URL}/music/stop`, { method: "POST" });
          return { content: [{ type: "text", text: JSON.stringify(await resp.json()) }], details: {} };
        }
        case "volume": {
          const resp = await fetch(`${RIBO_SERVICE_URL}/music/volume`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ volume }),
          });
          return { content: [{ type: "text", text: JSON.stringify(await resp.json()) }], details: {} };
        }
        case "status": {
          const resp = await fetch(`${RIBO_SERVICE_URL}/music/status`);
          return { content: [{ type: "text", text: JSON.stringify(await resp.json()) }], details: {} };
        }
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unknown action" }) }], details: {} };
      }
    } catch (e) {
      console.error(`❌ Music Tool error (${action}):`, e.message);
      return { content: [{ type: "text", text: `Error: Music Service nicht erreichbar: ${e.message}` }], details: {} };
    }
  },
});
