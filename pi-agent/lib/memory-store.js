import { randomUUID } from "node:crypto";
import { readJson, atomicWrite, withFileLock } from "./storage.js";

export const MAX_CORE = 20;
export const MAX_CORE_CHARS = 12000;
const MAX_MEMORIES = 2000;
export class MemoryInputError extends Error {}
const STOP = new Set('aber alle auch bitte dann dass dein deine dieser dieses einem einen einer eine habe haben kann kannst machen meine mein mich noch oder sind uber und vom von war was welche welcher welches werden wird wie wir zum zur erinnerst weisst wissen sag mir etwas grundinformationen system geplanter auftrag vollstandigen angeforderten inhalt antwort zustellung scheduler genau einmal zusatzliche versandbestatigung zusammenfassung erforderlich'.split(' '));
export const normalizeMemory = text => String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g,'ss');

export function loadMemories(file) {
  const value = readJson(file, []);
  const entries = Array.isArray(value) ? value : value?.facts;
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.text !== 'string')) {
    throw new MemoryInputError('Ungültige Gedächtnisdatei; Original bleibt erhalten');
  }
  return entries;
}

export function searchMemories(entries, query) {
  const words = [...new Set(normalizeMemory(query).match(/[\p{L}\p{N}]{4,}/gu) || [])].filter(word => !STOP.has(word));
  if (!words.length) return [];
  return entries.map((entry, index) => {
    const text = normalizeMemory(entry.text);
    const score = words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
    return { entry, index, score };
  }).filter(item => item.score > 0).sort((a,b) => b.score-a.score || b.index-a.index).map(item => item.entry);
}

export function selectMemories(entries, query = '') {
  const core = entries.filter(entry => entry.core === true);
  // Existing memories remain usable until the user curates explicit core facts.
  const legacy = entries.filter(entry => entry.core === undefined && entry.category !== 'session_summary');
  const basic = core.length ? core : legacy.slice(-10);
  const used = new Set(basic);
  const relevant = searchMemories(entries.filter(entry => !used.has(entry)), query).slice(0,5);
  return { core: basic, relevant, legacy: core.length === 0 && basic.length > 0 };
}

function validateCore(entries) {
  const core = entries.filter(entry => entry.core === true);
  if (core.length > MAX_CORE || core.reduce((sum,entry) => sum+entry.text.length,0) > MAX_CORE_CHARS) {
    throw new MemoryInputError('Grundwissen voll: maximal 20 Fakten / 12000 Zeichen. Bestehende Fakten kürzen oder aus Grundwissen lösen.');
  }
}

export function changeMemory(file, {action, text, category, core, id}) {
  return withFileLock(file, () => {
    const entries = loadMemories(file);
    const now = new Date().toISOString();
    let result;
    const needText = () => {
      if (typeof text !== 'string' || !text.trim()) throw new MemoryInputError('text erforderlich');
      if (text.length > 12000) throw new MemoryInputError('Erinnerung zu lang; bitte auf maximal 12000 Zeichen kürzen');
      return text.trim();
    };
    if (action === 'remember') {
      const value = needText();
      let entry = entries.find(item => normalizeMemory(item.text) === normalizeMemory(value));
      if (!entry) {
        if (entries.length >= MAX_MEMORIES) throw new MemoryInputError('Gedächtnis voll; gezielt veraltete Einträge entfernen');
        entry = {id:randomUUID(),text:value,category:category || 'fact',created_at:now};
        entries.push(entry);
      }
      if (!entry.id) entry.id = randomUUID();
      if (core !== undefined) entry.core = core;
      if (category) entry.category = category;
      entry.updated_at = now;
      result = {status:'ok',memory:entry};
    } else if (['update','pin','unpin'].includes(action)) {
      const entry = entries.find(item => id && item.id === id);
      if (!entry) throw new MemoryInputError('Erinnerungs-ID nicht gefunden; zuerst recall nutzen');
      if (action === 'update') {
        entry.text = needText();
        if (category) entry.category = category;
        if (core !== undefined) entry.core = core;
      } else entry.core = action === 'pin';
      entry.updated_at = now;
      result = {status:'ok',memory:entry};
    } else if (action === 'forget' || action === 'forget_all') {
      if (action === 'forget' && !id) needText();
      const removed = entries.filter(entry => action === 'forget_all' || (id ? entry.id === id : normalizeMemory(entry.text).includes(normalizeMemory(text.trim()))));
      const drop = new Set(removed);
      const kept = entries.filter(entry => !drop.has(entry));
      entries.splice(0,entries.length,...kept);
      result = {status:'ok',removed:removed.length};
    } else if (action === 'summarize_session') {
      const value = needText();
      const summaries = entries.filter(entry => entry.category === 'session_summary' && entry.core !== true);
      const drop = new Set(summaries.slice(0,-4));
      const kept = entries.filter(entry => !drop.has(entry));
      if (kept.length >= MAX_MEMORIES) throw new MemoryInputError('Gedächtnis voll; veraltete Einträge entfernen');
      entries.splice(0,entries.length,...kept,{id:randomUUID(),text:value,category:'session_summary',created_at:now});
      result = {status:'ok',message:'Session-Zusammenfassung gespeichert.'};
    } else throw new MemoryInputError('Unbekannte Gedächtnisaktion');
    validateCore(entries);
    atomicWrite(file,JSON.stringify(entries,null,2));
    return result;
  });
}
