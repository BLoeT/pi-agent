import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readList, writeList } from "../lib/helpers.js";
import { checkPermission } from "../lib/users.js";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

async function searchRecipes(query) {
  if (!TAVILY_API_KEY) return { error: "Web-Suche nicht konfiguriert (TAVILY_API_KEY fehlt)" };
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: `Rezept ${query} deutsch einfach`,
        search_depth: "basic",
        max_results: 3,
        include_answer: true,
      }),
    });
    if (!resp.ok) return { error: `Suche fehlgeschlagen: ${resp.status}` };
    const data = await resp.json();
    return {
      answer: data.answer || "",
      results: (data.results || []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 300),
      })),
    };
  } catch (e) {
    return { error: `Suche fehlgeschlagen: ${e.message}` };
  }
}

export default defineTool({
  name: "cooking",
  label: "Kochassistent",
  description: "Hilft beim Kochen: Rezeptsuche, Zutaten auf Einkaufsliste setzen. Actions: search_recipe (Rezept suchen), add_ingredients (Zutaten auf eine Liste setzen).",
  parameters: Type.Object({
    action: Type.String({ description: "search_recipe oder add_ingredients" }),
    query: Type.Optional(Type.String({ description: "Suchanfrage (z.B. 'Kartoffelsuppe', 'schnelles Abendessen mit Hähnchen')" })),
    ingredients: Type.Optional(Type.Array(Type.Object({
      item: Type.String(),
      quantity: Type.Optional(Type.Number()),
    }), { description: "Zutaten-Liste zum Hinzufügen" })),
    list_name: Type.Optional(Type.String({ description: "Name der Einkaufsliste (default: Einkaufsliste)" })),
  }),
  execute: async (_toolCallId, { action, query, ingredients, list_name }) => {
    const denied = checkPermission("cooking");
    if (denied) return denied;
    try {
      switch (action) {
        case "search_recipe": {
          if (!query?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Suchanfrage erforderlich" }) }], details: {} };

          const result = await searchRecipes(query.trim());
          if (result.error) return { content: [{ type: "text", text: JSON.stringify({ error: result.error }) }], details: {} };

          let message = "";
          if (result.answer) {
            message = result.answer;
          }
          if (result.results.length > 0) {
            const sources = result.results.map(r => `• ${r.title}: ${r.snippet}`).join("\n");
            message += message ? `\n\nQuellen:\n${sources}` : sources;
          }

          if (!message) message = "Kein passendes Rezept gefunden.";

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message, results: result.results }) }], details: {} };
        }

        case "add_ingredients": {
          if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "ingredients Array erforderlich" }) }], details: {} };
          }

          const targetList = list_name?.trim() || "Einkaufsliste";

          // Read existing list or create new one
          let items = readList(targetList);
          if (items === null) items = [];

          let added = 0;
          let updated = 0;

          for (const ing of ingredients) {
            if (!ing.item?.trim()) continue;
            const itemName = ing.item.trim();
            const qty = ing.quantity && ing.quantity > 0 ? Math.floor(ing.quantity) : undefined;

            const existingIdx = items.findIndex(e => e.item.toLowerCase() === itemName.toLowerCase());
            if (existingIdx !== -1) {
              // Update quantity if both have quantities
              if (qty && "quantity" in items[existingIdx]) {
                items[existingIdx].quantity += qty;
                updated++;
              }
              // Skip if already exists without quantity
            } else {
              const entry = { item: itemName };
              if (qty) entry.quantity = qty;
              items.push(entry);
              added++;
            }
          }

          writeList(targetList, items);

          let msg = "";
          if (added > 0) msg += `${added} Zutat(en) auf "${targetList}" gesetzt.`;
          if (updated > 0) msg += `${msg ? " " : ""}${updated} Mengen aktualisiert.`;
          if (added === 0 && updated === 0) msg = "Alle Zutaten waren bereits auf der Liste.";

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: msg, added, updated, total: items.length }) }], details: {} };
        }

        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Verfügbar: search_recipe, add_ingredients" }) }], details: {} };
      }
    } catch (e) {
      console.error(`❌ Cooking Tool error (${action}):`, e.message);
      return { content: [{ type: "text", text: `Error: Kochassistent-Fehler: ${e.message}` }], details: {} };
    }
  },
});
