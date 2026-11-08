import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getCurrentUserId, userHasPermission, loadUsersConfig, saveUsersConfig, ensureUserWorkspace } from "../lib/users.js";

export default defineTool({
  name: "admin",
  label: "Admin",
  description: "Verwaltet Nutzer und Berechtigungen. Nur für Admins. Actions: add_user, remove_user, edit_user, list_users.",
  parameters: Type.Object({
    action: Type.String({ description: "add_user, remove_user, edit_user, list_users" }),
    username: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    chat_id: Type.Optional(Type.Number()),
    permissions: Type.Optional(Type.Array(Type.String())),
    groups: Type.Optional(Type.Array(Type.String())),
  }),
  execute: async (_toolCallId, { action, username, name, chat_id, permissions, groups }) => {
    const currentUser = getCurrentUserId();
    if (!userHasPermission(currentUser, "admin")) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Keine Admin-Berechtigung" }) }], details: {} };
    }
    try {
      const config = loadUsersConfig();
      switch (action) {
        case "list_users": {
          const users = Object.entries(config.users).map(([id, u]) => ({ id, name: u.name, chat_id: u.chat_id, permissions: u.permissions, groups: u.groups }));
          const groupList = Object.entries(config.groups || {}).map(([id, g]) => ({ id, description: g.description }));
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", users, groups: groupList }) }], details: {} };
        }
        case "add_user": {
          if (!username?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "username erforderlich" }) }], details: {} };
          const userId = username.trim().toLowerCase();
          if (config.users[userId]) return { content: [{ type: "text", text: JSON.stringify({ error: `"${userId}" existiert bereits` }) }], details: {} };
          const defaultPerms = permissions || ["calendar", "notes", "lists", "imagegen", "weather", "news", "search", "weekplanner", "flashcards"];
          config.users[userId] = { name: name || username.charAt(0).toUpperCase() + username.slice(1), chat_id: chat_id || null, permissions: defaultPerms, groups: groups || [] };
          saveUsersConfig(config);
          ensureUserWorkspace(userId);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Nutzer "${config.users[userId].name}" angelegt`, user: config.users[userId] }) }], details: {} };
        }
        case "remove_user": {
          if (!username?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "username erforderlich" }) }], details: {} };
          const userId = username.trim().toLowerCase();
          if (!config.users[userId]) return { content: [{ type: "text", text: JSON.stringify({ error: `"${userId}" nicht gefunden` }) }], details: {} };
          if (userId === currentUser) return { content: [{ type: "text", text: JSON.stringify({ error: "Kann sich nicht selbst löschen" }) }], details: {} };
          const removedName = config.users[userId].name;
          delete config.users[userId];
          saveUsersConfig(config);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${removedName}" entfernt` }) }], details: {} };
        }
        case "edit_user": {
          if (!username?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "username erforderlich" }) }], details: {} };
          const userId = username.trim().toLowerCase();
          if (!config.users[userId]) return { content: [{ type: "text", text: JSON.stringify({ error: `"${userId}" nicht gefunden` }) }], details: {} };
          const changes = [];
          if (name) { config.users[userId].name = name; changes.push(`Name: ${name}`); }
          if (chat_id != null) { config.users[userId].chat_id = chat_id; changes.push(`Chat-ID: ${chat_id}`); }
          if (permissions) { config.users[userId].permissions = permissions; changes.push("Permissions aktualisiert"); }
          if (groups) { config.users[userId].groups = groups; changes.push(`Gruppen: ${groups.join(", ")}`); }
          if (changes.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "Keine Änderungen" }) }], details: {} };
          saveUsersConfig(config);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${userId}" aktualisiert: ${changes.join(", ")}` }) }], details: {} };
        }
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Admin-Fehler: ${e.message}` }], details: {} };
    }
  },
});
