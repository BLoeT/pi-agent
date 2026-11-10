import { fetchResponse } from "/app/lib/http.js";

const tool = {
  name: "witz",
  label: "Witz (witzapi.de)",
  description: "Holt einen zufälligen Witz von witzapi.de. Optional: Kategorie filtern.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Optionale Kategorie (z.B. 'Politik', 'Wissenschaft', 'Alltag'). Ohne Angabe: zufälliger Witz."
      }
    },
    required: []
  },
  execute: async (_toolCallId, params, signal) => {
    try {
      const { category } = params;
      let url = "https://witzapi.de/api/joke";
      if (category) {
        url += `?category=${encodeURIComponent(category)}`;
      }
      const res = await fetchResponse(url, {
        headers: { "Accept": "application/json" }
      }, {signal,timeout:10000});
      if (!res.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `API-Fehler ${res.status}: ${res.statusText}` }) }],
          details: {}
        };
      }
      const data = await res.json();
      // witzapi.de gibt typischerweise { joke: "..." } oder { text: "..." } zurück
      const jokeText = data.joke || data.text || data.witz || JSON.stringify(data);
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "ok", witz: jokeText, raw: data }) }],
        details: data
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: e.message }) }],
        details: {}
      };
    }
  }
};

export default tool;
