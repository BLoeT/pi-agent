import { updateJson } from "./storage.js";
import { resolveWithin } from "./security.js";
import { getCurrentUserId, getUserWorkspacePath } from "./users.js";

/** Record tool names only, without another model round or private arguments. */
export function recordInteraction(tool, now = new Date()) {
  if (typeof tool !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(tool)) {
    throw new Error("Ungültiger Tool-Name");
  }
  const file = resolveWithin(getUserWorkspacePath(getCurrentUserId()), "memory/habits_log.json");
  updateJson(file, [], log => {
    log.push({ tool, timestamp: now.toISOString(),
      weekday: now.toLocaleDateString("de-DE", { weekday: "long" }), hour: now.getHours() });
    if (log.length > 500) log.splice(0, log.length - 500);
  });
}
