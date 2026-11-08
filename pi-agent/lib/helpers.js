/**
 * Shared Helpers
 * Date/time parsing, calendar helpers, ICS generation utilities.
 */
import fs from "fs";
import path from "path";
import { getCurrentUserId, getUserWorkspacePath, getSharedGroupPaths } from "./users.js";

// --- German Date Parsing ---

export function parseGermanDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const input = dateStr.trim().toLowerCase();
  if (!input) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (input === "heute") return new Date(today);
  if (input === "morgen") {
    const d = new Date(today); d.setDate(d.getDate() + 1); return d;
  }
  if (input === "übermorgen" || input === "uebermorgen") {
    const d = new Date(today); d.setDate(d.getDate() + 2); return d;
  }

  const weekdays = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
  const weekdayIndex = weekdays.indexOf(input);
  if (weekdayIndex !== -1) {
    const todayWeekday = today.getDay();
    let diff = weekdayIndex - todayWeekday;
    if (diff <= 0) diff += 7;
    const d = new Date(today); d.setDate(d.getDate() + diff); return d;
  }

  // TT.MM.YYYY
  const fullMatch = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (fullMatch) {
    const day = parseInt(fullMatch[1], 10);
    const month = parseInt(fullMatch[2], 10) - 1;
    const year = parseInt(fullMatch[3], 10);
    const d = new Date(year, month, day, 0, 0, 0, 0);
    if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) return d;
    return null;
  }

  // TT.MM.
  const shortMatch = input.match(/^(\d{1,2})\.(\d{1,2})\.$/);
  if (shortMatch) {
    const day = parseInt(shortMatch[1], 10);
    const month = parseInt(shortMatch[2], 10) - 1;
    let year = today.getFullYear();
    let d = new Date(year, month, day, 0, 0, 0, 0);
    if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
    if (d < today) {
      year += 1;
      d = new Date(year, month, day, 0, 0, 0, 0);
      if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
    }
    return d;
  }

  return null;
}

// --- German Time Parsing ---

export function parseGermanTime(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const trimmed = timeStr.trim();
  if (trimmed.length === 0) return null;

  const hhmmMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmMatch) {
    const hours = parseInt(hhmmMatch[1], 10);
    const minutes = parseInt(hhmmMatch[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
  }

  const umUhrMatch = trimmed.match(/^um\s+(\d{1,2})\s+Uhr$/i);
  if (umUhrMatch) {
    const hours = parseInt(umUhrMatch[1], 10);
    if (hours < 0 || hours > 23) return null;
    return { hours, minutes: 0 };
  }

  const halbMatch = trimmed.match(/^um\s+halb\s+(\d{1,2})$/i);
  if (halbMatch) {
    const hourRef = parseInt(halbMatch[1], 10);
    if (hourRef < 1 || hourRef > 24) return null;
    const hours = (hourRef - 1 + 24) % 24;
    return { hours, minutes: 30 };
  }

  return null;
}

// --- Calendar Helpers ---

export function getCalendarFilePath() {
  const userId = getCurrentUserId();
  return path.join(getUserWorkspacePath(userId), "calendar.ics");
}

export function getAllCalendarFiles() {
  const userId = getCurrentUserId();
  const files = [{ path: getCalendarFilePath(), label: "Persönlich" }];
  const groups = getSharedGroupPaths(userId);
  for (const group of groups) {
    if (group.calendarPath) {
      files.push({ path: group.calendarPath, label: group.description || group.id });
    }
  }
  return files;
}

export function generateEventUID() {
  const randomStr = Math.random().toString(36).slice(2);
  return `${Date.now()}-${randomStr}@ribo`;
}

export function generateVEvent({ title, startDate, endDate, allDay, reminders }) {
  const uid = generateEventUID();
  const now = new Date();
  const dtstamp =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") + "T" +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0") + "Z";

  let dtstart, dtend;

  if (allDay) {
    const startStr = startDate.getFullYear().toString() + String(startDate.getMonth() + 1).padStart(2, "0") + String(startDate.getDate()).padStart(2, "0");
    const endDate_ = endDate || new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    const endStr = endDate_.getFullYear().toString() + String(endDate_.getMonth() + 1).padStart(2, "0") + String(endDate_.getDate()).padStart(2, "0");
    dtstart = `DTSTART;VALUE=DATE:${startStr}`;
    dtend = `DTEND;VALUE=DATE:${endStr}`;
  } else {
    const formatDateTime = (d) =>
      d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "T" +
      String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + String(d.getSeconds()).padStart(2, "0");
    const endDate_ = endDate || new Date(startDate.getTime() + 60 * 60 * 1000);
    dtstart = `DTSTART:${formatDateTime(startDate)}`;
    dtend = `DTEND:${formatDateTime(endDate_)}`;
  }

  const lines = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${dtstamp}`, dtstart, dtend, `SUMMARY:${title}`];

  if (reminders && Array.isArray(reminders) && reminders.length > 0) {
    for (const minutes of reminders) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const days = Math.floor(hours / 24);
      const remainHours = hours % 24;
      let duration;
      if (days > 0 && remainHours === 0 && mins === 0) duration = `-P${days}D`;
      else if (days > 0) duration = `-P${days}DT${remainHours}H${mins}M`;
      else if (remainHours > 0 && mins === 0) duration = `-PT${remainHours}H`;
      else if (remainHours > 0) duration = `-PT${remainHours}H${mins}M`;
      else duration = `-PT${mins}M`;

      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${title}`, `TRIGGER:${duration}`, "END:VALARM");
    }
  }

  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

export function appendEventToIcs(filePath, veventStr) {
  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    const endTag = "END:VCALENDAR";
    const lastIdx = content.lastIndexOf(endTag);
    if (lastIdx === -1) {
      const newContent = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Ribo//Calendar//DE\r\n" + content + veventStr + "\r\n" + "END:VCALENDAR\r\n";
      fs.writeFileSync(resolvedPath, newContent, "utf-8");
    } else {
      const before = content.slice(0, lastIdx);
      const after = content.slice(lastIdx);
      fs.writeFileSync(resolvedPath, before + veventStr + "\r\n" + after, "utf-8");
    }
  } else {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Ribo//Calendar//DE\r\n" + veventStr + "\r\n" + "END:VCALENDAR\r\n", "utf-8");
  }
}

// --- Notes Helpers ---

export function getNotesFilePath() {
  const userId = getCurrentUserId();
  return path.join(getUserWorkspacePath(userId), "notes.json");
}

export function readNotes() {
  const notesPath = getNotesFilePath();
  try {
    if (!fs.existsSync(notesPath)) {
      fs.mkdirSync(path.dirname(notesPath), { recursive: true });
      fs.writeFileSync(notesPath, "[]", "utf-8");
      return [];
    }
    const content = fs.readFileSync(notesPath, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error("Notes file is not an array");
    return parsed;
  } catch (e) {
    if (e instanceof SyntaxError || (e.message && e.message.includes("not an array"))) {
      fs.writeFileSync(notesPath, "[]", "utf-8");
      return [];
    }
    throw e;
  }
}

export function writeNotes(notes) {
  const notesPath = getNotesFilePath();
  fs.mkdirSync(path.dirname(notesPath), { recursive: true });
  fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), "utf-8");
}

// --- Lists Helpers ---

export function getListsDir() {
  const userId = getCurrentUserId();
  return path.join(getUserWorkspacePath(userId), "lists");
}

export function deriveFilename(listName) {
  return listName.trim().toLowerCase().replace(/\s+/g, '-');
}

export function getSharedListPath(listName) {
  const userId = getCurrentUserId();
  const groups = getSharedGroupPaths(userId);
  const normalizedName = listName.trim().toLowerCase();
  for (const group of groups) {
    for (const sharedListName of group.sharedLists) {
      if (sharedListName.toLowerCase() === normalizedName) {
        const filename = deriveFilename(sharedListName);
        return path.join(group.listsDir, `${filename}.json`);
      }
    }
  }
  return null;
}

export function getListPath(listName) {
  const sharedPath = getSharedListPath(listName);
  if (sharedPath) return sharedPath;
  const filename = deriveFilename(listName);
  return path.join(getListsDir(), `${filename}.json`);
}

export function ensureListsDir() {
  fs.mkdirSync(getListsDir(), { recursive: true });
}

export function readList(listName) {
  const filePath = getListPath(listName);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) throw new Error("List file is not an array");
  return parsed;
}

export function writeList(listName, items) {
  ensureListsDir();
  const filePath = getListPath(listName);
  // Ensure shared list directories exist
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf-8");
}

export function listExists(listName) {
  return fs.existsSync(getListPath(listName));
}

export function deleteListFile(listName) {
  fs.unlinkSync(getListPath(listName));
}

export function getAllListNames() {
  ensureListsDir();
  const personalDir = getListsDir();
  const files = fs.readdirSync(personalDir).filter(f => f.endsWith('.json'));
  const names = files.map(f => f.replace(/\.json$/, ''));

  const userId = getCurrentUserId();
  const groups = getSharedGroupPaths(userId);
  for (const group of groups) {
    if (fs.existsSync(group.listsDir)) {
      const sharedFiles = fs.readdirSync(group.listsDir).filter(f => f.endsWith('.json'));
      for (const sf of sharedFiles) {
        const name = sf.replace(/\.json$/, '');
        if (!names.includes(name)) names.push(name);
      }
    }
  }
  return names;
}

// --- Godot Helpers ---

export function getGodotProjectDir() {
  const userId = getCurrentUserId();
  return path.join(getUserWorkspacePath(userId), "godot-project");
}

// --- ImageGen Helpers ---

export function getImagegenOutputDir() {
  const userId = getCurrentUserId();
  return path.join(getUserWorkspacePath(userId), "generated-images");
}

// --- Flashcards Helpers ---

export function getFlashcardsDir() {
  const userId = getCurrentUserId();
  return path.join(getUserWorkspacePath(userId), "flashcards");
}
