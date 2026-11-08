import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { checkPermission, getCurrentUserId } from "../lib/users.js";
import { getImagegenOutputDir } from "../lib/helpers.js";

const IMAGEGEN_SERVICE_URL = process.env.IMAGEGEN_SERVICE_URL || "http://host.docker.internal:8086";
const HOST_WORKSPACE_PATH = process.env.HOST_WORKSPACE_PATH || "/Users/enricostarke/Desktop/pi-agent/workspace";

function toHostPath(p, userId) {
  if (!p) return p;
  if (p.startsWith("/workspace/")) {
    return p.replace("/workspace", HOST_WORKSPACE_PATH);
  }
  return path.join(HOST_WORKSPACE_PATH, "users", userId, p);
}

export default defineTool({
  name: "videogen",
  label: "Video Generator",
  description:
    "Generiert Videos mit Wan 2.2 A14B auf Apple Silicon. " +
    "Text2vid: nur prompt. Img2vid: prompt + source_image (Video startet aus dem Bild). " +
    "Frames werden automatisch auf 4n+1 gerundet. Dauer: mehrere Minuten.",
  parameters: Type.Object({
    prompt: Type.String({ description: "Englische Videobeschreibung (detailliert). Übersetze deutsche Anfragen." }),
    source_image: Type.Optional(Type.String({
      description: "Pfad zum Quellbild → Image-to-Video (Video animiert dieses Bild). " +
                   "Ohne Angabe: Text-to-Video. Relativ zum User-Workspace oder absolut."
    })),
    frames: Type.Optional(Type.Number({ description: "Anzahl Frames, wird auf 4n+1 gerundet (default: 41)" })),
    fps: Type.Optional(Type.Number({ description: "Frames pro Sekunde (default: 10)" })),
    width: Type.Optional(Type.Number({ description: "Breite in Pixel (default: 448)" })),
    height: Type.Optional(Type.Number({ description: "Höhe in Pixel (default: 256)" })),
    steps: Type.Optional(Type.Number({ description: "Denoising-Steps (default: 20)" })),
    guidance: Type.Optional(Type.Number({ description: "Guidance-Scale (default: 4)" })),
    guidance_2: Type.Optional(Type.Number({ description: "Low-noise Guidance für transformer_2 (default: 3)" })),
    seed: Type.Optional(Type.Number({ description: "Zufalls-Seed. Gleicher Seed + Prompt = gleiches Video." })),
    negative_prompt: Type.Optional(Type.String({ description: "Was NICHT vorkommen soll (wird bei guidance > 1 genutzt)" })),
    filename: Type.Optional(Type.String({ description: "Dateiname (z.B. spaceship.mp4)" })),
  }),
  execute: async (_toolCallId, { prompt, source_image, frames, fps, width, height, steps, guidance, guidance_2, seed, negative_prompt, filename }) => {
    const denied = checkPermission("videogen");
    if (denied) return denied;
    try {
      if (!prompt?.trim()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Prompt erforderlich" }) }], details: {} };
      }

      const userId = getCurrentUserId();

      const body = { prompt: prompt.trim() };
      if (frames) body.frames = frames;
      if (fps) body.fps = fps;
      if (width) body.width = width;
      if (height) body.height = height;
      if (steps) body.steps = steps;
      if (guidance) body.guidance = guidance;
      if (guidance_2) body.guidance_2 = guidance_2;
      if (seed !== undefined) body.seed = seed;
      if (negative_prompt) body.negative_prompt = negative_prompt;
      if (source_image) body.init_image = toHostPath(source_image, userId);

      // Video-Generation (14B-Modell) kann sehr lange dauern -> 1h Timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3600000);
      let resp;
      try {
        resp = await fetch(`${IMAGEGEN_SERVICE_URL}/generate-video`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally { clearTimeout(timeout); }

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        return { content: [{ type: "text", text: JSON.stringify({ error: errData.error || `Fehler: ${resp.status}` }) }], details: {} };
      }

      const data = await resp.json();
      if (data.error) return { content: [{ type: "text", text: JSON.stringify({ error: data.error }) }], details: {} };

      const srcName = path.basename(data.path);
      const globalVideoPath = path.join("/workspace", "generated-videos", srcName);

      let userRelPath = null;
      try {
        // generated-videos neben generated-images im User-Ordner
        const userBaseDir = path.dirname(getImagegenOutputDir());
        const userVideosDir = path.join(userBaseDir, "generated-videos");
        fs.mkdirSync(userVideosDir, { recursive: true });
        let targetName = filename?.trim() || srcName;
        if (!targetName.endsWith(".mp4")) targetName += ".mp4";
        const userVideoPath = path.join(userVideosDir, targetName);

        if (fs.existsSync(globalVideoPath)) {
          // BEWEGEN statt kopieren — nur eine Kopie im User-Ordner
          try {
            fs.renameSync(globalVideoPath, userVideoPath);
          } catch {
            fs.copyFileSync(globalVideoPath, userVideoPath);
            try { fs.unlinkSync(globalVideoPath); } catch {}
          }
          userRelPath = path.join("generated-videos", targetName);
        }
      } catch {}

      const result = {
        status: "ok",
        mode: source_image ? "img2vid" : "text2vid",
        path: data.path,
        user_path: userRelPath,
        prompt: prompt.trim(),
      };

      if (userRelPath) result.file_marker = `[FILE:${userId}:${userRelPath}]`;

      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    } catch (e) {
      if (e.name === "AbortError") {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Timeout nach 1h — Video-Generation dauert zu lang. Weniger Frames/Steps versuchen?" }) }], details: {} };
      }
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], details: {} };
    }
  },
});
