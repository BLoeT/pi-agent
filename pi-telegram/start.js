/**
 * Pi-Telegram Bot
 * 
 * Standalone Telegram bot that:
 * - Receives text messages → forwards to pi-agent /prompt → responds with text + voice
 * - Receives voice messages → transcribes via hey-ribo /transcribe → forwards to /prompt → responds with text + voice
 * - Falls back to text-only if TTS fails
 */

import { Bot, InputFile } from "node-telegram-bot-api";
import { run } from "node-telegram-bot-api/node";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Agent, setGlobalDispatcher } from "undici";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AGENT_URL = process.env.AGENT_URL || "http://pi-agent:8080";
const RIBO_URL = process.env.RIBO_URL || "http://host.docker.internal:8085";
const USERS_CONFIG_URL = process.env.USERS_CONFIG_URL || `${AGENT_URL.replace('/prompt', '')}/users`;

setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN nicht gesetzt!");
  process.exit(1);
}

// --- Multi-User Auth ---

// Load users config from workspace (mounted volume)
const USERS_CONFIG_PATH = "/workspace/users.json";

function loadUsersConfig() {
  try {
    if (!fs.existsSync(USERS_CONFIG_PATH)) return { users: {}, groups: {} };
    const content = fs.readFileSync(USERS_CONFIG_PATH, "utf-8");
    return JSON.parse(content);
  } catch (e) {
    console.error("⚠️ Failed to load users.json:", e.message);
    return { users: {}, groups: {} };
  }
}

function getUserByChatId(chatId) {
  const config = loadUsersConfig();
  for (const [id, user] of Object.entries(config.users)) {
    if (user.chat_id === chatId) return { id, ...user };
  }
  return null;
}

function getAllowedChatIds() {
  const config = loadUsersConfig();
  return Object.values(config.users)
    .filter(u => u.chat_id != null)
    .map(u => u.chat_id);
}

function isAuthorized(chatId) {
  const allowedIds = getAllowedChatIds();
  if (allowedIds.length === 0) return false; // No users configured → block all
  return allowedIds.includes(chatId);
}

function getUserIdForChat(chatId) {
  const user = getUserByChatId(chatId);
  return user ? user.id : null;
}

// --- Bot Setup ---
const bot = new Bot(TELEGRAM_BOT_TOKEN);
console.log("🤖 Telegram Bot gestartet (polling, Multi-User)...");
console.log(`   Agent: ${AGENT_URL}`);
console.log(`   TTS/STT: ${RIBO_URL}`);
const configuredUsers = loadUsersConfig();
const userNames = Object.entries(configuredUsers.users)
  .filter(([_, u]) => u.chat_id != null)
  .map(([id, u]) => u.name || id);
console.log(`   Erlaubte Nutzer: ${userNames.length > 0 ? userNames.join(", ") : "keine (Chat-IDs in users.json eintragen!)"}`);

// --- Helper Functions ---

const AGENT_TIMEOUT = 3_600_000; // 1 H timeout for LLM responses
const MAX_RETRIES = 2;
const RETRY_DELAY = 2000;

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT);
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return resp;
    } catch (e) {
      if (e.name === "AbortError") {
        throw new Error("Timeout — Agent antwortet nicht");
      }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, RETRY_DELAY));
        continue;
      }
      throw e;
    }
  }
}

async function sendToAgent(message, userId, imageBase64 = null) {
  const body = { message, user_id: userId };
  if (imageBase64) body.image_base64 = imageBase64;
  const resp = await fetchWithRetry(`${AGENT_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`Agent returned ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.response || "";
}

async function textToSpeech(text) {
  const resp = await fetch(`${RIBO_URL}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) {
    throw new Error(`TTS returned ${resp.status}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  return buffer;
}

async function transcribeAudio(audioBuffer) {
  const resp = await fetch(`${RIBO_URL}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "audio/ogg" },
    body: audioBuffer,
  });
  if (!resp.ok) {
    throw new Error(`Transcribe returned ${resp.status}`);
  }
  const data = await resp.json();
  return data.text || "";
}

async function downloadTelegramFile(fileId) {
  // v2: resolve file_path via getFile, then download from the file API endpoint
  const file = await bot.api.getFile({ file_id: fileId });
  if (!file?.file_path) throw new Error("file_path nicht verfügbar");
  const fileLink = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const resp = await fetch(fileLink);
  if (!resp.ok) {
    throw new Error(`Failed to download file: ${resp.status}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

async function sendResponseWithVoice(chatId, text, replyToMessageId) {
  // Guard against empty responses
  if (!text || !text.trim()) {
    await bot.api.sendMessage({ chat_id: chatId, text: "🤷 Keine Antwort vom Agent erhalten.", reply_parameters: { message_id: replyToMessageId } });
    return;
  }

  // Marker: [IMAGE:userId:relPath] → als Foto, [FILE:userId:relPath] → als Dokument
  const imageMarker = text.match(/\[IMAGE:([^:]+):([^\]]+)\]/);
  const fileMarker = text.match(/\[FILE:([^:]+):([^\]]+)\]/);
  const cleanText = text.replace(/\[(FILE|IMAGE):[^\]]+\]/g, "").trim();

  // Always send text first (without any marker)
  await bot.api.sendMessage({ chat_id: chatId, text: cleanText || "📎 Anbei:", reply_parameters: { message_id: replyToMessageId } });

  // If a file marker was found, send the file as a document
  if (fileMarker) {
    try {
      const fileUserId = fileMarker[1];
      const relPath = fileMarker[2];
      const fileUrl = `${AGENT_URL}/files/${fileUserId}/${relPath}`;
      const fileResp = await fetch(fileUrl);
      if (fileResp.ok) {
        const buffer = new Uint8Array(await fileResp.arrayBuffer());
        const filename = relPath.split("/").pop();
        await bot.api.sendDocument({
          chat_id: chatId,
          document: new InputFile(buffer, { filename }),
          reply_parameters: { message_id: replyToMessageId },
        });
      }
    } catch (e) {
      console.warn(`⚠️  File send failed: ${e.message}`);
    }
  }

  // If an image marker was found, send it as a photo (from the user's workspace)
  if (imageMarker) {
    try {
      const imgUserId = imageMarker[1];
      const relPath = imageMarker[2];
      const imageUrl = `${AGENT_URL}/files/${imgUserId}/${relPath}`;
      const imgResp = await fetch(imageUrl);
      if (imgResp.ok) {
        const imgBuffer = new Uint8Array(await imgResp.arrayBuffer());
        const filename = relPath.split("/").pop();
        await bot.api.sendPhoto({
          chat_id: chatId,
          photo: new InputFile(imgBuffer, { filename }),
          reply_parameters: { message_id: replyToMessageId },
        });
      }
    } catch (e) {
      console.warn(`⚠️  Image send failed: ${e.message}`);
    }
  }

  // Try to send voice message
  try {
    if (text.length > 1000) {
      // Too long for TTS — skip voice
      return;
    }
    const oggBuffer = await textToSpeech(text);
    await bot.api.sendVoice({
      chat_id: chatId,
      voice: new InputFile(new Uint8Array(oggBuffer), { filename: "voice.ogg" }),
      reply_parameters: { message_id: replyToMessageId },
    });
  } catch (e) {
    console.warn(`⚠️  TTS/Voice Fallback (text-only): ${e.message}`);
    // Text was already sent — voice is just a bonus
  }
}

// --- Message Handlers ---

bot.on("message", async (ctx) => {
  const msg = ctx.message;
  const chatId = ctx.chat?.id;
  if (!msg || chatId == null) return;
  const messageId = msg.message_id;

  // Handle /id command BEFORE auth (so anyone can find their chat ID)
  if (msg.text === "/id") {
    await bot.api.sendMessage({ chat_id: chatId, text: `Deine Chat-ID: \`${chatId}\`\n\nGib diese ID einem Admin damit er dich freischalten kann.`, parse_mode: "Markdown" });
    return;
  }

  // Auth check
  if (!isAuthorized(chatId)) {
    console.warn(`⛔ Unauthorized access from chat ${chatId} (@${ctx.from?.username || "unknown"})`);
    await bot.api.sendMessage({ chat_id: chatId, text: "⛔ Kein Zugriff. Schick /id um deine Chat-ID herauszufinden, dann frag einen Admin dich freizuschalten." });
    return;
  }

  // Resolve user
  const userId = getUserIdForChat(chatId);
  if (!userId) {
    await bot.api.sendMessage({ chat_id: chatId, text: "⛔ Nutzer nicht zugeordnet. Chat-ID prüfen." });
    return;
  }

  // Handle /start command
  if (msg.text === "/start") {
    const user = getUserByChatId(chatId);
    const name = user?.name || userId;
    await bot.api.sendMessage({ chat_id: chatId, text: `👋 Hallo ${name}! Ich bin Ribo, dein persönlicher Assistent.\n\nSchick mir eine Text- oder Sprachnachricht und ich helfe dir gerne.\n\nBefehle: /reset (neuer Chat), /id (Chat-ID anzeigen)` });
    return;
  }

  // Handle /reset command (fresh conversation context)
  if (msg.text === "/reset") {
    try {
      const resp = await fetch(`${AGENT_URL}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      if (resp.ok) {
        await bot.api.sendMessage({ chat_id: chatId, text: "🔄 Neuer Chat gestartet. Ich habe unser bisheriges Gespräch vergessen (dein Langzeitgedächtnis bleibt erhalten)." });
      } else {
        await bot.api.sendMessage({ chat_id: chatId, text: "❌ Reset fehlgeschlagen." });
      }
    } catch (e) {
      await bot.api.sendMessage({ chat_id: chatId, text: "❌ Reset fehlgeschlagen." });
    }
    return;
  }

  // Handle voice messages
  if (msg.voice || msg.audio) {
    const fileId = msg.voice?.file_id || msg.audio?.file_id;
    try {
      await bot.api.sendChatAction({ chat_id: chatId, action: "typing" });

      // Download voice file from Telegram
      const audioBuffer = await downloadTelegramFile(fileId);

      // Transcribe
      const transcribedText = await transcribeAudio(audioBuffer);
      if (!transcribedText || transcribedText.length < 2) {
        await bot.api.sendMessage({ chat_id: chatId, text: "🤷 Ich habe nichts verstanden. Versuch es nochmal.", reply_parameters: { message_id: messageId } });
        return;
      }

      // Show what was understood
      await bot.api.sendMessage({ chat_id: chatId, text: `🎤 _${transcribedText}_`, parse_mode: "Markdown", reply_parameters: { message_id: messageId } });

      // Forward to agent with user context
      await bot.api.sendChatAction({ chat_id: chatId, action: "typing" });
      const response = await sendToAgent(transcribedText, userId);

      // Send response with voice
      await sendResponseWithVoice(chatId, response, messageId);
    } catch (e) {
      console.error(`❌ [${userId}] Voice handling error:`, e.message);
      await bot.api.sendMessage({ chat_id: chatId, text: "❌ Fehler bei der Verarbeitung der Sprachnachricht.", reply_parameters: { message_id: messageId } });
    }
    return;
  }

  // Handle photos
  if (msg.photo) {
    try {
      await bot.api.sendChatAction({ chat_id: chatId, action: "typing" });

      // Get the highest resolution photo
      const photo = msg.photo[msg.photo.length - 1];
      const photoBuffer = await downloadTelegramFile(photo.file_id);
      const imageBase64 = photoBuffer.toString("base64");

      const caption = (msg.caption || "").trim().toLowerCase();
        
      console.log(`${caption}`);
      console.log(caption.includes("speichern") || caption.includes("save") || caption.includes("speicher"));

      // "speichern" / "save" → direkt im Workspace ablegen
      if (caption.includes("speichern") || caption.includes("save") || caption.includes("speicher")) {
        const inboxDir = `/workspace/users/${userId}/telegram-inbox`;
        if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });

        const mime = (photo.file_unique_id || "jpg").match(/jpg|jpeg|png|webp/i)?.[0]?.toLowerCase() || "jpg";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const filename = `telegram_${timestamp}.${mime === "jpeg" ? "jpg" : mime}`;
        const filePath = path.join(inboxDir, filename);

        fs.writeFileSync(filePath, photoBuffer);
        console.log(`[STORAGE] ${userId}: ${filePath} (${(photoBuffer.length / 1024).toFixed(0)} KB)`);

        await bot.api.sendMessage({
          chat_id: chatId,
          text: `Bild gespeichert als ${filename} (${(photoBuffer.length / 1024).toFixed(0)} KB)\n${filePath}`,
          reply_parameters: { message_id: messageId },
        });
        return;
      }

      // Standard: Vision-Analyse
      const prompt = caption
        ? `Ich habe dir ein Foto geschickt mit dem Hinweis: "${msg.caption}". Schau es dir an und handle entsprechend.`
        : `Ich habe dir ein Foto geschickt. Schau es dir an: Wenn es nützliche Informationen enthält (Termine, Einkaufslisten, Beträge, Notizen), schlage mir vor was ich damit tun kann — z.B. in den Kalender eintragen, auf eine Liste setzen, oder als Notiz speichern. Frage mich bevor du etwas speicherst.`;

      const response = await sendToAgent(prompt, userId, imageBase64);
      await sendResponseWithVoice(chatId, response, messageId);
    } catch (e) {
      console.error(`[${userId}] Photo handling error:`, e.message);
      await bot.api.sendMessage({ chat_id: chatId, text: "Fehler bei der Bildverarbeitung.", reply_parameters: { message_id: messageId } });
    }
    return;
  }

  /*
  // Handle photos
  if (msg.photo) {
    try {
      await bot.api.sendChatAction({ chat_id: chatId, action: "typing" });

      // Get the highest resolution photo
      const photo = msg.photo[msg.photo.length - 1];
      const photoBuffer = await downloadTelegramFile(photo.file_id);
      const imageBase64 = photoBuffer.toString("base64");

      // Ein Aufruf: Bild + Prompt direkt an das multimodale Modell (mit Tools/Session/Memory)
      const caption = msg.caption || "";
      const prompt = caption
        ? `Ich habe dir ein Foto geschickt mit dem Hinweis: "${caption}". Schau es dir an und handle entsprechend.`
        : `Ich habe dir ein Foto geschickt. Schau es dir an: Wenn es nützliche Informationen enthält (Termine, Einkaufslisten, Beträge, Notizen), schlage mir vor was ich damit tun kann — z.B. in den Kalender eintragen, auf eine Liste setzen, oder als Notiz speichern. Frage mich bevor du etwas speicherst.`;

      const response = await sendToAgent(prompt, userId, imageBase64);

      // Send response with voice
      await sendResponseWithVoice(chatId, response, messageId);
    } catch (e) {
      console.error(`❌ [${userId}] Photo handling error:`, e.message);
      await bot.api.sendMessage({ chat_id: chatId, text: "❌ Fehler bei der Bildanalyse.", reply_parameters: { message_id: messageId } });
    }
    return;
  }
    */

  // Handle text messages
  if (msg.text && !msg.text.startsWith("/")) {
    // Check if this is a habit confirmation response
    const habitResult = checkHabitConfirmation(userId, msg.text);
    if (habitResult) {
      if (habitResult.confirmed) {
        await bot.api.sendMessage({ chat_id: chatId, text: `✅ Alles klar! "${habitResult.name}" ist jetzt aktiv. Ich schicke dir das automatisch.`, reply_parameters: { message_id: messageId } });
      } else {
        await bot.api.sendMessage({ chat_id: chatId, text: `👍 Okay, mache ich nicht. Kein Problem.`, reply_parameters: { message_id: messageId } });
      }
      return;
    }

    try {
      await bot.api.sendChatAction({ chat_id: chatId, action: "typing" });

      const response = await sendToAgent(msg.text, userId);

      await sendResponseWithVoice(chatId, response, messageId);
    } catch (e) {
      console.error(`❌ [${userId}] Text handling error:`, e.message);
      await bot.api.sendMessage({ chat_id: chatId, text: "❌ Fehler bei der Verarbeitung.", reply_parameters: { message_id: messageId } });
    }
    return;
  }
});

// --- Error handling ---
// v2: handler errors are routed to the error boundary instead of a "polling_error" event
bot.catch((err) => {
  console.error("❌ Handler error:", err?.message || err);
});

// --- Reminder Service (Background Loop) ---

const REMINDER_CHECK_INTERVAL = 2 * 60 * 1000; // 2 minutes
const REMINDER_SENT_FILE = "/workspace/reminder_sent.json";

function loadSentReminders() {
  try {
    if (!fs.existsSync(REMINDER_SENT_FILE)) return {};
    return JSON.parse(fs.readFileSync(REMINDER_SENT_FILE, "utf-8"));
  } catch (_) { return {}; }
}

function saveSentReminders(sent) {
  try {
    fs.writeFileSync(REMINDER_SENT_FILE, JSON.stringify(sent, null, 2), "utf-8");
  } catch (_) {}
}

function parseIcsDtstart(line) {
  // Parse DTSTART:20260815T140000 or DTSTART;VALUE=DATE:20260815
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const val = line.slice(colonIdx + 1).trim();
  if (val.length >= 15) {
    // DateTime: 20260815T140000
    const y = parseInt(val.slice(0, 4), 10);
    const m = parseInt(val.slice(4, 6), 10) - 1;
    const d = parseInt(val.slice(6, 8), 10);
    const h = parseInt(val.slice(9, 11), 10);
    const min = parseInt(val.slice(11, 13), 10);
    return new Date(y, m, d, h, min, 0);
  } else if (val.length >= 8) {
    // Date only: 20260815
    const y = parseInt(val.slice(0, 4), 10);
    const m = parseInt(val.slice(4, 6), 10) - 1;
    const d = parseInt(val.slice(6, 8), 10);
    return new Date(y, m, d, 9, 0, 0); // Default 9:00 for all-day
  }
  return null;
}

function parseTriggerMinutes(trigger) {
  // Parse TRIGGER:-PT1H or TRIGGER:-P1D or TRIGGER:-P1DT2H30M
  const match = trigger.match(/TRIGGER:\s*-P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return null;
  const days = parseInt(match[1] || "0", 10);
  const hours = parseInt(match[2] || "0", 10);
  const mins = parseInt(match[3] || "0", 10);
  return days * 1440 + hours * 60 + mins;
}

function extractRemindersFromIcs(icsContent) {
  const reminders = [];
  const lines = icsContent.split(/\r?\n/);
  let inEvent = false;
  let inAlarm = false;
  let currentSummary = "";
  let currentDtstart = null;
  let currentTrigger = null;
  let currentUid = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true;
      currentSummary = "";
      currentDtstart = null;
      currentUid = "";
    } else if (trimmed === "END:VEVENT") {
      inEvent = false;
      inAlarm = false;
    } else if (trimmed === "BEGIN:VALARM") {
      inAlarm = true;
      currentTrigger = null;
    } else if (trimmed === "END:VALARM") {
      if (inAlarm && currentDtstart && currentTrigger != null) {
        const reminderTime = new Date(currentDtstart.getTime() - currentTrigger * 60 * 1000);
        reminders.push({
          uid: currentUid,
          summary: currentSummary,
          eventTime: currentDtstart,
          triggerMinutes: currentTrigger,
          reminderTime,
        });
      }
      inAlarm = false;
      currentTrigger = null;
    } else if (inEvent && !inAlarm) {
      if (trimmed.startsWith("SUMMARY:")) {
        currentSummary = trimmed.slice(8);
      } else if (trimmed.startsWith("DTSTART")) {
        currentDtstart = parseIcsDtstart(trimmed);
      } else if (trimmed.startsWith("UID:")) {
        currentUid = trimmed.slice(4);
      }
    } else if (inAlarm) {
      if (trimmed.startsWith("TRIGGER:")) {
        currentTrigger = parseTriggerMinutes(trimmed);
      }
    }
  }
  return reminders;
}

function formatReminderDuration(minutes) {
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    return days === 1 ? "in 1 Tag" : `in ${days} Tagen`;
  }
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return hours === 1 ? "in 1 Stunde" : `in ${hours} Stunden`;
  }
  return `in ${minutes} Minuten`;
}

async function checkReminders() {
  const config = loadUsersConfig();
  const now = new Date();
  const sentReminders = loadSentReminders();
  let changed = false;

  for (const [userId, user] of Object.entries(config.users)) {
    if (!user.chat_id) continue;

    // Collect all calendar files for this user
    const calendarFiles = [];

    // Personal calendar
    const personalCal = path.join("/workspace", "users", userId, "calendar.ics");
    if (fs.existsSync(personalCal)) calendarFiles.push(personalCal);

    // Shared group calendars
    if (user.groups) {
      for (const groupId of user.groups) {
        const sharedCal = path.join("/workspace", "shared", groupId, "calendar.ics");
        if (fs.existsSync(sharedCal)) calendarFiles.push(sharedCal);
      }
    }

    for (const calFile of calendarFiles) {
      try {
        const content = fs.readFileSync(calFile, "utf-8");
        const reminders = extractRemindersFromIcs(content);

        for (const reminder of reminders) {
          // Check if reminder is due (within last 3 minutes window)
          const diff = now.getTime() - reminder.reminderTime.getTime();
          if (diff >= 0 && diff < 3 * 60 * 1000) {
            // Build unique key to avoid double-sending
            const key = `${userId}:${reminder.uid}:${reminder.triggerMinutes}`;
            if (sentReminders[key]) continue;

            // Send reminder
            const timeStr = reminder.eventTime.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
            const dateStr = reminder.eventTime.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
            const durationText = formatReminderDuration(reminder.triggerMinutes);
            const message = `⏰ Erinnerung: "${reminder.summary}" ${durationText} (${dateStr}, ${timeStr} Uhr)`;

            try {
              await bot.api.sendMessage({ chat_id: user.chat_id, text: message });
              console.log(`🔔 [${userId}] Reminder sent: ${reminder.summary}`);
            } catch (e) {
              console.error(`❌ [${userId}] Reminder send failed:`, e.message);
            }

            sentReminders[key] = now.toISOString();
            changed = true;
          }
        }
      } catch (e) {
        // Skip unreadable calendar files
      }
    }
  }

  // Cleanup old sent reminders (older than 2 days)
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  for (const [key, timestamp] of Object.entries(sentReminders)) {
    if (new Date(timestamp) < twoDaysAgo) {
      delete sentReminders[key];
      changed = true;
    }
  }

  if (changed) saveSentReminders(sentReminders);
}

// Start reminder check loop
setInterval(checkReminders, REMINDER_CHECK_INTERVAL);
// Also check once on startup (after 10s to let things settle)
setTimeout(checkReminders, 10000);
console.log(`🔔 Reminder-Service aktiv (prüft alle ${REMINDER_CHECK_INTERVAL / 1000}s)`);

// --- Proactive Messages & Habits Service ---

const PROACTIVE_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const HABITS_ANALYSIS_INTERVAL = 24 * 60 * 60 * 1000; // once per day
const PROACTIVE_RULES_FILE = "/workspace/proactive_rules.json";
const HABITS_LAST_ANALYSIS = "/workspace/habits_last_analysis.json";

function loadProactiveRules() {
  try {
    if (!fs.existsSync(PROACTIVE_RULES_FILE)) return [];
    return JSON.parse(fs.readFileSync(PROACTIVE_RULES_FILE, "utf-8"));
  } catch (_) { return []; }
}

function saveProactiveRules(rules) {
  fs.writeFileSync(PROACTIVE_RULES_FILE, JSON.stringify(rules, null, 2), "utf-8");
}

function loadLastAnalysis() {
  try {
    if (!fs.existsSync(HABITS_LAST_ANALYSIS)) return {};
    return JSON.parse(fs.readFileSync(HABITS_LAST_ANALYSIS, "utf-8"));
  } catch (_) { return {}; }
}

function saveLastAnalysis(data) {
  fs.writeFileSync(HABITS_LAST_ANALYSIS, JSON.stringify(data, null, 2), "utf-8");
}

// Execute a proactive rule: send the result of an agent prompt to the user
async function executeProactiveRule(rule, user) {
  if (!user.chat_id) return;
  try {
    const resp = await fetch(`${AGENT_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: rule.prompt, user_id: rule.userId }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const response = data.response;
    if (response && response.trim()) {
      await bot.api.sendMessage({ chat_id: user.chat_id, text: `💡 ${response}` });
      console.log(`💡 [${rule.userId}] Proactive: ${rule.name}`);
    }
  } catch (e) {
    console.error(`❌ Proactive rule failed (${rule.name}):`, e.message);
  }
}

// Check if any proactive rules should fire right now
async function checkProactiveRules() {
  const rules = loadProactiveRules();
  if (rules.length === 0) return;

  const now = new Date();
  const currentWeekday = now.toLocaleDateString("de-DE", { weekday: "long" }).toLowerCase();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const config = loadUsersConfig();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Check if time matches (within 5 min window)
    const ruleHour = rule.hour ?? -1;
    const ruleMinute = rule.minute ?? 0;
    if (ruleHour < 0 || ruleHour > 23) continue;

    const timeDiff = (currentHour * 60 + currentMinute) - (ruleHour * 60 + ruleMinute);
    if (timeDiff < 0 || timeDiff >= 5) continue; // Only fire within 5-min window

    // Check weekday filter
    if (rule.weekdays && rule.weekdays.length > 0) {
      if (!rule.weekdays.includes(currentWeekday)) continue;
    }

    // Check if already sent today
    const sentKey = `${rule.id}:${now.toISOString().split("T")[0]}`;
    const sentReminders = loadSentReminders();
    if (sentReminders[sentKey]) continue;

    // Find user
    const user = config.users[rule.userId];
    if (!user || !user.chat_id) continue;

    // Execute
    await executeProactiveRule(rule, user);

    // Mark as sent today
    sentReminders[sentKey] = now.toISOString();
    saveSentReminders(sentReminders);
  }
}

// Analyze habits log and suggest new proactive rules
async function analyzeHabits() {
  const lastAnalysis = loadLastAnalysis();
  const now = new Date();

  // Only run once per day
  if (lastAnalysis.lastRun) {
    const lastRun = new Date(lastAnalysis.lastRun);
    if (now.getTime() - lastRun.getTime() < HABITS_ANALYSIS_INTERVAL) return;
  }

  const config = loadUsersConfig();
  const existingRules = loadProactiveRules();

  for (const [userId, user] of Object.entries(config.users)) {
    if (!user.chat_id) continue;

    // Read habits log
    const habitsFile = path.join("/workspace", "users", userId, "memory", "habits_log.json");
    if (!fs.existsSync(habitsFile)) continue;

    let log;
    try { log = JSON.parse(fs.readFileSync(habitsFile, "utf-8")); } catch (_) { continue; }
    if (log.length < 14) continue; // Need at least 2 weeks of data

    // Analyze patterns: find tools used at similar times on similar days
    const patterns = {};
    for (const entry of log) {
      const key = `${entry.weekday}:${entry.hour}:${entry.tool}`;
      if (!patterns[key]) patterns[key] = 0;
      patterns[key]++;
    }

    // Find patterns that occur 3+ times (strong habit)
    for (const [key, count] of Object.entries(patterns)) {
      if (count < 3) continue;

      const [weekday, hour, tool] = key.split(":");
      const ruleId = `habit:${userId}:${weekday}:${hour}:${tool}`;

      // Skip if already a rule (confirmed or rejected)
      if (existingRules.some(r => r.id === ruleId)) continue;

      // Skip if already suggested and rejected
      if (lastAnalysis.rejected && lastAnalysis.rejected.includes(ruleId)) continue;

      // Build suggestion prompt based on tool
      let prompt = "";
      let name = "";
      let description = "";
      switch (tool) {
        case "weather":
          prompt = "Wie ist das Wetter heute?";
          name = `Wetter ${weekday}s um ${hour} Uhr`;
          description = "dem Wetter";
          break;
        case "calendar":
          prompt = "Was steht heute an?";
          name = `Termine ${weekday}s um ${hour} Uhr`;
          description = "deinen Terminen";
          break;
        case "news":
          prompt = "Was gibt es Neues? Kurze Zusammenfassung.";
          name = `Nachrichten ${weekday}s um ${hour} Uhr`;
          description = "Nachrichten";
          break;
        case "notes":
          prompt = "Welche Notizen habe ich? Kurze Übersicht.";
          name = `Notizen ${weekday}s um ${hour} Uhr`;
          description = "deinen Notizen";
          break;
        case "lists":
          prompt = "Zeig mir meine offenen Listen.";
          name = `Listen-Übersicht ${weekday}s um ${hour} Uhr`;
          description = "deinen Listen";
          break;
        case "music":
          prompt = "Spiel Musik (letzter Sender).";
          name = `Musik ${weekday}s um ${hour} Uhr`;
          description = "Musik";
          break;
        case "flashcards":
          prompt = "Habe ich fällige Lernkarten? Zeig mir den Status.";
          name = `Lernkarten-Check ${weekday}s um ${hour} Uhr`;
          description = "deinen Lernkarten";
          break;
        case "expenses":
          prompt = "Wie viel habe ich diese Woche ausgegeben? Kurze Zusammenfassung.";
          name = `Ausgaben-Check ${weekday}s um ${hour} Uhr`;
          description = "deinen Ausgaben";
          break;
        case "weekplanner":
          prompt = "Gib mir eine Wochenübersicht.";
          name = `Wochenübersicht ${weekday}s um ${hour} Uhr`;
          description = "der Wochenplanung";
          break;
        default:
          continue; // Unknown tools don't get proactive suggestions
      }

      // Send suggestion to user
      try {
        const msg = `🧠 Mir ist aufgefallen dass du ${weekday}s gegen ${hour} Uhr oft nach ${description} fragst. Soll ich dir das automatisch schicken? Antworte mit "Ja" oder "Nein".`;
        await bot.api.sendMessage({ chat_id: user.chat_id, text: msg });
        console.log(`🧠 [${userId}] Habit suggestion: ${name}`);

        // Store as pending rule
        existingRules.push({
          id: ruleId,
          userId,
          name,
          prompt,
          hour: parseInt(hour, 10),
          minute: 0,
          weekdays: [weekday],
          enabled: false, // Not active until confirmed
          pending_confirmation: true,
          suggested_at: now.toISOString(),
        });
      } catch (e) {
        console.error(`❌ [${userId}] Habit suggestion failed:`, e.message);
      }
    }
  }

  saveProactiveRules(existingRules);
  lastAnalysis.lastRun = now.toISOString();
  saveLastAnalysis(lastAnalysis);
}

// Handle habit confirmation/rejection responses
function isHabitConfirmation(text) {
  const lower = text.trim().toLowerCase();
  if (lower === "ja" || lower === "yes" || lower === "ok" || lower === "gerne" || lower === "mach das") return true;
  if (lower === "nein" || lower === "no" || lower === "nicht" || lower === "lass das" || lower === "nö") return false;
  return null;
}

// Hook into message handler to catch habit confirmations
function checkHabitConfirmation(userId, text) {
  const confirmation = isHabitConfirmation(text);
  if (confirmation === null) return false; // Not a yes/no answer

  const rules = loadProactiveRules();
  const pendingRule = rules.find(r => r.userId === userId && r.pending_confirmation);
  if (!pendingRule) return false; // No pending suggestion for this user

  if (confirmation) {
    // Activate the rule
    pendingRule.enabled = true;
    pendingRule.pending_confirmation = false;
    pendingRule.confirmed_at = new Date().toISOString();
    saveProactiveRules(rules);
    return { confirmed: true, name: pendingRule.name };
  } else {
    // Reject — remove from rules, add to rejected list
    const idx = rules.indexOf(pendingRule);
    rules.splice(idx, 1);
    saveProactiveRules(rules);

    const lastAnalysis = loadLastAnalysis();
    if (!lastAnalysis.rejected) lastAnalysis.rejected = [];
    lastAnalysis.rejected.push(pendingRule.id);
    saveLastAnalysis(lastAnalysis);
    return { confirmed: false, name: pendingRule.name };
  }
}

// Export for use in message handler
globalThis._checkHabitConfirmation = checkHabitConfirmation;

// Start proactive check loop
setInterval(checkProactiveRules, PROACTIVE_CHECK_INTERVAL);
setTimeout(checkProactiveRules, 30000); // First check after 30s

// Start habits analysis (check once on startup, then daily)
setTimeout(analyzeHabits, 60000); // First analysis after 1 min
setInterval(analyzeHabits, HABITS_ANALYSIS_INTERVAL);
console.log("💡 Proaktive Nachrichten + Gewohnheiten-Service aktiv");

console.log("✅ Bot bereit — warte auf Nachrichten...");

// v2: start long-polling via the managed runner (wires Ctrl-C to bot.stop())
run(bot);
