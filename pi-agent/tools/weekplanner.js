import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import { getAllCalendarFiles, getAllListNames, readList } from "../lib/helpers.js";
import { checkPermission } from "../lib/users.js";

function isAllDayEvent(event) {
  if (event.datetype === "date") return true;
  if (!event.start || !event.end) return false;
  const start = new Date(event.start); const end = new Date(event.end);
  return start.getHours() === 0 && start.getMinutes() === 0 && end.getHours() === 0 && end.getMinutes() === 0 && (end - start) >= 86400000;
}

function eventOccursOnDate(event, targetDate) {
  const start = new Date(targetDate); start.setHours(0, 0, 0, 0);
  const end = new Date(targetDate); end.setHours(23, 59, 59, 999);
  return new Date(event.start) <= end && new Date(event.end || event.start) > start;
}

function formatEventForTTS(event) {
  if (isAllDayEvent(event)) return `Ganztagig: ${event.summary || "Termin"}`;
  const s = new Date(event.start);
  const time = s.getMinutes() === 0 ? `Um ${s.getHours()} Uhr` : `Um ${s.getHours()} Uhr ${s.getMinutes()}`;
  return `${time}: ${event.summary || "Termin"}`;
}

function getEventsForDate(parsedData, targetDate) {
  const events = [];
  for (const key of Object.keys(parsedData)) {
    const event = parsedData[key];
    if (event.type !== "VEVENT") continue;
    if (eventOccursOnDate(event, targetDate)) {
      events.push({ summary: event.summary, start: new Date(event.start), end: new Date(event.end || event.start), datetype: event.datetype });
    }
  }
  events.sort((a, b) => { if (isAllDayEvent(a) && !isAllDayEvent(b)) return -1; if (!isAllDayEvent(a) && isAllDayEvent(b)) return 1; return a.start - b.start; });
  return events;
}

export default defineTool({
  name: "weekplanner",
  label: "Weekplanner",
  description: "Zeigt Wochenübersicht: Kalender + offene Listen. Action: overview.",
  parameters: Type.Object({
    action: Type.String({ description: "overview" }),
    include_lists: Type.Optional(Type.Boolean()),
  }),
  execute: async (_toolCallId, { action, include_lists }) => {
    const denied = checkPermission("weekplanner");
    if (denied) return denied;
    try {
      if (action !== "overview") return { content: [{ type: "text", text: JSON.stringify({ error: "Nutze overview" }) }], details: {} };
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
      const parts = [];

      // Read all calendars (personal + shared groups)
      const ical = (await import("node-ical")).default;
      const calendarFiles = getAllCalendarFiles();
      const parsedCalendars = [];
      for (const cal of calendarFiles) {
        if (fs.existsSync(cal.path)) {
          try { parsedCalendars.push(ical.sync.parseFile(cal.path)); } catch (_) {}
        }
      }

      let totalEvents = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(today); d.setDate(d.getDate() + i);
        const name = i === 0 ? "Heute" : i === 1 ? "Morgen" : weekdays[d.getDay()];
        const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
        // Collect events from all calendars for this day
        const events = parsedCalendars.flatMap(pd => getEventsForDate(pd, d));
        events.sort((a, b) => a.start - b.start);
        totalEvents += events.length;
        parts.push(events.length > 0 ? `${name} (${dateStr}): ${events.map(e => formatEventForTTS(e)).join("; ")}` : `${name} (${dateStr}): frei`);
      }

      let listsSummary = "";
      if (include_lists !== false) {
        const listNames = getAllListNames();
        const listParts = [];
        for (const name of listNames) {
          try { const items = readList(name); if (items?.length > 0) listParts.push(`${name} (${items.length})`); } catch (_) {}
        }
        if (listParts.length > 0) listsSummary = `\nListen: ${listParts.join(", ")}`;
      }

      const message = totalEvents === 0 ? `Keine Termine diese Woche.${listsSummary}` : `${parts.join(". ")}${listsSummary}`;
      return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message }) }], details: {} };
    } catch (e) { return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {} }; }
  },
});
