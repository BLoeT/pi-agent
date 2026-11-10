import { HttpError, redact } from "../../shared/errors.js";
import { createResponder } from "./respond.js";

export function validatePrompt(body, config) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Ungültige Anfrage");
  const { message, image_base64: image, thinking_level: thinkingLevel, image_name:imageName, stream = false } = body;
  if (typeof message !== "string" || !message.trim() || message.length > config.maxMessageLength) throw new HttpError(400, "Ungültige Nachricht");
  if (typeof stream !== "boolean") throw new HttpError(400, "Ungültiger Streaming-Wert");
  if (image !== undefined && (typeof image !== "string" || image.length > config.maxImageLength || !/^[A-Za-z0-9+/]+={0,2}$/.test(image))) throw new HttpError(400, "Ungültiges Bild");
  if (thinkingLevel !== undefined && !["off", "low", "medium", "high", "xhigh"].includes(thinkingLevel)) throw new HttpError(400, "Ungültiger Denkmodus");
  if(imageName!==undefined && (typeof imageName!=="string" || imageName.length>130 || !image))throw new HttpError(400,"Ungültiger Bildname");
  return { message, image, imageName, thinkingLevel, stream };
}

export function registerChatRoutes(app, { chat, config }) {
  app.post("/prompt", async (req, res) => {
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    const responder = createResponder(res, req.body?.stream === true, req.requestId);
    res.on("close", disconnected);
    try {
      const input = validatePrompt(req.body, config);
      const result = await chat.prompt({
        ...input,
        userId: req.userId,
        requestId: req.requestId,
        scheduled: req.trustedService && req.body.delivery_mode === "scheduler",
        signal: controller.signal,
        onReady: responder.open,
        onEvent: responder.event,
      });
      responder.complete(result);
    } catch (error) {
      if (error.name !== "AbortError") console.error(JSON.stringify({ event: "prompt_failed", requestId: req.requestId, message: redact(error.message) }));
      responder.error(error);
    } finally {
      res.off("close", disconnected);
    }
  });

  app.post("/cancel", async (req, res) => {
    const cancelled = await chat.cancel(req.userId);
    res.json(cancelled ? { ok: true, user: req.userId } : { ok: false, reason: "nichts läuft gerade" });
  });

  app.post("/reset", (req, res) => {
    chat.reset(req.userId);
    res.json({ ok: true, user: req.userId });
  });
}
