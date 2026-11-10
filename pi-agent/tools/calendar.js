import { atomicWrite, withFileLock } from "../lib/storage.js";
import icalParser from "node-ical";
const parseIcs=icalParser.sync.parseICS;
import { eventsForDate } from "../lib/calendar.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { parseGermanDate, parseGermanTime, getCalendarFilePath, getAllCalendarFiles, generateVEvent, appendEventToIcs } from "../lib/helpers.js";
import { checkPermission } from "../lib/users.js";

function resolveCalendarTargetDate(day) {
  return parseGermanDate(day || "heute");
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

export default defineTool({
  name: "calendar",
  label: "Calendar",
  description: "Verwaltet Termine. Actions: today, day, add, edit, delete.",
  parameters: Type.Object({
    action: Type.String({ description: "today, day, add, edit, delete" }),
    day: Type.Optional(Type.String({description:"Abfragedatum für day: TT.MM.JJJJ, YYYY-MM-DD, heute, morgen oder Wochentag"})),
    title: Type.Optional(Type.String()),
    event_id: Type.Optional(Type.String({description:"UID des Termins aus today/day; bei mehreren Treffern erforderlich"})),
    new_title: Type.Optional(Type.String({description:"Neuer Titel bei edit"})),
    all_day: Type.Optional(Type.Boolean({description:"Bei edit auf ganztägig umstellen"})),
    date: Type.Optional(Type.String({description:"Zieldatum für add/edit: TT.MM.JJJJ oder YYYY-MM-DD"})),
    time: Type.Optional(Type.String()),
    reminders: Type.Optional(Type.String({ description: "Kommagetrennte Minuten (z.B. '1440,60' = 1 Tag + 1h vorher)" })),
  }),
  execute: async (_toolCallId, { action, day, title, event_id, new_title, all_day, date, time, reminders }) => {
    const denied = checkPermission("calendar");
    if (denied) return denied;
    try {
      let targetDate, dayLabel;

      if (action === "today") {
        targetDate = new Date(); targetDate.setHours(0, 0, 0, 0); dayLabel = "heute";
      } else if (action === "day") {
        targetDate = resolveCalendarTargetDate(day ?? date);
        if (!targetDate) return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannter Tag" }) }], details: {} };
        dayLabel = formatCalendarDayLabel(day ?? date);
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
      } else if (["delete","edit"].includes(action)) {
        if(!event_id && !title?.trim()) throw new Error("Titel oder event_id erforderlich");
        const calendarPath=getCalendarFilePath();
        return withFileLock(calendarPath,()=>{
          if(!fs.existsSync(calendarPath)) throw new Error("Kalender nicht verfügbar");
          const content=fs.readFileSync(calendarPath,"utf8").replace(/\r?\n[ \t]/g,"");
          const blocks=[...content.matchAll(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g)];
          const matches=blocks.filter(match=>{
            const uid=match[0].match(/^UID:(.*)$/m)?.[1].trim();
            const summary=match[0].match(/^SUMMARY:(.*)$/m)?.[1].trim();
            return event_id ? uid===event_id : summary?.toLowerCase().includes(title.trim().toLowerCase());
          });
          if(matches.length!==1) throw new Error(matches.length?"Mehrere Termine gefunden; bitte event_id auswählen":"Kein passender Termin gefunden");
          const match=matches[0];
          let replacement="";
          if(action==="edit") {
            if(new_title===undefined && date===undefined && time===undefined && all_day===undefined && reminders===undefined) throw new Error("Änderung erforderlich: new_title, date, time, all_day oder reminders");
            // Parsed once synchronously; keep UID, recurrence rules and unrelated fields.
            const parsed=parseIcs(content);
            const uid=match[0].match(/^UID:(.*)$/m)?.[1].trim();
            const event=parsed[uid];
            if(!event) throw new Error("Termin konnte nicht gelesen werden");
            const startDate=date!==undefined?parseGermanDate(date):new Date(event.start);
            if(!startDate) throw new Error("Datum nicht erkannt");
            let allDay=all_day===undefined?event.datetype==="date":all_day;
            if(time!==undefined && time.trim()) {
              const parsedTime=parseGermanTime(time);
              if(!parsedTime) throw new Error("Uhrzeit nicht erkannt");
              startDate.setHours(parsedTime.hours,parsedTime.minutes,0,0);allDay=false;
            } else if(!allDay) {
              const original=new Date(event.start);startDate.setHours(original.getHours(),original.getMinutes(),0,0);
            }
            if(allDay) startDate.setHours(0,0,0,0);
            let endDate;
            if(allDay) {endDate=new Date(startDate);endDate.setDate(endDate.getDate()+1);}
            else endDate=new Date(+startDate+Math.max(60000,+new Date(event.end||event.start)-+new Date(event.start)||3600000));
            const reminderMinutes=reminders===undefined?null:reminders.split(",").map(Number).filter(n=>Number.isInteger(n)&&n>0);
            const generated=generateVEvent({title:new_title?.trim() || event.summary,startDate,endDate,allDay,reminders:reminderMinutes});
            const properties=generated.split(/\r?\n/).filter(line=>/^(?:DTSTART|DTEND|DTSTAMP|SUMMARY)[;:]/.test(line));
            let original=match[0];
            if(reminders!==undefined) original=original.replace(/BEGIN:VALARM\r?\n[\s\S]*?END:VALARM\r?\n?/g,"");
            original=original.split(/\r?\n/).filter(line=>! /^(?:DTSTART|DTEND|DTSTAMP|SUMMARY|DURATION)[;:]/.test(line));
            original.splice(1,0,...properties);
            if(reminders!==undefined) original.splice(original.length-1,0,...(generated.match(/BEGIN:VALARM[\s\S]*?END:VALARM/g)||[]));
            replacement=original.join("\r\n");
          }
          atomicWrite(calendarPath,content.slice(0,match.index)+replacement+content.slice(match.index+match[0].length));
          return {content:[{type:"text",text:JSON.stringify({status:"ok",result:action==="edit"?"Termin aktualisiert":"Termin gelöscht"})}],details:{}};
        });
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
          allEvents.push(...eventsForDate(parsedData, targetDate));
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
      return { content: [{ type: "text", text: JSON.stringify({ result, events: allEvents }) }], details: {} };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], details: {} };
    }
  },
});
