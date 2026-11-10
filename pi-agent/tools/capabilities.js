import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getCurrentUserId, getUserByName, userHasPermission } from "../lib/users.js";
import { PLUGINS_DIR, userCanUsePlugin, getPluginInfo } from "../lib/plugins.js";
import fs from "fs";
import path from "path";

// Feature-Beschreibungen je Permission (nur was der User darf, wird gezeigt)
const FEATURES = [
  { perm: "calendar",    text: "📅 Termine verwalten (Kalender, Erinnerungen)" },
  { perm: "notes",       text: "📝 Notizen merken und abrufen" },
  { perm: "lists",       text: "🛒 Listen führen (Einkaufsliste, ToDo)" },
  { perm: "weekplanner", text: "🗓️ Wochenübersicht (Termine + Listen)" },
  { perm: "smart_home",  text: "🏠 Smart-Home steuern (Licht, Geräte)" },
  { perm: "music",       text: "🎵 Musik und Radio abspielen" },
  { perm: "timer",       text: "⏲️ Timer stellen" },
  { perm: "routines",    text: "✨ Routinen ausführen und anlegen (z.B. Gute Nacht)" },
  { perm: "weather",     text: "🌤️ Wetter abfragen (aktuell + Vorhersage)" },
  { perm: "news",        text: "📰 Nachrichten vorlesen" },
  { perm: "search",      text: "🔍 Im Web suchen" },
  { perm: "videogen", text: "🎬 Videos generieren" },
  { perm: "proactive_rules", text: "⏰ Geplante Ribo-Aufträge verwalten" },
  { perm: "imagegen",    text: "🎨 Bilder generieren" },
  { perm: "flashcards",  text: "🎴 Vokabeln/Fakten lernen (Lernkarten)" },
  { perm: "cooking",     text: "🍳 Rezepte finden und Zutaten auf die Liste setzen" },
  { perm: "expenses",    text: "💶 Ausgaben erfassen und auswerten" },
  { perm: "projects",    text: "💻 Code/Apps schreiben und als ZIP schicken" },
  { perm: "files",       text: "📎 Dateien aus dem Workspace schicken/auflisten" },
  { perm: "admin",       text: "👤 Nutzer verwalten und geprüfte Plugins anzeigen (Admin)" },
];

// Immer verfügbar (nicht permission-geschützt)
const ALWAYS = [
  "🖼️ Eigene Upload-Bilder benennen, anzeigen und löschen",
  "💬 Mich an deinen Kommunikationsstil anpassen (Persönlichkeit)",
  "🧠 Mir wichtige Dinge über dich merken (Langzeitgedächtnis)",
  "📷 Fotos verstehen (schick mir ein Bild)",
];

function listUserPlugins(userId) {
  const out = [];
  try {
    if (!fs.existsSync(PLUGINS_DIR)) return out;
    for (const f of fs.readdirSync(PLUGINS_DIR)) {
      if (!f.endsWith(".js")) continue;
      const canUse = userHasPermission(userId,"admin") && userCanUsePlugin(f,userId);
      if (!canUse) continue;
      try {
        const info=getPluginInfo(f);
        out.push(`🔌 ${info.name}${info.description ? " — " + info.description.slice(0,60) : ""}`);
      } catch (_) { out.push(`🔌 ${f}`); }
    }
  } catch (_) { /* ignore */ }
  return out;
}

export default defineTool({
  name: "capabilities",
  label: "Capabilities",
  description: "Listet auf welche Funktionen der aktuelle Nutzer nutzen darf. Nutze dies wenn der Nutzer fragt 'Was kannst du?', 'Was hast du für Funktionen?', 'Womit kannst du mir helfen?' o.ä. Die Liste ist bereits nach den Rechten des Nutzers gefiltert.",
  parameters: Type.Object({}),
  execute: async () => {
    const userId = getCurrentUserId();
    const user = getUserByName(userId);
    const name = user?.name || userId;

    const allowed = FEATURES.filter(f => userHasPermission(userId, f.perm)).map(f => f.text);
    const plugins = listUserPlugins(userId);

    const sections = [];
    sections.push(...allowed);
    sections.push(...ALWAYS);
    if (plugins.length > 0) sections.push(...plugins);

    const message = `Hallo ${name}, das kann ich für dich tun:\n\n${sections.join("\n")}`;
    return {
      content: [{ type: "text", text: JSON.stringify({ status: "ok", message, count: sections.length }) }],
      details: {},
    };
  },
});
