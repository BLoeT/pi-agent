import { fetchResponse } from "../lib/http.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { checkPermission } from "../lib/users.js";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

export default defineTool({
  name: "search",
  label: "Web Search",
  description: "Sucht im Internet nach aktuellen Informationen. Nutze dieses Tool wenn der Nutzer nach aktuellen Ereignissen, Fakten, Rezepten oder Informationen fragt.",
  parameters: Type.Object({
    query: Type.String({ description: "Suchbegriff(e)" }),
  }),
  execute: async (_toolCallId, { query }, signal) => {
    const denied = checkPermission("search");
    if (denied) return denied;
    if (!TAVILY_API_KEY) return { content: [{ type: "text", text: JSON.stringify({ error: "Web-Suche nicht konfiguriert (TAVILY_API_KEY fehlt)" }) }], details: {} };
    if (!query?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Kein Suchbegriff" }) }], details: {} };
    try {
      const resp = await fetchResponse("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query.trim(), search_depth: "basic", max_results: 5, include_answer: true }),
      }, {signal,timeout:15000});
      if (!resp.ok) return { content: [{ type: "text", text: JSON.stringify({ error: `Suche fehlgeschlagen: ${resp.status}` }) }], details: {} };
      const data = await resp.json();
      const answer = data.answer || "";
      const results = (data.results || []).map(r => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 200) }));
      const formatted = results.map(r => `• ${r.title}: ${r.snippet}`).join("\n");
      const message = answer ? `${answer}\n\nQuellen:\n${formatted}` : `Suchergebnisse:\n${formatted}`;
      return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message, results }) }], details: {} };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Such-Fehler: ${e.message}` }], details: {} };
    }
  },
});
