import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { resolveTargetDayIndex } from "../weather-helpers.js";
import { parseGermanDate, parseGermanTime, getCalendarFilePath, getAllCalendarFiles, generateVEvent, appendEventToIcs } from "../lib/helpers.js";
import { checkPermission } from "../lib/users.js";

function resolveCalendarTargetDate(day) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (!day || day.toLowerCase() === "heute") return today;
  const dayIndex = resolveTargetDayIndex(day);
  if (dayIndex === -1) return null;
  const target = new Date(today); target.setDate(target.getDate() + dayIndex);
  return target;
}

function formatCalendarDayLabel(day) {
  if (!day || day.toLowerCase() === "heute") return "heute";
  if (day.toLowerCase() === "morgen") return "morgen";
  if (day.toLowerCase() === "übermorgen" || day.toLowerCase() === "uebermorgen") return "übermorgen";
  return day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
}

function isAllDayEvent(event) {
  if (event.datetype === "date") return true;
  if (!event.start || !event.end) return false;
  const s = new Date(event.start); const e = new Date(event.end);
  return s.getHours() === 0 && s.getMinutes() === 0 && e.getHours() === 0 && e.getMinutes() === 0 && (e - s) >= 86400000;
}

function eventOccursOnDate(event, targetDate) {
  const ts = new Date(targetDate); ts.setHours(0, 0, 0, 0);
  const te = new Date(targetDate); te.setHours(23, 59, 59, 999);
  return new Date(event.start) <= te && new Date(event.end || event.start) > ts;
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
  name: "calendar",
  label: "Calendar",
  description: "Verwaltet Termine. Actions: today, day, add, edit, delete.",
  parameters: Type.Object({
    action: Type.String({ description: "today, day, add, edit, delete" }),
    day: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    date: Type.Optional(Type.String()),
    time: Type.Optional(Type.String()),
    reminders: Type.Optional(Type.String({ description: "Kommagetrennte Minuten (z.B. '1440,60' = 1 Tag + 1h vorher)" })),
  }),
  execute: async (_toolCallId, { action, day, title, date, time, reminders }) => {
    const denied = checkPermission("calendar");
    if (denied) return denied;
    try {
      let targetDate, dayLabel;

      if (action === "today") {
        targetDate = new Date(); targetDate.setHours(0, 0, 0, 0); dayLabel = "heute";
      } else if (action === "day") {
        targetDate = resolveCalendarTargetDate(day);
        if (!targetDate) return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannter Tag" }) }], details: {} };
        dayLabel = formatCalendarDayLabel(day);
      } else if (action === "add") {
        if (!title?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Titel erforderlich" }) }], details: {} };
        let eventTitle = title.trim().slice(0, 200);
        const startDate = parseGermanDate(date);
        if (!startDate) return { content: [{ type: "text", text: JSON.stringify({ error: "Datum nicht erkannt" }) }], details: {} };
        let allDay = true;
        if (time?.trim()) {
          const parsedTime = parseGermanTime(time);
          if (!parsedTime) return { content: [{ type: "text", text: JSON.stringify({ error: "Uhrzeit nicht erkannt" }) }], details: {} };
          startDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
          allDay = false;
        }
        let reminderMinutes = null;
        if (reminders?.trim()) {
          reminderMinutes = reminders.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
          if (reminderMinutes.length === 0) reminderMinutes = null;
        }
        const veventStr = generateVEvent({ title: eventTitle, startDate, endDate: null, allDay, reminders: reminderMinutes });
        appendEventToIcs(getCalendarFilePath(), veventStr);
        const dd = String(startDate.getDate()).padStart(2, "0");
        const mm = String(startDate.getMonth() + 1).padStart(2, "0");
        let confirmation = allDay ? `Termin '${eventTitle}' am ${dd}.${mm}. eingetragen.` : `Termin '${eventTitle}' am ${dd}.${mm}. um ${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getMinutes()).padStart(2, "0")} eingetragen.`;
        if (reminderMinutes?.length) {
          const texts = reminderMinutes.map(m => m >= 1440 ? `${Math.round(m / 1440)} Tag(e)` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}min`);
          confirmation += ` Erinnerungen: ${texts.join(", ")} vorher.`;
        }
        return { content: [{ type: "text", text: JSON.stringify({ result: confirmation }) }], details: {} };
      } else if (action === "delete") {
        if (!title?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Suchbegriff erforderlich" }) }], details: {} };
        const calendarPath = getCalendarFilePath();
        if (!fs.existsSync(calendarPath)) return { content: [{ type: "text", text: JSON.stringify({ result: "Kalender nicht verfügbar." }) }], details: {} };
        const rawContent = fs.readFileSync(calendarPath, "utf-8");
        const lines = rawContent.split(/\r?\n/);
        const searchTerm = title.trim().toLowerCase();
        // Find and remove matching VEVENT block
        let blockStart = -1, blockEnd = -1, foundSummary = "";
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === "BEGIN:VEVENT") blockStart = i;
          if (lines[i].trim().startsWith("SUMMARY:") && lines[i].slice(8).trim().toLowerCase().includes(searchTerm)) foundSummary = lines[i].slice(8).trim();
          if (lines[i].trim() === "END:VEVENT" && foundSummary && blockStart !== -1) { blockEnd = i; break; }
          if (lines[i].trim() === "END:VEVENT" && blockStart !== -1) { blockStart = -1; foundSummary = ""; }
        }
        if (blockStart === -1 || blockEnd === -1) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein passender Termin gefunden" }) }], details: {} };
        const newLines = lines.filter((_, i) => i < blockStart || i > blockEnd);
        fs.writeFileSync(calendarPath, newLines.join("\n"), "utf-8");
        return { content: [{ type: "text", text: JSON.stringify({ result: `Termin '${foundSummary}' gelöscht.` }) }], details: {} };
      } else if (action === "edit") {
        // Simplified edit: delete + re-add approach hint
        return { content: [{ type: "text", text: JSON.stringify({ error: "Für Bearbeitung bitte den alten Termin löschen und neu anlegen (delete + add)" }) }], details: {} };
      } else {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Nutze today, day, add, edit, delete." }) }], details: {} };
      }

      // Query events (today/day) — from all calendars (personal + shared groups)
      const ical = (await import("node-ical")).default;
      const calendarFiles = getAllCalendarFiles();
      const allEvents = [];
      for (const cal of calendarFiles) {
        if (!fs.existsSync(cal.path)) continue;
        try {
          const parsedData = ical.sync.parseFile(cal.path);
          allEvents.push(...getEventsForDate(parsedData, targetDate));
        } catch (_) { /* skip unreadable calendar */ }
      }
      // Sort combined events (all-day first, then by time)
      allEvents.sort((a, b) => {
        if (isAllDayEvent(a) && !isAllDayEvent(b)) return -1;
        if (!isAllDayEvent(a) && isAllDayEvent(b)) return 1;
        return a.start - b.start;
      });
      if (allEvents.length === 0) return { content: [{ type: "text", text: JSON.stringify({ result: `Keine Termine ${dayLabel}.` }) }], details: {} };
      const result = allEvents.map(e => formatEventForTTS(e)).join(". ") + ".";
      return { content: [{ type: "text", text: JSON.stringify({ result }) }], details: {} };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ result: "Kalender-Fehler." }) }], details: {} };
    }
  },
});
