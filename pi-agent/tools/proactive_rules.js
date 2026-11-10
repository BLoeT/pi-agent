import { randomUUID } from "node:crypto";
import { readJson, atomicWrite, withFileLock } from "../lib/storage.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { checkPermission } from "../lib/users.js";
import { getCurrentUserId } from "../lib/users.js";

const RULES_PATH = "/workspace/proactive_rules.json";

function loadRules() {
  const rules=readJson(RULES_PATH,[]);
  if(!Array.isArray(rules)) throw new Error("Ungültige Regeldatei; Original bleibt erhalten");
  return rules;
}
function saveRules(rules) { atomicWrite(RULES_PATH,JSON.stringify(rules,null,2));return true; }
function findRuleIndex(rules,id,userId) {return rules.findIndex(r=>r.id===id && r.userId===userId);}

function validateRule(rule) {
  const required = ["id", "userId", "name", "prompt", "hour", "minute", "weekdays"];
  const missing = required.filter(k => !(k in rule));
  if (missing.length > 0) {
    throw new Error(`Fehlende Felder: ${missing.join(", ")}`);
  }
  if (!Number.isInteger(rule.hour) || rule.hour < 0 || rule.hour > 23) {
    throw new Error("hour muss 0-23 sein");
  }
  if (!Number.isInteger(rule.minute) || rule.minute < 0 || rule.minute > 59) {
    throw new Error("minute muss 0-59 sein");
  }
  if (!Array.isArray(rule.weekdays) || rule.weekdays.length === 0) {
    throw new Error("weekdays muss ein nicht-leeres Array sein");
  }
  const validWeekdays = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];
  for (const day of rule.weekdays) {
    if (!validWeekdays.includes(day.toLowerCase())) {
      throw new Error(`Ungültiger Wochentag: ${day}`);
    }
  }
  return rule;
}

function formatRuleForDisplay(rule) {
  const days = rule.weekdays.map(d => d.slice(0, 3)).join(", ");
  const time = `${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}`;
  const status = rule.enabled ? "aktiv" : "inaktiv";
  return `[${rule.id}] ${rule.name} — ${time} Uhr (${days}) — ${status}`;
}

export default defineTool({
  name: "proactive_rules",
  label: "Proactive Rules",
  description: "Verwaltet proaktive Regeln (zeitgesteuerte Aktionen). Jeder Nutzer verwaltet nur seine eigenen Regeln. Actions: list, add, update, delete, toggle, get.",
  parameters: Type.Object({
    action: Type.String({ description: "list, add, update, delete, toggle, get" }),
    id: Type.Optional(Type.String({ description: "Regel-ID (für update/delete/toggle/get)" })),
    name: Type.Optional(Type.String({ description: "Name der Regel (für add/update)" })),
    prompt: Type.Optional(Type.String({ description: "Was der Agent tun soll (für add/update)" })),
    hour: Type.Optional(Type.Number({ description: "Stunde 0-23 (für add/update)" })),
    minute: Type.Optional(Type.Number({ description: "Minute 0-59 (für add/update)" })),
    weekdays: Type.Optional(Type.Array(Type.String(), { description: "Wochentage als Array, z.B. ['montag', 'freitag'] (für add/update)" })),
    enabled: Type.Optional(Type.Boolean({ description: "Aktiviert oder inaktiv (für add/update/toggle)" })),
  }),
  execute: async (_toolCallId, { action, id, name, prompt, hour, minute, weekdays, enabled }) => {
    const denied = checkPermission("proactive_rules");
    if (denied) return denied;

    try {
      return withFileLock(RULES_PATH, () => {
      let rules = loadRules();
      const currentUserId = getCurrentUserId();

      if (action === "list") {
        const myRules = rules.filter(r => r.userId === currentUserId);
        if (myRules.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine aktiven Regeln", count: 0 }) }], details: {} };
        }
        const formatted = myRules.map(r => formatRuleForDisplay(r));
        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", rules: myRules, formatted, count: myRules.length }) }], details: {} };
      }

      if (action === "get") {
        if (!id) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "id erforderlich" }) }], details: {} };
        }
        const rule = rules.find(r => r.id === id && r.userId === currentUserId);
        if (!rule) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Regel nicht gefunden" }) }], details: {} };
        }
        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", rule }) }], details: {} };
      }

      if (action === "add") {
        if (!name?.trim()) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "name erforderlich" }) }], details: {} };
        }
        if (!prompt?.trim()) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "prompt erforderlich" }) }], details: {} };
        }
        if (hour == null) hour = 0;
        if (minute == null) minute = 0;
        if (!weekdays) weekdays = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];

        const newRule = {
          id: randomUUID(),
          userId: currentUserId,
          name: name.trim(),
          prompt: prompt.trim(),
          hour,
          minute,
          weekdays: weekdays.map(d => d.toLowerCase()),
          enabled: enabled !== false,
        };

        validateRule(newRule);

        if (rules.some(r => r.userId === currentUserId && r.name.trim().toLowerCase() === newRule.name.toLowerCase())) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `Regel mit Namen '${newRule.name}' existiert bereits` }) }], details: {} };
        }

        rules.push(newRule);
        const saved = saveRules(rules);
        if (!saved) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Konnte Regel nicht speichern" }) }], details: {} };
        }

        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Regel '${newRule.name}' angelegt`, rule: newRule }) }], details: {} };
      }

      if (action === "update") {
        if (!id) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "id erforderlich" }) }], details: {} };
        }
        const idx = findRuleIndex(rules, id, currentUserId);
        if (idx === -1) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Regel nicht gefunden" }) }], details: {} };
        }
        const rule = rules[idx];
        if (rule.userId !== currentUserId) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Keine Berechtigung" }) }], details: {} };
        }

        if (name?.trim()) rule.name = name.trim();
        if (prompt?.trim()) rule.prompt = prompt.trim();
        if (hour != null) rule.hour = hour;
        if (minute != null) rule.minute = minute;
        if (weekdays) rule.weekdays = weekdays.map(d => d.toLowerCase());
        if (enabled !== undefined) rule.enabled = enabled;

        validateRule(rule);

        rules[idx] = rule;
        const saved = saveRules(rules);
        if (!saved) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Konnte Regel nicht speichern" }) }], details: {} };
        }

        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Regel '${rule.name}' aktualisiert`, rule }) }], details: {} };
      }

      if (action === "toggle") {
        if (!id) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "id erforderlich" }) }], details: {} };
        }
        const idx = findRuleIndex(rules, id, currentUserId);
        if (idx === -1) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Regel nicht gefunden" }) }], details: {} };
        }
        const rule = rules[idx];
        if (rule.userId !== currentUserId) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Keine Berechtigung" }) }], details: {} };
        }

        rule.enabled = enabled !== undefined ? enabled : !rule.enabled;
        rules[idx] = rule;
        const saved = saveRules(rules);
        if (!saved) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Konnte Regel nicht speichern" }) }], details: {} };
        }

        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Regel '${rule.name}' ${rule.enabled ? "aktiviert" : "deaktiviert"}`, rule }) }], details: {} };
      }

      if (action === "delete") {
        if (!id) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "id erforderlich" }) }], details: {} };
        }
        const idx = findRuleIndex(rules, id, currentUserId);
        if (idx === -1) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Regel nicht gefunden" }) }], details: {} };
        }
        const rule = rules[idx];
        if (rule.userId !== currentUserId) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Keine Berechtigung" }) }], details: {} };
        }

        rules.splice(idx, 1);
        const saved = saveRules(rules);
        if (!saved) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Konnte Regel nicht speichern" }) }], details: {} };
        }

        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Regel '${rule.name}' gelöscht` }) }], details: {} };
      }

      return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte action", valid: ["list", "add", "update", "delete", "toggle", "get"] }) }], details: {} };
      });
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], details: {} };
    }
  },
});
