/**
 * Pi Agent — Entry Point
 *
 * Express-Server mit Multi-User Session-Management.
 * Tools werden aus ./tools/ importiert, Plugins aus /workspace/plugins/ geladen.
 */
import express from "express";
import fs from "fs";
import path from "path";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  DefaultResourceLoader
} from "@earendil-works/pi-coding-agent";

import { setCurrentUser, getUserByName, getUserWorkspacePath } from "./lib/users.js";
import { loadPlugins } from "./lib/plugins.js";
import { Agent, setGlobalDispatcher } from "undici";

// --- Tools ---
import homeassistantTool from "./tools/homeassistant.js";
import musicTool from "./tools/music.js";
import timerTool from "./tools/timer.js";
import weatherTool from "./tools/weather.js";
import newsTool from "./tools/news.js";
import notesTool from "./tools/notes.js";
import calendarTool from "./tools/calendar.js";
import routinesTool from "./tools/routines.js";
import listsTool from "./tools/lists.js";
import weekplannerTool from "./tools/weekplanner.js";
import searchTool from "./tools/search.js";
//import godotTool from "./tools/godot.js";
import imagegenTool from "./tools/imagegen.js";
import flashcardsTool from "./tools/flashcards.js";
import adminTool from "./tools/admin.js";
import developTool from "./tools/develop.js";
import capabilitiesTool from "./tools/capabilities.js";
import cookingTool from "./tools/cooking.js";
import expensesTool from "./tools/expenses.js";
import personalityTool from "./tools/personality.js";
import memoryTool from "./tools/memory.js";
import filesTool from "./tools/files.js";
import projectsTool from "./tools/projects.js";
import proactiveRulesTool from "./tools/proactive_rules.js";
import video from "./tools/video.js";
//import {loadRobloxMcpTools} from "./tools/roblox-mcp-tools.js";

setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

//const robloxTools = await loadRobloxMcpTools();

// --- Express Setup ---
const app = express();
// Base64-Bilder (Vision/Foto) sprengen das Express-Default-Limit (100kb) → hochsetzen.
// Ein Telegram-Foto (~bis 10MB) wird als base64 ~13MB groß.
app.use(express.json({ limit: "20mb" }));

// Serve static chat UI
const __dirname = path.dirname(new URL(import.meta.url).pathname);
app.use(express.static(path.join(__dirname, "public")));

// --- Config ---
// LLM-Provider: "ollama" (lokal, Default) oder "anthropic" (Claude API).
// Umschaltung per Env-Variable LLM_PROVIDER — kein Code-Change nötig.
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "ollama").toLowerCase();

// Default-Modell je Provider (per PI_MODEL überschreibbar).
const DEFAULT_MODEL_BY_PROVIDER = {
  ollama: "qwen3.8:27b",
  anthropic: "claude-sonnet-5", // Alias; exakte ID/Version bei Bedarf in PI_MODEL setzen
};

// Für Bild-Prompts bei Ollama: das SDK spricht Ollama über den OpenAI-kompat-Endpoint
// (/v1/chat/completions), der Bilder nicht zuverlässig akzeptiert (400). Ollamas natives
// /api/chat mit images-Feld funktioniert. Daher gehen Bilder bei Ollama direkt dorthin.
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";

// Bild-Analyse direkt über Ollama /api/chat (natives images-Feld). Ohne Tools/Session —
// reicht für Vision. Gibt den beschreibenden Text zurück.
async function ollamaVision(model, prompt, imageBase64) {
  const resp = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt, images: [imageBase64] }],
      stream: false,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Ollama Vision ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.message?.content || "";
}

// ModelRuntime kapselt Auth + Modell-Katalog (ersetzt AuthStorage + ModelRegistry).
// Async, daher lazy als Singleton initialisiert.
let modelRuntimePromise = null;
function getModelRuntime() {
  if (!modelRuntimePromise) {
    modelRuntimePromise = (async () => {
      const runtime = await ModelRuntime.create({
        authPath: "/root/.pi/agent/auth.json",
        modelsPath: "/root/.pi/agent/models.json",
      });
      if (LLM_PROVIDER === "anthropic") {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) throw new Error("LLM_PROVIDER=anthropic, aber ANTHROPIC_API_KEY ist nicht gesetzt.");
        await runtime.setRuntimeApiKey("anthropic", key);
      } else {
        // Ollama braucht keinen echten Key, aber der Provider muss authentifiziert gelten.
        await runtime.setRuntimeApiKey("ollama", "ollama");
      }
      return runtime;
    })();
  }
  return modelRuntimePromise;
}

const MAX_MESSAGE_LENGTH = 10000;
const IMAGEGEN_SERVICE_URL = process.env.IMAGEGEN_SERVICE_URL || "http://host.docker.internal:8086";

// --- Thinking-Filter ---
// Manche Modelle (qwen3-Style) liefern das Reasoning im Text-Stream mit, oft
// geklammert in <thinking>...</thinking> oder als Text vor </thinking>.
// Das gehört NICHT in die sichtbare Antwort — nur in den Thinking-Bereich.
// Wir reinigen daher den finalen Antwort-Text, damit kein Reasoning durchschlägt.
function stripThinking(text) {
  if (!text) return "";
  let out = text;
  // Geschlossene <thinking>...</thinking>-Blöcke komplett entfernen
  out = out.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  // Offenes <thinking> am Ende (noch nicht geschlossen) entfernen
  out = out.replace(/<thinking>[\s\S]*$/i, "");
  // qwen3-Style: alles vor dem ersten </thinking> ist Reasoning
  const idx = out.search(/<\/thinking>/i);
  if (idx !== -1) {
    out = out.slice(idx + "</thinking>".length);
  }
  // Restliche einzelne Tags säubern
  out = out.replace(/<\/?thinking>/gi, "");
  return out.trim();
}

// --- Multi-User Session Management ---
const coreTools = [proactiveRulesTool, video, homeassistantTool, musicTool, timerTool, weatherTool, newsTool, notesTool, calendarTool, routinesTool, listsTool, weekplannerTool, searchTool, imagegenTool, flashcardsTool, cookingTool, expensesTool, personalityTool, memoryTool, filesTool, projectsTool, adminTool, developTool, capabilitiesTool];

let loadedPlugins = [];
const userSessions = new Map();
const userLocks = new Map();
// Pro User ein AbortController für die gerade laufende Verarbeitung → /cancel
const userAborts = new Map();

async function getSessionForUser(userId) {
  if (!userSessions.has(userId)) {
    const piModel =
      process.env.PI_MODEL ||
      DEFAULT_MODEL_BY_PROVIDER[LLM_PROVIDER] ||
      DEFAULT_MODEL_BY_PROVIDER.ollama;

    const modelRuntime = await getModelRuntime();

    const model = modelRuntime.getModel(LLM_PROVIDER, piModel);

    if (!model) {
      throw new Error(
        `Model "${piModel}" (provider "${LLM_PROVIDER}") not found in registry.`
      );
    }

    const user = getUserByName(userId);
    const userName = user?.name || userId;

    const userPlugins = loadedPlugins
      .filter(
        p =>
          !p.allowed_users ||
          p.allowed_users.length === 0 ||
          p.allowed_users.includes(userId)
      )
      .map(p => p.tool);

    const cwd = getUserWorkspacePath(userId);
    const agentDir = "/root/.pi/agent";

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      additionalExtensionPaths: [
        "/root/.pi/agent/extensions/pi-ollama/src/index.ts",
      ],
    });

    await resourceLoader.reload();

    const thinkingLevel =
      process.env.THINKING_LEVEL ||
      process.env.REASONING_EFFORT;


    const result = await createAgentSession({
      cwd,
      agentDir,
      sessionManager: SessionManager.inMemory(cwd),
      modelRuntime,
      model,
      customTools: [
        ...coreTools,
        ...userPlugins
      ],
      noTools: "builtin",
      resourceLoader,
      ...(thinkingLevel
        ? { thinkingLevel }
        : {}),
    });
    userSessions.set(userId, result.session);
    console.log("Configured thinking:", thinkingLevel);
    console.log("Active thinking:", result.session.thinkingLevel);
  }
  return userSessions.get(userId);
}

function acquireUserLock(userId) {
  if (!userLocks.has(userId)) userLocks.set(userId, Promise.resolve());
  return new Promise(resolve => {
    const current = userLocks.get(userId);
    userLocks.set(userId, current.then(() => new Promise(r => resolve(r))));
  });
}

// --- Routes ---

// Image proxy (for web-chat to display generated images)
app.get("/images/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!/^[\w\-.]+\.png$/.test(filename)) return res.status(400).json({ error: "Invalid filename" });
    const imageResp = await fetch(`${IMAGEGEN_SERVICE_URL}/images/${filename}`);
    if (!imageResp.ok) return res.status(imageResp.status).json({ error: "Not found" });
    const buffer = Buffer.from(await imageResp.arrayBuffer());
    res.set("Content-Type", "image/png").set("Content-Length", buffer.length.toString()).send(buffer);
  } catch (e) {
    res.status(502).json({ error: "ImageGen service not reachable" });
  }
});

// File download (for web-chat + telegram to fetch user files)
app.get("/files/:userId/*splat", (req, res) => {
  try {
    const userId = req.params.userId;
    // Express 5: named wildcard "*splat" arrives as an array of path segments
    const splat = req.params.splat;
    const relPath = Array.isArray(splat) ? splat.join("/") : (splat || "");
    const root = path.resolve(getUserWorkspacePath(userId));
    const absPath = path.resolve(root, relPath);
    // Security: must stay within the user's workspace (robust traversal check)
    const rel = path.relative(root, absPath);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      return res.status(403).json({ error: "Zugriff verweigert" });
    }
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      return res.status(404).json({ error: "Datei nicht gefunden" });
    }
    res.download(absPath, path.basename(absPath));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health
app.get("/health", async (_req, res) => {
  try {
    await getSessionForUser("enrico");
    const activeModel = process.env.PI_MODEL || DEFAULT_MODEL_BY_PROVIDER[LLM_PROVIDER] || DEFAULT_MODEL_BY_PROVIDER.ollama;
    res.json({ status: "ok", provider: LLM_PROVIDER, model: activeModel, multi_user: true, plugins: loadedPlugins.length });
  } catch (e) {
    res.status(503).json({ status: "error", message: e.message });
  }
});

// Cancel — bricht die gerade laufende Verarbeitung eines Users ab.
// Der Client (Web-Chat) ruft das per /cancel auf; der Lock wird im finally
// von /prompt freigegeben, so dass die nächste (gequeue) Nachricht durchläuft.
app.post("/cancel", async (req, res) => {
  const { user_id } = req.body || {};
  const userId = user_id || "enrico";
  const session = userAborts.get(userId);
  if (!session) {
    return res.json({ ok: false, reason: "nichts läuft gerade" });
  }
  try {
    // AgentSession.abort() ist die SDK-eigene Abbruchfunktion.
    await session.abort();
    res.json({ ok: true, user: userId });
  } catch (e) {
    res.status(500).json({ error: "Cancel failed", message: e.message });
  }
});

// Prompt (Multi-User) — unterstützt Streaming (SSE) wenn stream: true,
// sonst klassisches res.json({ response }) (kompatibel mit dem Telegram-Client).
app.post("/prompt", async (req, res) => {
  const { message, user_id, image_base64, stream = false } = req.body;
  const userId = user_id || "enrico";

  const user = getUserByName(userId);
  if (!user) return res.status(403).json({ error: `Unbekannter Nutzer: ${userId}` });

  const release = await acquireUserLock(userId);
  try {
    if (!message) return res.status(400).json({ error: "message required" });
    if (typeof message !== "string") return res.status(400).json({ error: "message must be a string" });
    if (message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: `message too long (max ${MAX_MESSAGE_LENGTH})` });
    if (image_base64 !== undefined && typeof image_base64 !== "string") return res.status(400).json({ error: "image_base64 must be a base64 string" });

    setCurrentUser(userId);
    let s = await getSessionForUser(userId);
    // /cancel greift auf die aktive AgentSession zu und ruft session.abort() auf.
    userAborts.set(userId, s);
    let response = "";
    let fullThinking = "";

    // Kontext-Management: bei Ollama füllt die wachsende Session irgendwann das
    // Context-Window (~32k) → Antworten werden abgeschnitten. Statt die Session hart
    // zu resetten (verliert ALLES), trimmen wir die ältesten Nachrichten weg und
    // behalten die letzten TRIM_KEEP → der aktuelle Gesprächsfaden bleibt erhalten.
    // Kein extra LLM-Call (kein Compaction-Risiko bei Ollama).
    const MAX_SESSION_MESSAGES = 40; // ab hier wird getrimmt
    const TRIM_KEEP = 16;            // so viele letzte Nachrichten bleiben
    try {
      const msgs = s.agent?.state?.messages;
      if (Array.isArray(msgs) && msgs.length > MAX_SESSION_MESSAGES) {
        // Schnittpunkt: die letzten TRIM_KEEP, aber bis zur nächsten User-Nachricht
        // vorrücken — damit wir nicht mitten in einer Tool-Call/Result-Sequenz kappen.
        let cut = msgs.length - TRIM_KEEP;
        while (cut < msgs.length && msgs[cut]?.role !== "user") cut++;
        if (cut >= msgs.length) cut = msgs.length - TRIM_KEEP; // Fallback falls keine User-Msg gefunden
        const kept = msgs.slice(cut);
        s.agent.state.messages = kept;
        console.log(`✂️ [${userId}] Kontext getrimmt: ${msgs.length} → ${kept.length} Nachrichten`);
      }
    } catch (e) {
      // Falls das SDK/die Extension den Zugriff nicht erlaubt: harter Reset als Fallback.
      try {
        const msgCount = s.messages?.length || 0;
        if (msgCount > MAX_SESSION_MESSAGES) {
          console.log(`♻️ [${userId}] Session-Auto-Reset (Trim nicht möglich, ${msgCount} Nachrichten)`);
          s.dispose();
          userSessions.delete(userId);
          s = await getSessionForUser(userId);
        }
      } catch (_) { /* nichts möglich — Session läuft weiter */ }
    }

    // Prepend personality context to first message of session or if personality exists
    const personality = user?.personality;
    let effectiveMessage = message;

    // Build context prefix
    const contextParts = [];

    // Load long-term memory for context
    const memoryDir = path.join(getUserWorkspacePath(userId), "memory");
    const memoryFile = path.join(memoryDir, "long_term.json");
    if (fs.existsSync(memoryFile)) {
      try {
        const mem = JSON.parse(fs.readFileSync(memoryFile, "utf-8"));
        const facts = mem.facts || [];
        if (facts.length > 0) {
          contextParts.push("## Langzeitgedächtnis");
          for (const f of facts.slice(-10)) {
            contextParts.push(`- ${f.text}`);
          }
        }
      } catch (e) {
        // ignore memory read errors
      }
    }

    // Prepend personality to the message context
    if (personality) {
      contextParts.push(`[System: Kommunikationsstil für ${user?.name || userId}: ${personality}]`);
    }

    if (contextParts.length > 0) {
      effectiveMessage = contextParts.join("\n") + "\n\n" + message;
    }

    // --- Bild-Analyse-Pfad (Ollama) ---
    // Ollama über den OpenAI-kompat-Endpoint kann Bilder nicht zuverlässig
    // verarbeiten (400). Für Vision gehen wir direkt an Ollamas natives
    // /api/chat mit images-Feld. Kein Tool-Call, keine Session — reicht für
    // die beschreibende Analyse. Ergebnis wird in die Session-Session gespeichert.
    if (image_base64 && LLM_PROVIDER === "ollama") {
      const model = process.env.PI_MODEL || DEFAULT_MODEL_BY_PROVIDER.ollama;
      const prompt = `Analysiere dieses Bild und beschreibe kurz was zu sehen ist. Wenn es Informationen enthält (Termin, Liste, Betrag), erwähne das. Antworte auf Deutsch.

${effectiveMessage}`;
      try {
        response = await ollamaVision(model, prompt, image_base64);
      } catch (e) {
        console.error("Vision failed:", e.message);
        response = `Bildanalyse fehlgeschlagen: ${e.message}`;
      }
      // Ergebnis in die Session-Session speichern (für Kontext)
      try {
        s.agent?.state?.messages?.push({ role: "user", content: effectiveMessage });
        s.agent?.state?.messages?.push({ role: "assistant", content: response });
      } catch (_) { /* Session-Speicher optional */ }
    } else {
      // --- Normaler Pfad: SDK-Session mit Tools ---
      let clientDisconnected = false;
      res.on("close", () => { clientDisconnected = true; });

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();
      }

      const sendSSE = (data) => {
        if (stream && !clientDisconnected && !res.writableEnded) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      // WICHTIG: prompt() ist ein Promise<void>, kein AsyncIterator.
      // Der SDK-Eventstream wird über session.subscribe() beobachtet.
      const unsubscribe = s.subscribe((event) => {
        if (clientDisconnected) return;

        if (event.type === "message_update") {
          const part = event.assistantMessageEvent;
          if (part?.type === "thinking_delta") {
            const delta = part.delta || "";
            fullThinking += delta;
            sendSSE({ thinking: delta });
          } else if (part?.type === "text_delta") {
            const delta = part.delta || "";
            response += delta;
            sendSSE({ delta });
          }
        } else if (event.type === "tool_execution_start") {
          sendSSE({ tool_call: { name: event.toolName, input: event.args } });
        } else if (event.type === "tool_execution_update") {
          sendSSE({ tool_update: { name: event.toolName, result: event.partialResult } });
        } else if (event.type === "tool_execution_end") {
          sendSSE({ tool_result: {
            name: event.toolName,
            result: event.result,
            isError: event.isError,
          } });
        } else if (event.type === "message_end" && !response) {
          // Fallback für Provider/Modelle, die keinen text_delta liefern.
          const msg = event.message;
          if (msg?.role === "assistant" && Array.isArray(msg.content)) {
            const textPart = msg.content.find(p => p.type === "text" && p.thinking !== true);
            if (textPart?.text) {
              const clean = stripThinking(textPart.text);
              if (clean) {
                response = clean;
                sendSSE({ delta: clean });
              }
            }
          }
        }
      });

      try {
        // prompt() erst nach subscribe() starten, damit kein Event verloren geht.
        await s.prompt(effectiveMessage);
      } finally {
        unsubscribe();
      }

      response = stripThinking(response);

      if (stream) {
        sendSSE({
          done: true,
          full_text: response,
          full_thinking: fullThinking,
        });
        sendSSE("[DONE]");
        if (!res.writableEnded) res.end();
        return;
      }
    }

    // Finale Reinigung für beide Pfade (Vision + SDK), bevor die Antwort rausgeht
    response = stripThinking(response);

    if (stream) {
      // bereits oben gesendet
    } else {
      res.json({
        response,
        thinking: fullThinking,
      });
    }
  } catch (e) {
    if (stream) {
      try {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (_) { /* client weg */ }
    } else {
      res.status(500).json({ error: e.message });
    }
  } finally {
    userAborts.delete(userId);
    release();
  }
});

// Reset
app.post("/reset", async (req, res) => {
  try {
    const { user_id } = req.body || {};
    if (user_id) {
      const s = userSessions.get(user_id);
      if (s) s.dispose();
      userSessions.delete(user_id);
      res.json({ ok: true, user: user_id });
    } else {
      for (const [, s] of userSessions) s.dispose();
      userSessions.clear();
      res.json({ ok: true, reset: "all" });
    }
  } catch (e) {
    res.status(500).json({ error: "Reset failed", message: e.message });
  }
});

// --- Startup ---
loadPlugins().then(plugins => {
  loadedPlugins = plugins;
  console.log(`🔌 ${plugins.length} Plugin(s) geladen`);
  app.listen(8080, () => {
    console.log("Pi agent listening on :8080");
    console.log("🏠 HA integration via ha-service");
    console.log("🎵 Music via hey-ribo");
    console.log("👥 Multi-User enabled");
    console.log("🔌 Plugin-System aktiv");
  });
}).catch(e => {
  console.error("Plugin loading failed:", e.message);
  app.listen(8080, () => console.log("Pi agent listening on :8080 (plugins failed)"));
});
