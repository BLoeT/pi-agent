import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { checkPermission, getCurrentUserId } from "../lib/users.js";
import { getImagegenOutputDir, getGodotProjectDir } from "../lib/helpers.js";

const IMAGEGEN_SERVICE_URL = process.env.IMAGEGEN_SERVICE_URL || "http://host.docker.internal:8086";
const HOST_WORKSPACE_PATH = process.env.HOST_WORKSPACE_PATH || "/Users/enricostarke/Desktop/pi-agent/workspace";

function toHostPath(p, userId) {
  if (!p) return p;
  if (p.startsWith("/workspace/")) {
    return p.replace("/workspace", HOST_WORKSPACE_PATH);
  }
  return path.join(HOST_WORKSPACE_PATH, "users", userId, p);
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
    source_image: Type.Optional(Type.String({ description: "Pfad zum Quellbild für img2img / rmbg. Relativ zum User-Workspace oder absolut." })),
    image_strength: Type.Optional(Type.Number({
      description: "Nur für Engines mit Bild-Stärke (flux1,krea2, qwen2.1, z-image-turbo), 0.0-1.0, default 0.4. Kontrolle wie stark das Quellbild den Output beeinflusst.",
    })),
    negative_prompt: Type.Optional(Type.String({
      description: "Negativ-Prompt: Was das Modell NICHT generieren soll. Nur bei Engines mit Unterstützung (flux1, ernie-image-turbo, fibo, krea2, qwen2.1, z-image-turbo). flux2/boogu ignorieren diesen Wert.",
    })),
    filename: Type.Optional(Type.String({ description: "Dateiname (z.B. robot.png)" })),
    save_to_godot: Type.Optional(Type.Boolean({ description: "Ins Godot-Projekt kopieren" })),
  }),
  execute: async (_toolCallId, { prompt, engine, model, width, height, steps, seed, guidance, source_image, image_strength, negative_prompt, filename, save_to_godot }) => {
    const denied = checkPermission("imagegen");
    if (denied) return denied;
    try {
      const isRmbg = (engine || "").toLowerCase() === "rmbg";
      if (!prompt?.trim() && !isRmbg) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Prompt erforderlich" }) }], details: {} };
      }

      const userId = getCurrentUserId();

      const body = { prompt: (prompt || "").trim() };
      if (engine) body.engine = engine;
      if (model) body.model = model;
      if (width) body.width = width;
      if (height) body.height = height;
      if (steps) body.steps = steps;
      if (seed != null) body.seed = seed;
      if (guidance != null) body.guidance = guidance;
      if (source_image) body.init_image = toHostPath(source_image, userId);
      if (image_strength != null) body.image_strength = image_strength;
      if (negative_prompt) body.negative_prompt = negative_prompt.trim();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1800000);
      let resp;
      try {
        resp = await fetch(`${IMAGEGEN_SERVICE_URL}/generate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body), signal: controller.signal,
        });
      } finally { clearTimeout(timeout); }

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        return { content: [{ type: "text", text: JSON.stringify({ error: errData.error || `Fehler: ${resp.status}` }) }], details: {} };
      }

      const data = await resp.json();
      if (data.error) return { content: [{ type: "text", text: JSON.stringify({ error: data.error }) }], details: {} };

      const srcName = path.basename(data.path);
      const globalImagePath = path.join("/workspace", "generated-images", srcName);

      let userRelPath = null;
      try {
        const userImagesDir = getImagegenOutputDir();
        fs.mkdirSync(userImagesDir, { recursive: true });
        let targetName = filename?.trim() || srcName;
        if (!targetName.endsWith(".png")) targetName += ".png";
        const userImagePath = path.join(userImagesDir, targetName);

        if (fs.existsSync(globalImagePath)) {
          // BEWEGEN statt kopieren — nur eine Kopie im User-Ordner
          try {
            fs.renameSync(globalImagePath, userImagePath);
          } catch {
            // Fallback: rename funktioniert ggf. nicht über Mounts hinweg
            fs.copyFileSync(globalImagePath, userImagePath);
            try { fs.unlinkSync(globalImagePath); } catch {}
          }
          userRelPath = path.join("generated-images", targetName);
        }
      } catch {}

      if (save_to_godot) {
        try {
          const godotDir = getGodotProjectDir();
          const spritesDir = path.join(godotDir, "assets", "sprites");
          fs.mkdirSync(spritesDir, { recursive: true });
          let targetName = filename?.trim() || srcName;
          if (!targetName.endsWith(".png")) targetName += ".png";
          // Quelle: User-Ordner (falls vorhanden), sonst global
          const src = userRelPath
            ? path.join(getImagegenOutputDir(), targetName)
            : globalImagePath;
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(spritesDir, targetName));
          }
        } catch {}
      }

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
