import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import { checkPermission } from "../lib/users.js";

const HA_SERVICE_URL = process.env.HA_SERVICE_URL || "http://ha-service:8082";
// hey-ribo (Port 8085) stellt Musik + TTS bereit. RIBO_SERVICE_URL = sprechender Name,
// MUSIC_SERVICE_URL als Fallback für bestehende Configs.
const RIBO_SERVICE_URL = process.env.RIBO_SERVICE_URL || process.env.MUSIC_SERVICE_URL || "http://host.docker.internal:8085";
const ROUTINES_FILE = process.env.ROUTINES_FILE || path.join("/workspace", "routines.yaml");

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

// Schlüssel aus Namen: "Guten Morgen" → "guten_morgen"
function slugify(name) {
  return name.trim().toLowerCase()
    .replace(/[äöü ß]/g, m => ({ "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", " ": "_" }[m]))
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// Validiert eine einzelne Action, gibt Fehlertext oder null
function validateAction(a) {
  if (!a || typeof a !== "object" || !a.type) return "Action braucht ein 'type'-Feld (ha, music, tts)";
  if (a.type === "ha") {
    if (!a.domain || !a.service || !a.entity_id) return "ha-Action braucht domain, service, entity_id";
  } else if (a.type === "music") {
    if (!["play", "stop", "volume"].includes(a.action)) return "music-Action braucht action: play/stop/volume";
  } else if (a.type === "tts") {
    if (!a.text) return "tts-Action braucht text";
  } else {
    return `Unbekannter Action-Typ: ${a.type} (erlaubt: ha, music, tts)`;
  }
  return null;
}

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
      default: throw new Error(`Unknown type: ${action.type}`);
    }
  } catch (e) { return { success: false, error: e.name === "AbortError" ? "Timeout" : e.message }; }
  finally { clearTimeout(timeout); }
}

export default defineTool({
  name: "routines",
  label: "Routines",
  description: "Verwaltet und fuehrt Routinen/Szenen aus (Abfolge von Smart-Home-, Musik- und Ansage-Aktionen). Actions: run, list, create, delete. Zeitsteuerung laeuft ueber proaktive Regeln, nicht hier.",
  parameters: Type.Object({
    action: Type.String({ description: "run, list, create oder delete" }),
    routine_name: Type.Optional(Type.String({ description: "Name der Routine (run/create/delete)" })),
    actions: Type.Optional(Type.Array(Type.Object({
      type: Type.String({ description: "ha, music oder tts" }),
      domain: Type.Optional(Type.String({ description: "HA-Domain z.B. light (nur type=ha)" })),
      service: Type.Optional(Type.String({ description: "HA-Service z.B. turn_on (nur type=ha)" })),
      entity_id: Type.Optional(Type.String({ description: "HA-Entity z.B. light.wohnzimmer (nur type=ha)" })),
      data: Type.Optional(Type.Object({}, { additionalProperties: true, description: "Optionale HA-Daten z.B. {brightness:200}" })),
      action: Type.Optional(Type.String({ description: "play/stop/volume (nur type=music)" })),
      station: Type.Optional(Type.String({ description: "Radiosender (nur type=music, action=play)" })),
      volume: Type.Optional(Type.Number({ description: "Lautstaerke (nur type=music, action=volume)" })),
      text: Type.Optional(Type.String({ description: "Ansage-Text (nur type=tts)" })),
    }), { description: "Liste der Aktionen (nur create)" })),
  }),
  execute: async (_toolCallId, { action, routine_name, actions }) => {
    const denied = checkPermission("routines");
    if (denied) return denied;
    try {
      // create: legt neue Routine an (auch wenn noch keine Config existiert)
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

      // Ab hier braucht es eine existierende Config
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
        for (const a of acts) { const r = await executeRoutineAction(a); if (r.success) ok++; else fail++; }
        return { content: [{ type: "text", text: JSON.stringify({ status: fail === 0 ? "ok" : "partial", message: `${ok}/${acts.length} Aktionen erfolgreich` }) }], details: {} };
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
