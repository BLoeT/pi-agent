import { resolveGenerationSource } from "../lib/uploads.js";
import {generateRequest,claimGeneratedFile} from "../lib/generation.js";
import {getUserWorkspacePath} from "../lib/users.js";
import { serviceHeaders } from "../lib/security.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import { resolveWithin, safeName } from "../lib/security.js";
import path from "path";
import { checkPermission, getCurrentUserId } from "../lib/users.js";
import { getImagegenOutputDir } from "../lib/helpers.js";

const IMAGEGEN_SERVICE_URL = process.env.IMAGEGEN_SERVICE_URL || "http://host.docker.internal:8086";
const HOST_WORKSPACE_PATH = process.env.HOST_WORKSPACE_PATH || "/Users/enricostarke/Desktop/pi-agent/workspace";

function toHostPath(p, userId) {
  const containerRoot = path.join("/workspace/users", userId);
  const relative = path.relative(containerRoot, resolveWithin(containerRoot, p));
  return resolveWithin(path.join(HOST_WORKSPACE_PATH, "users", userId), relative);
}

const ENGINES_DESC =
  "flux1 (FLUX schnell/dev). flux2 (Default, 4b/9b)," +
  "krea2, qwen2.1, z-image-turbo, rmbg (Hintergrund entfernen, braucht source_image).";

export default defineTool({
  name: "imagegen",
  label: "Image Generator",
  description:
    "Generiert Bilder aus Text-Beschreibungen auf Apple Silicon (MLX). " +
    "Unterstützt Text2img, Img2img (Bild bearbeiten) und Hintergrund-entfernen (engine 'rmbg'). " +
    "Verfügbare Engines: " + ENGINES_DESC,
  parameters: Type.Object({
    prompt: Type.String({ description: "Englische Bildbeschreibung (detailliert). Übersetze deutsche Anfragen." }),
    engine: Type.Optional(Type.String({ description: ENGINES_DESC + " Default: flux2." })),
    model: Type.Optional(Type.String({
      description:
        "Nur engine-spezifisch: flux1 → 'schnell'|'dev'; flux2 → '4b'|'9b'. " +
        "Für die anderen Engines ist das Modell fix und dieser Wert wird ignoriert.",
    })),
    width: Type.Optional(Type.Number({ description: "Breite 256-2048 (default: 1024)" })),
    height: Type.Optional(Type.Number({ description: "Höhe 256-2048 (default: 1024)" })),
    steps: Type.Optional(Type.Number({ description: "Anzahl Generierungs-Steps (1-50). Ohne Angabe: Engine/Tool-Default." })),
    seed: Type.Optional(Type.Number({ description: "Zufalls-Seed. Gleicher Seed + gleicher Prompt = gleiches Bild. Ohne Angabe: zufällig." })),
    guidance: Type.Optional(Type.Number({
      description:
        "Wie streng der Prompt umgesetzt wird (1-10). Nur bei Engines mit Guidance-Unterstützung (flux1, krea2, qwen2.1, z-image-turbo). " +
        "flux2 ignoriert diesen Wert.",
    })),
    use_uploaded_image: Type.Optional(Type.Boolean({description:"Aktuell angehängtes Bild als Vorlage verwenden (Standard true). Nur bei ausdrücklich neuer Erzeugung ohne Bildvorlage false; dann kein source_image setzen."})),
    source_image: Type.Optional(Type.String({ description: "Pfad zum Quellbild für img2img / rmbg. Relativ zum User-Workspace oder absolut." })),
    image_strength: Type.Optional(Type.Number({
      description: "Nur für Engines mit Bild-Stärke (flux1,krea2, qwen2.1, z-image-turbo), 0.0-1.0, default 0.4. Kontrolle wie stark das Quellbild den Output beeinflusst.",
    })),
    negative_prompt: Type.Optional(Type.String({
      description: "Negativ-Prompt: Was das Modell NICHT generieren soll. Nur bei Engines mit Unterstützung (flux1, ernie-image-turbo, fibo, krea2, qwen2.1, z-image-turbo). flux2/boogu ignorieren diesen Wert.",
    })),
    filename: Type.Optional(Type.String({ description: "Dateiname (z.B. robot.png)" })),
  }),
  execute: async (_toolCallId, { prompt, engine, model, width, height, steps, seed, guidance, source_image, use_uploaded_image, image_strength, negative_prompt, filename }, signal) => {
    const denied = checkPermission("imagegen");
    if (denied) return denied;
    try {
      const isRmbg = (engine || "").toLowerCase() === "rmbg";
      if (!prompt?.trim() && !isRmbg) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Prompt erforderlich" }) }], details: {} };
      }

      const userId = getCurrentUserId();
      const sourceImage = resolveGenerationSource(source_image,use_uploaded_image);

      const body = { prompt: (prompt || "").trim() };
      if (engine) body.engine = engine;
      if (model) body.model = model;
      if (width) body.width = width;
      if (height) body.height = height;
      if (steps) body.steps = steps;
      if (seed != null) body.seed = seed;
      if (guidance != null) body.guidance = guidance;
      if (sourceImage) body.init_image = toHostPath(sourceImage, userId);
      if (image_strength != null) body.image_strength = image_strength;
      if (negative_prompt) body.negative_prompt = negative_prompt.trim();

      const data=await generateRequest(`${IMAGEGEN_SERVICE_URL}/generate`,body,{signal,timeout:1800000});
      const userDir=resolveWithin(getUserWorkspacePath(userId),"generated-images");
      const userRelPath=claimGeneratedFile(data,{kind:"image",filename,userDir});

      const result = {
        status: "ok",
        path: data.path,
        user_path: userRelPath,
        engine: engine ?? "flux2",
        seed: seed ?? null,
        guidance: guidance ?? null,
        prompt: (prompt || "").trim(),
      };

      if (userRelPath) result.image_marker = `[IMAGE:${userId}:${userRelPath}]`;

      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    } catch (e) {
      if (e.name === "AbortError") {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Timeout — Generation dauert zu lang. Versuche weniger Steps oder 'schnell'." }) }], details: {} };
      }
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], details: {} };
    }
  },
});
