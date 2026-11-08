import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getCurrentUserId, loadUsersConfig, saveUsersConfig } from "../lib/users.js";

export default defineTool({
  name: "personality",
  label: "Personality",
  description: "Speichert oder liest die Persönlichkeitseinstellung für den aktuellen Nutzer. Actions: get (aktuelle Einstellung lesen), set (Einstellung speichern).",
  parameters: Type.Object({
    action: Type.String({ description: "get oder set" }),
    personality: Type.Optional(Type.String({ description: "Persönlichkeitsbeschreibung (z.B. 'locker, witzig, technisch', 'formell und respektvoll', 'kindgerecht und ermutigend')" })),
  }),
  execute: async (_toolCallId, { action, personality }) => {
    try {
      const userId = getCurrentUserId();
      const config = loadUsersConfig();

      if (!config.users[userId]) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "User nicht gefunden" }) }], details: {} };
      }

      switch (action) {
        case "get": {
          const current = config.users[userId].personality;
          if (!current) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", personality: null, message: "Noch keine Persönlichkeit eingestellt." }) }], details: {} };
          }
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", personality: current }) }], details: {} };
        }

        case "set": {
          if (!personality?.trim()) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "personality Text erforderlich" }) }], details: {} };
          }

          config.users[userId].personality = personality.trim();
          saveUsersConfig(config);

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Persönlichkeit gespeichert: "${personality.trim()}"` }) }], details: {} };
        }

        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Verfügbar: get, set" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Personality-Fehler: ${e.message}` }], details: {} };
    }
  },
});
