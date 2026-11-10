import { renameUpload, deleteUpload } from "../lib/uploads.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import { resolveWithin } from "../lib/security.js";
import path from "path";
import { getCurrentUserId, getUserWorkspacePath, checkPermission } from "../lib/users.js";

// List files recursively within the user's workspace
function listFilesRecursive(dir, base, entries = []) {
  if (!fs.existsSync(dir)) return entries;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
    const abs = path.join(dir, item.name);
    const rel = path.relative(base, abs);
    if (item.isDirectory()) {
      listFilesRecursive(abs, base, entries);
    } else {
      entries.push({ path: rel, size: fs.statSync(abs).size });
    }
  }
  return entries;
}

/**
 * Securely resolve a user-provided path within the workspace root.
 * Returns the absolute path if safe, or null if it would escape the workspace.
 * Uses path.relative to reliably detect traversal (../, absolute paths, symlink-style tricks).
 */
function safeResolve(workspaceRoot, userPath) {
  try { return resolveWithin(workspaceRoot, userPath); } catch { return null; }
}

export default defineTool({
  name: "files",
  label: "Dateien",
  description: "Verwaltet Dateien im eigenen Workspace des Nutzers. Actions: list (auflisten), send (via Telegram/Chat schicken), rename (hochgeladenes Bild in uploads/ umbenennen), delete (löschen). Der Nutzer kann NUR auf seine eigenen Dateien zugreifen.",
  parameters: Type.Object({
    action: Type.String({ description: "list, send, rename oder delete" }),
    file_path: Type.Optional(Type.String({ description: "Relativer Pfad der Datei im Workspace (z.B. generated-images/robot.png)" })),
    new_name: Type.Optional(Type.String({description:"Gewünschter Bildname bei rename, z.B. test1; nur für uploads/-Bilder"})),
    filter: Type.Optional(Type.String({ description: "Optionaler Filter für list (z.B. 'png', 'projects')" })),
  }),
  execute: async (_toolCallId, { action, file_path, new_name, filter }) => {
    const denied = checkPermission("files");
    if (denied) return denied;
    try {
      const userId = getCurrentUserId();
      const workspaceRoot = getUserWorkspacePath(userId);

      switch (action) {
        case "list": {
          let files = listFilesRecursive(workspaceRoot, workspaceRoot);
          if (filter?.trim()) {
            const f = filter.trim().toLowerCase();
            files = files.filter(file => file.path.toLowerCase().includes(f));
          }
          if (files.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: filter ? `Keine Dateien mit "${filter}" gefunden.` : "Keine Dateien im Workspace.", files: [] }) }], details: {} };
          }
          const limited = files.slice(0, 50);
          const formatted = limited.map(f => `${f.path} (${(f.size / 1024).toFixed(1)} KB)`).join("\n");
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${files.length} Datei(en):\n${formatted}`, files: limited }) }], details: {} };
        }

        case "send": {
          if (!file_path?.trim()) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "file_path erforderlich" }) }], details: {} };
          }
          const absPath = safeResolve(workspaceRoot, file_path.trim());
          if (!absPath) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "Zugriff nur auf eigene Dateien erlaubt" }) }], details: {} };
          }
          if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `Datei nicht gefunden: ${file_path}` }) }], details: {} };
          }
          const relPath = path.relative(workspaceRoot, absPath);
          const filename = path.basename(absPath);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Hier ist deine Datei: ${filename}`, file_marker: `[FILE:${userId}:${relPath}]` }) }], details: {} };
        }

        case "rename": {
          if(!file_path?.startsWith("uploads/") || file_path.slice(8).includes("/"))throw new Error("Nur eigene Upload-Bilder können hier umbenannt werden");
          const renamed=renameUpload(userId,file_path.slice(8),new_name);
          return {content:[{type:"text",text:JSON.stringify({status:"ok",...renamed})}],details:{}};
        }
        case "delete": {
          if (!file_path?.trim()) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "file_path erforderlich" }) }], details: {} };
          }
          if(file_path.startsWith("uploads/") && !file_path.slice(8).includes("/")) {
            deleteUpload(userId,file_path.slice(8));
            return {content:[{type:"text",text:JSON.stringify({status:"ok",message:"Bild gelöscht"})}],details:{}};
          }
          const absPath = safeResolve(workspaceRoot, file_path.trim());
          if (!absPath) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "Zugriff nur auf eigene Dateien erlaubt" }) }], details: {} };
          }
          if (!fs.existsSync(absPath)) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `Datei nicht gefunden: ${file_path}` }) }], details: {} };
          }
          if (!fs.statSync(absPath).isFile()) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "Nur Dateien können gelöscht werden, keine Ordner" }) }], details: {} };
          }
          const relPath = path.relative(workspaceRoot, absPath);
          fs.unlinkSync(absPath);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Datei gelöscht: ${relPath}` }) }], details: {} };
        }

        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Verfügbar: list, send, delete" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Datei-Fehler: ${e.message}` }], details: {} };
    }
  },
});
