import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { mapWmoCodeToCondition, resolveTargetDayIndex, formatDayLabel, geocodeLocation } from "../weather-helpers.js";
import { checkPermission } from "../lib/users.js";

const WEATHER_LOCATION = process.env.WEATHER_LOCATION || "52.52,13.405";

export default defineTool({
  name: "weather",
  label: "Weather",
  description: "Ruft aktuelle Wetterdaten oder eine Vorhersage ab. Actions: current (aktuelles Wetter), forecast (Vorhersage fuer einen Tag).",
  parameters: Type.Object({
    action: Type.String({ description: "current oder forecast" }),
    day: Type.Optional(Type.String({ description: "Tag: heute, morgen, uebermorgen, Wochentag" })),
    location: Type.Optional(Type.String({ description: "Ortsname (z.B. München, Berlin)" })),
  }),
  execute: async (_toolCallId, { action, day, location }) => {
    const denied = checkPermission("weather");
    if (denied) return denied;
    try {
      let lat, lon, locationPrefix = "";

      if (location && location.trim().length > 0) {
        let locationInput = location.trim().slice(0, 200);
        const geoResult = await geocodeLocation(locationInput);
        if (geoResult && geoResult.error === "not_found") {
          return { content: [{ type: "text", text: JSON.stringify({ result: `Ort '${locationInput}' nicht gefunden.` }) }], details: {} };
        }
        if (geoResult && geoResult.lat != null && geoResult.lon != null) {
          lat = String(geoResult.lat); lon = String(geoResult.lon);
          locationPrefix = `In ${geoResult.name}: `;
        } else {
          [lat, lon] = WEATHER_LOCATION.split(",").map(s => s.trim());
        }
      } else {
        [lat, lon] = WEATHER_LOCATION.split(",").map(s => s.trim());
      }

      const dayIndex = resolveTargetDayIndex(day);
      if (dayIndex === -1) return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannter Tag." }) }], details: {} };
      if (dayIndex > 6) return { content: [{ type: "text", text: JSON.stringify({ result: "Vorhersage nur fuer die naechsten 7 Tage verfuegbar." }) }], details: {} };

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=Europe/Berlin`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let response;
      try { response = await fetch(url, { signal: controller.signal }); } finally { clearTimeout(timeout); }
      if (!response.ok) return { content: [{ type: "text", text: JSON.stringify({ result: "Wetterdaten momentan nicht verfuegbar." }) }], details: {} };

      const data = await response.json();

      if (action === "current") {
        const current = data.current_weather;
        const temp = Math.round(current.temperature);
        const condition = mapWmoCodeToCondition(current.weathercode);
        const isRaining = current.weathercode >= 51 && current.weathercode <= 67;
        const result = `${locationPrefix}Aktuell ${temp} Grad, ${condition}${isRaining ? ", es regnet" : ", kein Regen"}.`;
        return { content: [{ type: "text", text: JSON.stringify({ result }) }], details: {} };
      }

      if (action === "forecast") {
        const daily = data.daily;
        if (!daily || !daily.time || dayIndex >= daily.time.length) {
          return { content: [{ type: "text", text: JSON.stringify({ result: "Vorhersage nicht verfuegbar." }) }], details: {} };
        }
        const tempMin = Math.round(daily.temperature_2m_min[dayIndex]);
        const tempMax = Math.round(daily.temperature_2m_max[dayIndex]);
        const condition = mapWmoCodeToCondition(daily.weathercode[dayIndex]);
        const label = formatDayLabel(dayIndex, day);
        const result = `${locationPrefix}${label}: ${tempMin} bis ${tempMax} Grad, ${condition}.`;
        return { content: [{ type: "text", text: JSON.stringify({ result }) }], details: {} };
      }

      return { content: [{ type: "text", text: JSON.stringify({ error: "Nutze current oder forecast." }) }], details: {} };
    } catch (e) {
      if (e.name === "AbortError") return { content: [{ type: "text", text: JSON.stringify({ result: "Wetterdaten momentan nicht verfuegbar." }) }], details: {} };
      return { content: [{ type: "text", text: JSON.stringify({ result: "Wetterdaten momentan nicht verfuegbar." }) }], details: {} };
    }
  },
});
