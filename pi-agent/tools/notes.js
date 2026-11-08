import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readNotes, writeNotes } from "../lib/helpers.js";
import { checkPermission } from "../lib/users.js";

const NOTES_MAX_TEXT_LENGTH = 500;
const NOTES_MAX_LIST = 20;

export default defineTool({
  name: "notes",
  label: "Notes",
  description: "Verwaltet persönliche Notizen. Actions: add, list, delete, delete_all.",
  parameters: Type.Object({
    action: Type.String({ description: "add, list, delete, delete_all" }),
    text: Type.Optional(Type.String({ description: "Notiztext (add) oder Suchbegriff (delete)" })),
  }),
  execute: async (_toolCallId, { action, text }) => {
    const denied = checkPermission("notes");
    if (denied) return denied;
    try {
      switch (action) {
        case "add": {
          if (!text || text.trim().length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein Text angegeben" }) }], details: {} };
          let noteText = text.trim();
          let truncated = false;
          if (noteText.length > NOTES_MAX_TEXT_LENGTH) { noteText = noteText.slice(0, NOTES_MAX_TEXT_LENGTH); truncated = true; }
          const notes = readNotes();
          const entry = { text: noteText, created_at: new Date().toISOString() };
          notes.push(entry);
          writeNotes(notes);
          const msg = truncated ? `Notiz gespeichert (gekürzt): ${noteText.slice(0, 50)}...` : `Notiz gespeichert: ${noteText.slice(0, 80)}${noteText.length > 80 ? "..." : ""}`;
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: msg, note: entry }) }], details: {} };
        }
        case "list": {
          const notes = readNotes();
          if (notes.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine Notizen gespeichert", notes: [] }) }], details: {} };
          const sorted = [...notes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          const limited = sorted.slice(0, NOTES_MAX_LIST);
          const formatted = limited.map((n, i) => `${i + 1}. ${n.text}`).join(". ");
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${notes.length} Notizen: ${formatted}`, notes: limited, total: notes.length }) }], details: {} };
        }
        case "delete": {
          if (!text || text.trim().length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein Suchbegriff" }) }], details: {} };
          const searchTerm = text.trim().toLowerCase();
          const notes = readNotes();
          const matchingIndices = notes.map((n, i) => n.text.toLowerCase().includes(searchTerm) ? i : -1).filter(i => i !== -1);
          if (matchingIndices.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "not_found", message: "Keine passende Notiz gefunden" }) }], details: {} };
          const mostRecentIdx = matchingIndices.reduce((best, idx) => new Date(notes[idx].created_at).getTime() > new Date(notes[best].created_at).getTime() ? idx : best, matchingIndices[0]);
          const removed = notes.splice(mostRecentIdx, 1)[0];
          writeNotes(notes);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Notiz gelöscht: ${removed.text}` }) }], details: {} };
        }
        case "delete_all": {
          const notes = readNotes();
          writeNotes([]);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: notes.length === 0 ? "Keine Notizen vorhanden" : `Alle ${notes.length} Notizen gelöscht` }) }], details: {} };
        }
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Verfügbar: add, list, delete, delete_all" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Notizen-Fehler: ${e.message}` }], details: {} };
    }
  },
});
