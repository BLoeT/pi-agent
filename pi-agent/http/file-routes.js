import fs from "node:fs";
import path from "node:path";
import { resolveWithin, validUserId } from "../lib/security.js";
import { getUserByName, getUserWorkspacePath } from "../lib/users.js";

export function registerFileRoutes(app) {
  app.get("/files/:userId/*splat", (req, res) => {
    const userId = req.params.userId;
    if (!validUserId(userId) || !getUserByName(userId) || (!req.trustedService && userId !== req.userId)) return res.status(403).json({ error: "Zugriff verweigert" });
    try {
      const segments = req.params.splat;
      const relative = Array.isArray(segments) ? segments.join("/") : segments || "";
      const file = resolveWithin(getUserWorkspacePath(userId), relative);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return res.status(404).json({ error: "Datei nicht gefunden" });
      res.download(file, path.basename(file));
    } catch {
      res.status(403).json({ error: "Zugriff verweigert" });
    }
  });

  // Compatibility URL: serve only the authenticated user's own generated image.
  app.get("/images/:filename", (req, res) => {
    if (!/^[\w.-]+\.png$/.test(req.params.filename)) return res.status(400).json({ error: "Ungültiger Bildname" });
    try {
      const file = resolveWithin(getUserWorkspacePath(req.userId), `generated-images/${req.params.filename}`);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return res.status(404).json({ error: "Bild nicht gefunden" });
      res.sendFile(file);
    } catch {
      res.status(403).json({ error: "Zugriff verweigert" });
    }
  });
}
