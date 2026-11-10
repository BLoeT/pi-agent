import path from "node:path";
import { getUserWorkspacePath } from "../lib/users.js";
import { readJson, atomicWrite } from "../lib/storage.js";
import { HttpError } from "../../shared/errors.js";

export function validateModelId(id) {
  if (typeof id !== "string" || !id.trim() || id.length>200 || /[\s\x00-\x1f\x7f]/.test(id))
    throw new HttpError(400,"Bitte einen gültigen Modellnamen aus der Modellliste wählen.");
  return id;
}
export function createModelPreferences(config) {
  const file = user => path.join(getUserWorkspacePath(user),"model-preference.json");
  return {
    get(user) {
      const saved=readJson(file(user),{});
      if (!saved || typeof saved!=="object" || Array.isArray(saved)) throw Error("Ungültige Modellauswahl; Original bleibt erhalten");
      return saved.provider===config.provider && typeof saved.model==="string" ? saved.model : config.model;
    },
    set(user,model) { atomicWrite(file(user),JSON.stringify({provider:config.provider,model},null,2)); },
  };
}

/** Switch through the SDK without discarding messages, memory or tool permissions. */
export async function applyModel(session, model, metadata, toolNames) {
  if (session.model !== model) await session.setModel(model);
  session.setActiveToolsByName(metadata?.tools === false ? [] : toolNames);
}
