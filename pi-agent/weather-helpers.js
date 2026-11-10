import { fetchResponse } from "./lib/http.js";
/**
 * Weather Tool helper functions.
 * Exported separately for testability (used by weather.test.js and property tests).
 * These functions are also defined inline in server.js.
 */

export function mapWmoCodeToCondition(code) {
  // WMO Weather interpretation codes (WW)
  // https://open-meteo.com/en/docs
  if (code === 0 || code === 1) return "sonnig";
  if (code >= 2 && code <= 3) return "bewoelkt";
  if (code >= 45 && code <= 48) return "neblig";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "regnerisch";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "Schnee";
  if (code >= 95 && code <= 99) return "Gewitter";
  return "bewoelkt";
}

export function resolveTargetDayIndex(day) {
  // Returns the index offset from today (0 = today, 1 = tomorrow, etc.)
  if (!day || day.toLowerCase() === "heute") return 0;
  if (day.toLowerCase() === "morgen") return 1;
  if (day.toLowerCase() === "übermorgen" || day.toLowerCase() === "uebermorgen") return 2;

  // Weekday names in German
  const weekdays = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
  const dayLower = day.toLowerCase();
  const weekdayIndex = weekdays.indexOf(dayLower);

  if (weekdayIndex === -1) return -1; // unknown day

  const today = new Date();
  const todayWeekday = today.getDay(); // 0=Sunday, 1=Monday, ...
  let diff = weekdayIndex - todayWeekday;
  if (diff <= 0) diff += 7; // always look forward
  return diff;
}

export function formatDayLabel(dayIndex, dayParam) {
  if (dayIndex === 0) return "Heute";
  if (dayIndex === 1) return "Morgen";
  if (dayIndex === 2) return "Uebermorgen";
  // Return the weekday name capitalized
  if (dayParam) return dayParam.charAt(0).toUpperCase() + dayParam.slice(1).toLowerCase();
  return "Dann";
}

/**
 * Geocodes a location name to coordinates using Open-Meteo Geocoding API.
 * Returns {lat, lon, name} on success, {error: "not_found"} if no results,
 * or null on timeout/failure (signals fallback to default coordinates).
 */
export async function geocodeLocation(locationName) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&language=de`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetchResponse(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.results || data.results.length === 0) {
      return { error: "not_found" };
    }
    return {
      lat: data.results[0].latitude,
      lon: data.results[0].longitude,
      name: data.results[0].name,
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Formats a current weather response. TTS-friendly, German, ≤200 chars.
 */
export function formatCurrentWeather(temperature, weathercode) {
  const temp = Math.round(temperature);
  const condition = mapWmoCodeToCondition(weathercode);
  const isRaining = weathercode >= 51 && weathercode <= 67;
  const rainText = isRaining ? ", es regnet" : ", kein Regen";
  return `Aktuell ${temp} Grad, ${condition}${rainText}.`;
}

/**
 * Formats a forecast response. TTS-friendly, German, ≤200 chars.
 */
export function formatForecastWeather(dayIndex, dayParam, tempMin, tempMax, weathercode) {
  const min = Math.round(tempMin);
  const max = Math.round(tempMax);
  const condition = mapWmoCodeToCondition(weathercode);
  const label = formatDayLabel(dayIndex, dayParam);
  return `${label}: ${min} bis ${max} Grad, ${condition}.`;
}
