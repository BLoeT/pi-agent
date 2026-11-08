import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { checkPermission } from "../lib/users.js";

// hey-ribo stellt Musik, Timer und TTS bereit (Port 8085). RIBO_SERVICE_URL ist der
// sprechende Name; MUSIC_SERVICE_URL bleibt als Fallback für bestehende Configs.
const RIBO_SERVICE_URL = process.env.RIBO_SERVICE_URL || process.env.MUSIC_SERVICE_URL || "http://host.docker.internal:8085";

export default defineTool({
  name: "timer",
  label: "Timer",
  description: "Verwaltet Timer und Wecker. Actions: create (Timer erstellen), cancel (Timer abbrechen), list (aktive Timer anzeigen).",
  parameters: Type.Object({
    action: Type.String({ description: "create, cancel, list" }),
    name: Type.Optional(Type.String({ description: "Name des Timers" })),
    duration_seconds: Type.Optional(Type.Number({ description: "Dauer in Sekunden (1-86400)" })),
  }),
  execute: async (_toolCallId, { action, name, duration_seconds }) => {
    const denied = checkPermission("timer");
    if (denied) return denied;
    try {
      switch (action) {
        case "create": {
          const resp = await fetch(`${RIBO_SERVICE_URL}/timer/create`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, duration_seconds }),
          });
          if (!resp.ok) throw new Error(`Timer service responded ${resp.status}`);
          return { content: [{ type: "text", text: JSON.stringify(await resp.json()) }], details: {} };
        }
        case "cancel": {
          const resp = await fetch(`${RIBO_SERVICE_URL}/timer/cancel`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          if (!resp.ok) throw new Error(`Timer service responded ${resp.status}`);
          return { content: [{ type: "text", text: JSON.stringify(await resp.json()) }], details: {} };
        }
        case "list": {
          const resp = await fetch(`${RIBO_SERVICE_URL}/timer/list`);
          if (!resp.ok) throw new Error(`Timer service responded ${resp.status}`);
          return { content: [{ type: "text", text: JSON.stringify(await resp.json()) }], details: {} };
        }
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Verfügbar: create, cancel, list" }) }], details: {} };
      }
    } catch (e) {
      console.error(`❌ Timer Tool error (${action}):`, e.message);
      return { content: [{ type: "text", text: `Error: Timer Service nicht erreichbar: ${e.message}` }], details: {} };
    }
  },
});
