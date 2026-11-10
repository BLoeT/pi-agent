import express from "express";
import {registerModelRoutes} from "./http/model-routes.js";
import {registerUploadRoutes} from "./http/upload-routes.js";
import { randomUUID } from "node:crypto";
import { authentication } from "./lib/http-security.js";
import { validUserId } from "./lib/security.js";
import { getUserByName, runAsUser } from "./lib/users.js";
import { registerChatRoutes } from "./http/chat-routes.js";
import { registerFileRoutes } from "./http/file-routes.js";
import { clientError, redact } from "../shared/errors.js";

export function createApp({ config, chat }) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const started = performance.now();
    res.on("finish",() => console.log(JSON.stringify({event:"http_duration",request_id:req.requestId,
      ms:Math.round(performance.now()-started),status:res.statusCode})));
    req.requestId = randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    next();
  });
  app.use(authentication({ token: config.internalToken, username: config.webUser, password: config.webPassword, getUser: getUserByName }));
  app.use((req,res,next) => {
    const id = req.headers["x-request-id"];
    if (req.trustedService && typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
      req.requestId = id; res.setHeader("X-Request-ID",id);
    }
    next();
  });
  app.use(express.json({ limit: "20mb" }));
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    const requested = req.body?.user_id;
    const userId = req.trustedService ? requested || config.webUser : req.authenticatedUser;
    if (!validUserId(userId) || !getUserByName(userId)) return res.status(403).json({ error: "Ungültiger Nutzer" });
    if (!req.trustedService && requested !== undefined && requested !== userId) return res.status(403).json({ error: "Fremde Identität verweigert" });
    req.userId = userId;
    runAsUser(userId, next, { scheduled: req.trustedService && req.body?.delivery_mode === "scheduler", requestId: req.requestId });
  });
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  registerFileRoutes(app);
  registerUploadRoutes(app);
  registerModelRoutes(app,{chat});
  registerChatRoutes(app, { chat, config });
  app.use(express.static(config.publicDir));
  app.use((_req, res) => res.status(404).json({ error: "Nicht gefunden", code: "NOT_FOUND" }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const failure = clientError(error);
    if (failure.status >= 500) console.error(JSON.stringify({ event: "request_failed", requestId: req.requestId, message: redact(error.message) }));
    res.status(failure.status).json({ ...failure.body, request_id: req.requestId });
  });
  return app;
}
