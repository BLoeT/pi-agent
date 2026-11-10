import { getCurrentUserId, getUserWorkspacePath } from "/app/lib/users.js";
import { resolveWithin } from "/app/lib/security.js";
const tool = {
  name: "file_reader",
  label: "File Reader",
  description: "Liest eine Datei und gibt Zeilen ab einem Offset zurück. Für die Analyse von statischen Dateien.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Pfad zur Datei" },
      offset: { type: "number", description: "Startzeile (default: 1)" },
      limit: { type: "number", description: "Anzahl Zeilen (default: 50)" }
    },
    required: ["file_path"]
  },
  execute: async (_toolCallId, params) => {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const { file_path, offset = 1, limit = 50 } = params;
      if(!Number.isInteger(offset) || offset<1 || !Number.isInteger(limit) || limit<1 || limit>500) throw new Error("offset muss positiv sein, limit zwischen 1 und 500");
      const fullPath = resolveWithin(getUserWorkspacePath(getCurrentUserId()), file_path);
      if (fs.statSync(fullPath).size > 1024 * 1024) throw new Error("Datei zu groß (max. 1 MB)");
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, offset - 1);
      const end = Math.min(lines.length, start + limit);
      const slice = lines.slice(start, end);
      const result = slice.map((l, i) => `${start + i + 1}: ${l}`).join('\n');

      return {
        content: [{ type: "text", text: JSON.stringify({
          status: "ok",
          file: file_path,
          total_lines: lines.length,
          showing: `${start + 1}-${end}`,
          content: result
        }) }],
        details: {}
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], details: {} };
    }
  }
};

export default tool;