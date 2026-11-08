import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { getCurrentUserId, userHasPermission } from "../lib/users.js";
import { PLUGINS_DIR, ensurePluginsDir, readPluginMeta, writePluginMeta } from "../lib/plugins.js";

const PLUGIN_TEMPLATE = `const tool = {
  name: "TOOL_NAME",
  label: "TOOL_LABEL",
  description: "TOOL_DESCRIPTION",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", description: "Verfügbare Aktionen" },
    },
    required: ["action"]
  },
  execute: async (_toolCallId, params) => {
    try {
      const { action } = params;
      switch (action) {
        case "example":
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Hello from plugin!" }) }], details: {} };
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], details: {} };
    }
  }
};

export default tool;
`;

function normalizeFilename(filename) {
  let fname = filename.trim();
  if (!fname.endsWith('.js')) fname += '.js';
  return fname;
}

function isValidFilename(fname) {
  return !fname.includes('/') && !fname.includes('..');
}

export default defineTool({
  name: "develop",
  label: "Develop",
  description: "Erstellt, bearbeitet oder löscht Ribo-Plugins (Admin-only). Plugins werden beim nächsten Neustart geladen. Actions: create_plugin, edit_plugin, delete_plugin, list_plugins, show_template, grant_access (Nutzer Zugriff geben), revoke_access (Zugriff entziehen).",
  parameters: Type.Object({
    action: Type.String({ description: "create_plugin, edit_plugin, delete_plugin, list_plugins, show_template, grant_access, revoke_access" }),
    filename: Type.Optional(Type.String({ description: "Dateiname (z.B. jokes.js)" })),
    code: Type.Optional(Type.String({ description: "Kompletter Plugin-Code" })),
    allowed_users: Type.Optional(Type.Array(Type.String(), { description: "Liste der User-IDs die das Plugin nutzen dürfen (leer/weggelassen = alle). Für create_plugin." })),
    user: Type.Optional(Type.String({ description: "Einzelner User für grant_access/revoke_access (z.B. jaqueline)" })),
  }),
  execute: async (_toolCallId, { action, filename, code, allowed_users, user }) => {
    if (!userHasPermission(getCurrentUserId(), "admin")) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Keine Admin-Berechtigung" }) }], details: {} };
    }
    try {
      ensurePluginsDir();
      switch (action) {
        case "list_plugins": {
          const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));
          if (files.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine Plugins.", plugins: [] }) }], details: {} };
          const infos = files.map(f => {
            try {
              const c = fs.readFileSync(path.join(PLUGINS_DIR, f), "utf-8");
              const n = c.match(/name:\s*["']([^"']+)["']/); const d = c.match(/description:\s*["']([^"']+)["']/);
              const meta = readPluginMeta(f);
              const scope = (meta.allowed_users && meta.allowed_users.length > 0) ? meta.allowed_users.join(", ") : "alle";
              return { file: f, name: n?.[1] || f, description: d?.[1]?.slice(0, 80) || "", access: scope };
            } catch (_) { return { file: f, name: f, description: "", access: "alle" }; }
          });
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: infos.map(p => `${p.file}: ${p.name} (Zugriff: ${p.access})`).join("\n"), plugins: infos }) }], details: {} };
        }
        case "show_template":
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", template: PLUGIN_TEMPLATE }) }], details: {} };
        case "create_plugin": {
          if (!filename?.trim() || !code?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "filename und code erforderlich" }) }], details: {} };
          const fname = normalizeFilename(filename);
          if (!isValidFilename(fname)) return { content: [{ type: "text", text: JSON.stringify({ error: "Ungültiger Dateiname" }) }], details: {} };
          if (fs.existsSync(path.join(PLUGINS_DIR, fname))) return { content: [{ type: "text", text: JSON.stringify({ error: `"${fname}" existiert. Nutze edit_plugin.` }) }], details: {} };
          fs.writeFileSync(path.join(PLUGINS_DIR, fname), code, "utf-8");

          // Write access metadata if provided
          let accessMsg = "für alle User verfügbar";
          if (allowed_users && allowed_users.length > 0) {
            writePluginMeta(fname, { allowed_users });
            accessMsg = `nur für: ${allowed_users.join(", ")}`;
          }

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Plugin "${fname}" erstellt (${accessMsg}). Neustart erforderlich.` }) }], details: {} };
        }
        case "edit_plugin": {
          if (!filename?.trim() || !code?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "filename und code erforderlich" }) }], details: {} };
          const fname = normalizeFilename(filename);
          if (!isValidFilename(fname)) return { content: [{ type: "text", text: JSON.stringify({ error: "Ungültiger Dateiname" }) }], details: {} };
          if (!fs.existsSync(path.join(PLUGINS_DIR, fname))) return { content: [{ type: "text", text: JSON.stringify({ error: `"${fname}" nicht gefunden` }) }], details: {} };
          fs.writeFileSync(path.join(PLUGINS_DIR, fname), code, "utf-8");
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${fname}" aktualisiert. Neustart erforderlich.` }) }], details: {} };
        }
        case "delete_plugin": {
          if (!filename?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "filename erforderlich" }) }], details: {} };
          const fname = normalizeFilename(filename);
          if (!isValidFilename(fname)) return { content: [{ type: "text", text: JSON.stringify({ error: "Ungültiger Dateiname" }) }], details: {} };
          if (!fs.existsSync(path.join(PLUGINS_DIR, fname))) return { content: [{ type: "text", text: JSON.stringify({ error: `"${fname}" nicht gefunden` }) }], details: {} };
          fs.unlinkSync(path.join(PLUGINS_DIR, fname));
          // Remove meta file too
          const metaPath = path.join(PLUGINS_DIR, fname.replace(/\.js$/, ".meta.json"));
          if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${fname}" gelöscht.` }) }], details: {} };
        }
        case "grant_access": {
          if (!filename?.trim() || !user?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "filename und user erforderlich" }) }], details: {} };
          const fname = normalizeFilename(filename);
          if (!fs.existsSync(path.join(PLUGINS_DIR, fname))) return { content: [{ type: "text", text: JSON.stringify({ error: `"${fname}" nicht gefunden` }) }], details: {} };
          const meta = readPluginMeta(fname);
          const users = meta.allowed_users || [];
          const userId = user.trim().toLowerCase();
          if (users.includes(userId)) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${userId} hat bereits Zugriff auf "${fname}"` }) }], details: {} };
          users.push(userId);
          writePluginMeta(fname, { allowed_users: users });
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${userId} hat jetzt Zugriff auf "${fname}". Neustart erforderlich.` }) }], details: {} };
        }
        case "revoke_access": {
          if (!filename?.trim() || !user?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "filename und user erforderlich" }) }], details: {} };
          const fname = normalizeFilename(filename);
          if (!fs.existsSync(path.join(PLUGINS_DIR, fname))) return { content: [{ type: "text", text: JSON.stringify({ error: `"${fname}" nicht gefunden` }) }], details: {} };
          const meta = readPluginMeta(fname);
          const users = meta.allowed_users || [];
          const userId = user.trim().toLowerCase();
          if (!users.includes(userId)) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${userId} hatte keinen expliziten Zugriff auf "${fname}"` }) }], details: {} };
          const remaining = users.filter(u => u !== userId);
          writePluginMeta(fname, { allowed_users: remaining });
          const note = remaining.length === 0 ? " (jetzt wieder für alle verfügbar!)" : "";
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${userId} hat keinen Zugriff mehr auf "${fname}"${note}. Neustart erforderlich.` }) }], details: {} };
        }
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Plugin-Fehler: ${e.message}` }], details: {} };
    }
  },
});
