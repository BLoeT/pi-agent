import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { checkPermission } from "../lib/users.js";

const HA_SERVICE_URL = process.env.HA_SERVICE_URL || "http://ha-service:8082";

export default defineTool({
  name: "homeassistant",
  label: "Home Assistant",
  description: "Steuert Smart-Home-Geräte über Home Assistant. Actions: call_service (Gerät steuern), get_states (Status abfragen), get_services (verfügbare Services auflisten).",
  parameters: Type.Object({
    action: Type.String({ description: "call_service, get_states, get_services" }),
    domain: Type.Optional(Type.String({ description: "Service-Domain, z.B. light, switch, climate" })),
    service: Type.Optional(Type.String({ description: "Service-Name, z.B. turn_on, turn_off, toggle" })),
    entity_id: Type.Optional(Type.String({ description: "Entity-ID, z.B. light.wohnzimmer" })),
    data: Type.Optional(Type.Object({}, { description: "Zusätzliche Service-Daten" })),
  }),
  execute: async (_toolCallId, { action, domain, service, entity_id, data }) => {
    const denied = checkPermission("smart_home");
    if (denied) return denied;
    try {
      switch (action) {
        case "call_service": {
          const resp = await fetch(`${HA_SERVICE_URL}/call_service`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain, service, entity_id, data }),
          });
          if (!resp.ok) throw new Error(`HA service responded ${resp.status}`);
          const result = await resp.json();
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
        }
        case "get_states": {
          const url = entity_id ? `${HA_SERVICE_URL}/states/${entity_id}` : `${HA_SERVICE_URL}/states`;
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HA service responded ${r.status}`);
          const result = await r.json();
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
        }
        case "get_services": {
          const sv = await fetch(`${HA_SERVICE_URL}/services`);
          if (!sv.ok) throw new Error(`HA service responded ${sv.status}`);
          const result = await sv.json();
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
        }
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unknown action" }) }], details: {} };
      }
    } catch (e) {
      console.error(`❌ HA Tool error (${action}):`, e.message);
      return { content: [{ type: "text", text: `Error: Home Assistant nicht erreichbar: ${e.message}` }], details: {} };
    }
  },
});
