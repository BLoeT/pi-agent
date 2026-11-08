import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import { checkPermission, getCurrentUserId } from "../lib/users.js";
import { mapWmoCodeToCondition, resolveTargetDayIndex, formatDayLabel, geocodeLocation } from "../weather-helpers.js";
import Parser from "rss-parser";

const HA_SERVICE_URL = process.env.HA_SERVICE_URL || "http://ha-service:8082";
const RIBO_SERVICE_URL = process.env.RIBO_SERVICE_URL || process.env.MUSIC_SERVICE_URL || "http://host.docker.internal:8085";
const ROUTINES_FILE = process.env.ROUTINES_FILE || path.join("/workspace", "routines.yaml");
const WEATHER_LOCATION = process.env.WEATHER_LOCATION || "52.52,13.405";

// ─── Routinen-Config ──────────────────────────────────────────────────────────

function loadRoutinesConfig() {
  if (!fs.existsSync(path.resolve(ROUTINES_FILE))) return { error: "Routinen-Konfiguration nicht verfuegbar" };
  try {
    const parsed = yamlLoad(fs.readFileSync(path.resolve(ROUTINES_FILE), "utf-8"));
    if (!parsed?.routines) return { error: "Konfiguration fehlerhaft" };
    return { routines: parsed.routines };
  } catch (e) { return { error: "Konfiguration fehlerhaft" }; }
}

function saveRoutinesConfig(routines) {
  const yaml = yamlDump({ routines });
  fs.writeFileSync(path.resolve(ROUTINES_FILE), yaml, "utf-8");
}

function slugify(name) {
  return name.trim().toLowerCase()
    .replace(/[äöüß ]/g, m => ({ "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", " ": "_" }[m]))
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// ─── Action-Validierung ───────────────────────────────────────────────────────

function validateAction(a) {
  if (!a || typeof a !== "object" || !a.type) return "Action braucht ein 'type'-Feld (ha, music, tts, weather, news, send_message)";
  if (a.type === "ha") {
    if (!a.domain || !a.service || !a.entity_id) return "ha-Action braucht domain, service, entity_id";
  } else if (a.type === "music") {
    if (!["play", "stop", "volume"].includes(a.action)) return "music-Action braucht action: play/stop/volume";
  } else if (a.type === "tts") {
    if (!a.text) return "tts-Action braucht text";
  } else if (a.type === "weather") {
    if (a.weather_action && !["current", "forecast"].includes(a.weather_action)) return "weather-Action braucht weather_action: current oder forecast";
  } else if (a.type === "news") {
    // optional source, count — keine Pflichtfelder
  } else if (a.type === "send_message") {
    if (!a.user || !a.text) return "send_message-Action braucht user und text";
  } else {
    return `Unbekannter Action-Typ: ${a.type} (erlaubt: ha, music, tts, weather, news, send_message)`;
  }
  return null;
}

// ─── Action-Ausführung ────────────────────────────────────────────────────────

// --- Telegram-Helfer ---
async function sendTelegramMessage(username, text, source) {
  let usersConfig = {};
  try {
    const configPath = path.resolve("/workspace/users.json");
    usersConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    throw new Error("users.json nicht gefunden");
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN ist nicht gesetzt");
  const userObj = usersConfig.users?.[username];
  const chatId = userObj?.chat_id;
  if (!chatId) throw new Error(`Keine Chat-ID fuer User '${username}' gefunden`);
  const message = source ? `*${source}:\n${text}` : text;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || "Telegram API Fehler");
  return { chat_id: chatId };
}

// --- Wetter-Helfer ---
async function fetchWeatherData(action, day, location) {
  let lat, lon, locationPrefix = "";
  if (location?.trim()) {
    const geoResult = await geocodeLocation(location.trim().slice(0, 200));
    if (geoResult?.error === "not_found") throw new Error(`Ort '${location}' nicht gefunden.`);
    if (geoResult?.lat != null) {
      lat = String(geoResult.lat); lon = String(geoResult.lon);
      locationPrefix = `In ${geoResult.name}: `;
    } else {
      [lat, lon] = WEATHER_LOCATION.split(",").map(s => s.trim());
    }
  } else {
    [lat, lon] = WEATHER_LOCATION.split(",").map(s => s.trim());
  }

  const dayIndex = resolveTargetDayIndex(day);
  if (dayIndex === -1) throw new Error("Unbekannter Tag.");
  if (dayIndex > 6) throw new Error("Vorhersage nur fuer die naechsten 7 Tage verfuegbar.");

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=Europe/Berlin`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let response;
  try { response = await fetch(url, { signal: controller.signal }); } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error("Wetterdaten momentan nicht verfuegbar.");
  const data = await response.json();

  if (action === "current" || (!action && dayIndex === 0)) {
    const current = data.current_weather;
    const temp = Math.round(current.temperature);
    const condition = mapWmoCodeToCondition(current.weathercode);
    const isRaining = current.weathercode >= 51 && current.weathercode <= 67;
    return `${locationPrefix}Aktuell ${temp} Grad, ${condition}${isRaining ? ", es regnet" : ", kein Regen"}.`;
  }

  const daily = data.daily;
  if (!daily || !daily.time || dayIndex >= daily.time.length) throw new Error("Vorhersage nicht verfuegbar.");
  const tempMin = Math.round(daily.temperature_2m_min[dayIndex]);
  const tempMax = Math.round(daily.temperature_2m_max[dayIndex]);
  const condition = mapWmoCodeToCondition(daily.weathercode[dayIndex]);
  const label = formatDayLabel(dayIndex, day);
  return `${locationPrefix}${label}: ${tempMin} bis ${tempMax} Grad, ${condition}.`;
}

// --- News-Helfer ---
function parseNewsFeeds() {
  const feedsEnv = process.env.NEWS_FEEDS || "";
  if (!feedsEnv.trim()) return [];
  return feedsEnv.split(",").map(entry => {
    const colonIdx = entry.indexOf(":");
    if (colonIdx === -1) return null;
    const name = entry.slice(0, colonIdx).trim();
    const url = entry.slice(colonIdx + 1).trim();
    if (!name || !url) return null;
    return { name, url };
  }).filter(Boolean);
}

async function fetchFeedWithTimeout(feedUrl, timeoutMs = 10000) {
  const parser = new Parser();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(feedUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    return await parser.parseString(xml);
  } finally { clearTimeout(timeout); }
}

async function fetchNewsHeadlines(source, count) {
  const feeds = parseNewsFeeds();
  if (feeds.length === 0) throw new Error("Keine Nachrichten-Quellen konfiguriert.");
  let targetFeeds = feeds;
  if (source) {
    targetFeeds = feeds.filter(f => f.name.toLowerCase() === source.toLowerCase());
    if (targetFeeds.length === 0) throw new Error(`Unbekannte Quelle: ${source}`);
  }
  const feedResults = await Promise.allSettled(targetFeeds.map(feed => fetchFeedWithTimeout(feed.url).then(parsed => ({ feed, parsed }))));
  const headlines = [];
  for (const result of feedResults) {
    if (result.status === "fulfilled") {
      const { feed, parsed } = result.value;
      if (parsed.items) {
        for (const item of parsed.items) {
          headlines.push({ source: feed.name, title: item.title || "Ohne Titel", published_at: item.pubDate ? new Date(item.pubDate) : new Date(0) });
        }
      }
    }
  }
  if (headlines.length === 0) throw new Error("Nachrichten momentan nicht verfuegbar.");
  headlines.sort((a, b) => b.published_at.getTime() - a.published_at.getTime());
  const limited = headlines.slice(0, Math.min(Math.max(count || 5, 1), 20));
  return limited.map(h => `${h.source}: ${h.title}`).join("\n");
}

// --- Main-Executor ---
async function executeRoutineAction(action) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    switch (action.type) {
      case "ha": {
        const resp = await fetch(`${HA_SERVICE_URL}/call_service`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: action.domain, service: action.service, entity_id: action.entity_id, data: action.data || {} }), signal: controller.signal });
        if (!resp.ok) throw new Error(`HA ${resp.status}`);
        return { success: true };
      }
      case "music": {
        let url, body = {};
        if (action.action === "play") { url = `${RIBO_SERVICE_URL}/music/play`; if (action.station) body.station = action.station; }
        else if (action.action === "stop") { url = `${RIBO_SERVICE_URL}/music/stop`; }
        else if (action.action === "volume") { url = `${RIBO_SERVICE_URL}/music/volume`; if (action.volume != null) body.volume = action.volume; }
        else throw new Error(`Unknown music action: ${action.action}`);
        const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
        if (!resp.ok) throw new Error(`Music ${resp.status}`);
        return { success: true };
      }
      case "tts": {
        const resp = await fetch(`${RIBO_SERVICE_URL}/tts/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: action.text }), signal: controller.signal });
        if (!resp.ok) throw new Error(`TTS ${resp.status}`);
        return { success: true };
      }
      case "weather": {
        const wAction = action.weather_action || (action.day ? "forecast" : "current");
        const text = await fetchWeatherData(wAction, action.day, action.location);
        if (action.send_to) {
          await sendTelegramMessage(action.send_to, text, "Wetter");
        }
        return { success: true, text };
      }
      case "news": {
        const text = await fetchNewsHeadlines(action.source, action.count);
        if (action.send_to) {
          await sendTelegramMessage(action.send_to, text, "Nachrichten");
        }
        return { success: true, text };
      }
      case "send_message": {
        await sendTelegramMessage(action.user, action.text, action.source || "Routine");
        return { success: true };
      }
      default: throw new Error(`Unknown type: ${action.type}`);
    }
  } catch (e) { return { success: false, error: e.name === "AbortError" ? "Timeout" : e.message }; }
  finally { clearTimeout(timeout); }
}

// ─── Tool-Definition ──────────────────────────────────────────────────────────

export default defineTool({
  name: "routines",
  label: "Routines",
  description: "Verwaltet und fuehrt Routinen/Szenen aus (Abfolge von Smart-Home-, Musik-, Ansage-, Wetter-, Nachrichten- und Telegram-Aktionen). Actions: run, list, create, delete. Zeitsteuerung laeuft ueber proaktive Regeln, nicht hier.",
  parameters: Type.Object({
    action: Type.String({ description: "run, list, create oder delete" }),
    routine_name: Type.Optional(Type.String({ description: "Name der Routine (run/create/delete)" })),
    actions: Type.Optional(Type.Array(Type.Object({
      type: Type.String({ description: "ha, music, tts, weather, news, send_message" }),
      // ha
      domain: Type.Optional(Type.String({ description: "HA-Domain z.B. light (nur type=ha)" })),
      service: Type.Optional(Type.String({ description: "HA-Service z.B. turn_on (nur type=ha)" })),
      entity_id: Type.Optional(Type.String({ description: "HA-Entity z.B. light.wohnzimmer (nur type=ha)" })),
      data: Type.Optional(Type.Object({}, { additionalProperties: true, description: "Optionale HA-Daten z.B. {brightness:200}" })),
      // music
      action: Type.Optional(Type.String({ description: "play/stop/volume (nur type=music)" })),
      station: Type.Optional(Type.String({ description: "Radiosender (nur type=music, action=play)" })),
      volume: Type.Optional(Type.Number({ description: "Lautstaerke (nur type=music, action=volume)" })),
      // tts
      text: Type.Optional(Type.String({ description: "Ansage-Text (type=tts) oder Nachricht-Text (type=send_message)" })),
      // weather
      weather_action: Type.Optional(Type.String({ description: "current oder forecast (nur type=weather)" })),
      day: Type.Optional(Type.String({ description: "Tag: heute, morgen, uebermorgen, Wochentag (nur type=weather, weather_action=forecast)" })),
      location: Type.Optional(Type.String({ description: "Ortsname (nur type=weather)" })),
      // news
      count: Type.Optional(Type.Number({ description: "Anzahl Schlagzeilen (nur type=news, default: 5)" })),
      source: Type.Optional(Type.String({ description: "Nur von dieser Quelle (nur type=news)" })),
      // send_message
      user: Type.Optional(Type.String({ description: "Empfaenger-Username (nur type=send_message)" })),
      // shared
      send_to: Type.Optional(Type.String({ description: "Wenn gesetzt: Ergebnis per Telegram an diesen User senden (weather, news)" })),
    }), { description: "Liste der Aktionen (nur create)" })),
  }),
  execute: async (_toolCallId, { action, routine_name, actions }) => {
    const denied = checkPermission("routines");
    if (denied) return denied;
    try {
      if (action === "create") {
        if (!routine_name?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "routine_name erforderlich" }) }], details: {} };
        if (!Array.isArray(actions) || actions.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "Mindestens eine Action erforderlich" }) }], details: {} };
        for (const a of actions) {
          const err = validateAction(a);
          if (err) return { content: [{ type: "text", text: JSON.stringify({ error: err }) }], details: {} };
        }
        const config = loadRoutinesConfig();
        const routines = config.error ? {} : config.routines;
        const key = slugify(routine_name);
        if (!key) return { content: [{ type: "text", text: JSON.stringify({ error: "Ungueltiger Routinen-Name" }) }], details: {} };
        const existed = !!routines[key];
        routines[key] = { name: routine_name.trim(), actions };
        saveRoutinesConfig(routines);
        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Routine "${routine_name.trim()}" ${existed ? "aktualisiert" : "erstellt"} (${actions.length} Aktionen). Ausfuehren mit "run".` }) }], details: {} };
      }

      const config = loadRoutinesConfig();
      if (config.error) return { content: [{ type: "text", text: JSON.stringify({ error: config.error }) }], details: {} };
      const routines = config.routines;

      if (action === "list") {
        const names = Object.entries(routines).map(([k, v]) => v.name || k);
        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: names.length ? `Routinen: ${names.join(", ")}` : "Keine Routinen angelegt.", routines: names }) }], details: {} };
      }
      if (action === "run") {
        if (!routine_name) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein Name" }) }], details: {} };
        const key = Object.keys(routines).find(k => k.toLowerCase() === routine_name.toLowerCase() || (routines[k].name || "").toLowerCase() === routine_name.toLowerCase());
        if (!key) return { content: [{ type: "text", text: JSON.stringify({ error: `"${routine_name}" nicht gefunden` }) }], details: {} };
        const routine = routines[key];
        const acts = routine.actions || [];
        let ok = 0, fail = 0;
        const errors = [];
        for (const a of acts) {
          const r = await executeRoutineAction(a);
          if (r.success) ok++;
          else { fail++; errors.push(`${a.type}: ${r.error}`); }
        }
        const msg = `${ok}/${acts.length} Aktionen erfolgreich${fail > 0 ? " — Fehler: " + errors.join("; ") : ""}`;
        return { content: [{ type: "text", text: JSON.stringify({ status: fail === 0 ? "ok" : "partial", message: msg }) }], details: {} };
      }
      if (action === "delete") {
        if (!routine_name?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "routine_name erforderlich" }) }], details: {} };
        const key = Object.keys(routines).find(k => k.toLowerCase() === routine_name.toLowerCase() || (routines[k].name || "").toLowerCase() === routine_name.toLowerCase());
        if (!key) return { content: [{ type: "text", text: JSON.stringify({ error: `"${routine_name}" nicht gefunden` }) }], details: {} };
        delete routines[key];
        saveRoutinesConfig(routines);
        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Routine "${routine_name}" geloescht.` }) }], details: {} };
      }
      return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Nutze run, list, create, delete." }) }], details: {} };
    } catch (e) { return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {} }; }
  },
});
