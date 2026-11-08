import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { getCurrentUserId, getUserWorkspacePath } from "../lib/users.js";

function getMemoryDir() {
  const userId = getCurrentUserId();
  return path.join(getUserWorkspacePath(userId), "memory");
}

function getMemoryFile() {
  return path.join(getMemoryDir(), "long_term.json");
}

function getHabitsFile() {
  return path.join(getMemoryDir(), "habits_log.json");
}

function readMemory() {
  const filePath = getMemoryFile();
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (_) { return []; }
}

function writeMemory(entries) {
  const dir = getMemoryDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getMemoryFile(), JSON.stringify(entries, null, 2), "utf-8");
}

function readHabitsLog() {
  const filePath = getHabitsFile();
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (_) { return []; }
}

function writeHabitsLog(log) {
  const dir = getMemoryDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getHabitsFile(), JSON.stringify(log, null, 2), "utf-8");
}

export default defineTool({
  name: "memory",
  label: "Memory",
  description: "Langzeitgedächtnis — speichert wichtige Fakten, Zusammenfassungen und Präferenzen über den Nutzer. Nutze dieses Tool proaktiv wenn der Nutzer etwas Wichtiges erwähnt das für die Zukunft relevant ist. Actions: remember (Fakt speichern), recall (Erinnerungen abrufen), forget (Erinnerungen löschen), forget_all (alles vergessen), summarize_session (aktuelle Sitzung zusammenfassen und speichern), log_interaction (Interaktion für Gewohnheiten-Analyse loggen).",
  parameters: Type.Object({
    action: Type.String({ description: "remember, recall, forget, forget_all, summarize_session, log_interaction" }),
    text: Type.Optional(Type.String({ description: "Fakt/Zusammenfassung zum Merken (remember, summarize_session) oder Suchbegriff (forget, recall)" })),
    category: Type.Optional(Type.String({ description: "Kategorie: preference, fact, session_summary, interest, relationship, habit" })),
    tool_used: Type.Optional(Type.String({ description: "Tool-Name für log_interaction (z.B. weather, calendar)" })),
  }),
  execute: async (_toolCallId, { action, text, category, tool_used }) => {
    try {
      switch (action) {
        case "remember": {
          if (!text?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "text erforderlich" }) }], details: {} };

          const entries = readMemory();
          const entry = {
            id: Math.random().toString(36).slice(2, 10),
            text: text.trim(),
            category: category || "fact",
            created_at: new Date().toISOString(),
          };
          entries.push(entry);

          // Keep max 100 entries (oldest get removed)
          if (entries.length > 100) {
            entries.splice(0, entries.length - 100);
          }

          writeMemory(entries);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Gemerkt: "${text.trim().slice(0, 60)}${text.trim().length > 60 ? "..." : ""}"` }) }], details: {} };
        }

        case "recall": {
          const entries = readMemory();
          if (entries.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine Erinnerungen gespeichert.", memories: [] }) }], details: {} };
          }

          let filtered = entries;

          // Filter by search term if provided
          if (text?.trim()) {
            const search = text.trim().toLowerCase();
            filtered = entries.filter(e => e.text.toLowerCase().includes(search) || (e.category && e.category.toLowerCase().includes(search)));
          }

          // Filter by category if provided
          if (category) {
            filtered = filtered.filter(e => e.category === category);
          }

          if (filtered.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: text ? `Keine Erinnerungen zu "${text}" gefunden.` : "Keine Erinnerungen in dieser Kategorie.", memories: [] }) }], details: {} };
          }

          // Return most recent first
          filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          const limited = filtered.slice(0, 20);
          const formatted = limited.map(e => `[${e.category}] ${e.text}`).join("\n");

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${filtered.length} Erinnerung(en):\n${formatted}`, memories: limited, total: filtered.length }) }], details: {} };
        }

        case "forget": {
          if (!text?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Suchbegriff erforderlich" }) }], details: {} };

          const entries = readMemory();
          const search = text.trim().toLowerCase();
          const before = entries.length;
          const remaining = entries.filter(e => !e.text.toLowerCase().includes(search));
          const removed = before - remaining.length;

          if (removed === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Keine Erinnerungen zu "${text}" gefunden.` }) }], details: {} };
          }

          writeMemory(remaining);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${removed} Erinnerung(en) zu "${text}" gelöscht.` }) }], details: {} };
        }

        case "forget_all": {
          const entries = readMemory();
          const count = entries.length;
          writeMemory([]);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: count > 0 ? `Alle ${count} Erinnerungen gelöscht.` : "Keine Erinnerungen vorhanden." }) }], details: {} };
        }

        case "summarize_session": {
          if (!text?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Zusammenfassung erforderlich" }) }], details: {} };

          const entries = readMemory();

          // Remove old session summaries (keep only last 5)
          const nonSummaries = entries.filter(e => e.category !== "session_summary");
          const summaries = entries.filter(e => e.category === "session_summary");
          const recentSummaries = summaries.slice(-4); // Keep last 4, add new one = 5

          const entry = {
            id: Math.random().toString(36).slice(2, 10),
            text: text.trim(),
            category: "session_summary",
            created_at: new Date().toISOString(),
          };

          const updated = [...nonSummaries, ...recentSummaries, entry];
          writeMemory(updated);

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Session-Zusammenfassung gespeichert." }) }], details: {} };
        }

        case "log_interaction": {
          if (!tool_used?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "tool_used erforderlich" }) }], details: {} };

          const log = readHabitsLog();
          const now = new Date();

          log.push({
            tool: tool_used.trim(),
            timestamp: now.toISOString(),
            weekday: now.toLocaleDateString("de-DE", { weekday: "long" }),
            hour: now.getHours(),
          });

          // Keep last 500 entries
          if (log.length > 500) {
            log.splice(0, log.length - 500);
          }

          writeHabitsLog(log);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", logged: true }) }], details: {} };
        }

        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Verfügbar: remember, recall, forget, forget_all, summarize_session, log_interaction" }) }], details: {} };
      }
    } catch (e) {
      console.error(`❌ Memory Tool error (${action}):`, e.message);
      return { content: [{ type: "text", text: `Error: Gedächtnis-Fehler: ${e.message}` }], details: {} };
    }
  },
});
