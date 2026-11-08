import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import Parser from "rss-parser";
import { checkPermission } from "../lib/users.js";

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

export default defineTool({
  name: "news",
  label: "News",
  description: "Ruft aktuelle Nachrichten-Schlagzeilen von konfigurierten RSS-Feeds ab. Actions: headlines, list_sources.",
  parameters: Type.Object({
    action: Type.String({ description: "headlines oder list_sources" }),
    source: Type.Optional(Type.String({ description: "Nur Schlagzeilen von dieser Quelle" })),
    count: Type.Optional(Type.Number({ description: "Anzahl (Standard: 5, Max: 20)" })),
  }),
  execute: async (_toolCallId, { action, source, count }) => {
    const denied = checkPermission("news");
    if (denied) return denied;
    try {
      const feeds = parseNewsFeeds();
      if (feeds.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "Keine Nachrichten-Quellen konfiguriert" }) }], details: {} };

      if (action === "list_sources") {
        const names = feeds.map(f => f.name);
        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Quellen: ${names.join(", ")}`, sources: names }) }], details: {} };
      }

      if (action === "headlines") {
        let headlineCount = Math.min(Math.max(count || 5, 1), 20);
        let targetFeeds = feeds;
        if (source) {
          targetFeeds = feeds.filter(f => f.name.toLowerCase() === source.toLowerCase());
          if (targetFeeds.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "unknown_source", message: `Unbekannte Quelle: ${source}. Verfügbar: ${feeds.map(f => f.name).join(", ")}` }) }], details: {} };
          }
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

        if (headlines.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "error", message: "Nachrichten momentan nicht verfuegbar" }) }], details: {} };

        headlines.sort((a, b) => b.published_at.getTime() - a.published_at.getTime());
        const limited = headlines.slice(0, headlineCount);
        const message = limited.map(h => `${h.source}: ${h.title}`).join(". ");
        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message, headlines: limited.map(h => ({ ...h, published_at: h.published_at.toISOString() })) }) }], details: {} };
      }

      return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion." }) }], details: {} };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Nachrichten-Fehler: ${e.message}` }], details: {} };
    }
  },
});
