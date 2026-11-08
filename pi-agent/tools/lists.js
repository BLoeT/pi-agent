import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readList, writeList, listExists, deleteListFile, getAllListNames } from "../lib/helpers.js";
import { checkPermission } from "../lib/users.js";

export default defineTool({
  name: "lists",
  label: "Lists",
  description: "Verwaltet Listen (Einkaufsliste, ToDo etc.). Actions: create_list, rename_list, delete_list, add_item, update_item, remove_item, show_list, show_all_lists.",
  parameters: Type.Object({
    action: Type.String({ description: "create_list, rename_list, delete_list, add_item, update_item, remove_item, show_list, show_all_lists" }),
    list_name: Type.Optional(Type.String({ description: "Name der Liste" })),
    new_name: Type.Optional(Type.String({ description: "Neuer Listenname (rename)" })),
    item: Type.Optional(Type.String({ description: "Eintragsname" })),
    quantity: Type.Optional(Type.Number({ description: "Menge (optional)" })),
  }),
  execute: async (_toolCallId, { action, list_name, new_name, item, quantity }) => {
    const denied = checkPermission("lists");
    if (denied) return denied;
    try {
      switch (action) {
        case "create_list": {
          if (!list_name || !list_name.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein Listenname" }) }], details: {} };
          if (listExists(list_name)) return { content: [{ type: "text", text: JSON.stringify({ error: `"${list_name}" existiert bereits` }) }], details: {} };
          writeList(list_name, []);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Liste "${list_name}" erstellt` }) }], details: {} };
        }
        case "rename_list": {
          if (!list_name?.trim() || !new_name?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Listenname und neuer Name erforderlich" }) }], details: {} };
          if (!listExists(list_name)) return { content: [{ type: "text", text: JSON.stringify({ error: `"${list_name}" existiert nicht` }) }], details: {} };
          if (listExists(new_name)) return { content: [{ type: "text", text: JSON.stringify({ error: `"${new_name}" existiert bereits` }) }], details: {} };
          const items = readList(list_name);
          writeList(new_name, items);
          deleteListFile(list_name);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${list_name}" umbenannt in "${new_name}"` }) }], details: {} };
        }
        case "delete_list": {
          if (!list_name?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein Listenname" }) }], details: {} };
          if (!listExists(list_name)) return { content: [{ type: "text", text: JSON.stringify({ error: `"${list_name}" existiert nicht` }) }], details: {} };
          deleteListFile(list_name);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${list_name}" gelöscht` }) }], details: {} };
        }
        case "add_item": {
          if (!list_name?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein Listenname" }) }], details: {} };
          if (!item?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein Eintragsname" }) }], details: {} };
          const trimmedItem = item.trim();
          const hasQty = quantity != null && quantity > 0;
          const qty = hasQty ? Math.floor(quantity) : undefined;
          let items = readList(list_name);
          if (items === null) items = [];
          const existingIdx = items.findIndex(e => e.item.toLowerCase() === trimmedItem.toLowerCase());
          if (existingIdx !== -1) {
            if ("quantity" in items[existingIdx] && hasQty) {
              items[existingIdx].quantity += qty;
              writeList(list_name, items);
              return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${items[existingIdx].item}" ist jetzt ${items[existingIdx].quantity}x` }) }], details: {} };
            }
            writeList(list_name, items);
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${items[existingIdx].item}" ist bereits auf der Liste` }) }], details: {} };
          }
          const newEntry = { item: trimmedItem };
          if (hasQty) newEntry.quantity = qty;
          items.push(newEntry);
          writeList(list_name, items);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${hasQty ? qty + "x " : ""}"${trimmedItem}" hinzugefügt` }) }], details: {} };
        }
        case "update_item": {
          if (!list_name?.trim() || !item?.trim() || quantity == null || quantity < 1) return { content: [{ type: "text", text: JSON.stringify({ error: "Listenname, Item und Menge erforderlich" }) }], details: {} };
          if (!listExists(list_name)) return { content: [{ type: "text", text: JSON.stringify({ error: `"${list_name}" existiert nicht` }) }], details: {} };
          const items = readList(list_name);
          const idx = items.findIndex(e => e.item.toLowerCase() === item.trim().toLowerCase());
          if (idx === -1) return { content: [{ type: "text", text: JSON.stringify({ error: `"${item}" nicht gefunden` }) }], details: {} };
          items[idx].quantity = Math.floor(quantity);
          writeList(list_name, items);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${items[idx].item}" auf ${items[idx].quantity}x aktualisiert` }) }], details: {} };
        }
        case "remove_item": {
          if (!list_name?.trim() || !item?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Listenname und Item erforderlich" }) }], details: {} };
          if (!listExists(list_name)) return { content: [{ type: "text", text: JSON.stringify({ error: `"${list_name}" existiert nicht` }) }], details: {} };
          const items = readList(list_name);
          const idx = items.findIndex(e => e.item.toLowerCase() === item.trim().toLowerCase());
          if (idx === -1) return { content: [{ type: "text", text: JSON.stringify({ error: `"${item}" nicht gefunden` }) }], details: {} };
          const removed = items.splice(idx, 1)[0];
          writeList(list_name, items);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${removed.item}" entfernt` }) }], details: {} };
        }
        case "show_list": {
          if (!list_name?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein Listenname" }) }], details: {} };
          if (!listExists(list_name)) return { content: [{ type: "text", text: JSON.stringify({ error: `"${list_name}" existiert nicht` }) }], details: {} };
          const items = readList(list_name);
          if (items.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${list_name}" ist leer`, items: [] }) }], details: {} };
          const formatted = items.map(e => "quantity" in e ? `${e.quantity}x ${e.item}` : e.item).join(", ");
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${list_name}: ${formatted}`, items }) }], details: {} };
        }
        case "show_all_lists": {
          const names = getAllListNames();
          if (names.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine Listen vorhanden", lists: [] }) }], details: {} };
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Listen: ${names.join(", ")}`, lists: names }) }], details: {} };
        }
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Listen-Fehler: ${e.message}` }], details: {} };
    }
  },
});
