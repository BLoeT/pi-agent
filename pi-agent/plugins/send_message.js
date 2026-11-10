import { deferDelivery } from "/app/lib/users.js";
import { fetchJson } from "/app/lib/http.js";
const tool = {
  name: "send_message",
  label: "Send Message",
  description: "Schickt eine Text-Nachricht per Telegram an einen Nutzer.",
  parameters: {
    type: "object",
    properties: {
      user: { type: "string", description: "Username des Empfängers (z.B. enrico, jaqueline)" },
      text: { type: "string", description: "Der Nachrichten-Text" },
      source: { type: "string", description: "Kontext/Absender (z.B. 'reminder', 'routine', 'auto')" }
    },
    required: ["user", "text"]
  },
  execute: async (_toolCallId, params, signal) => {
    try {
      const { user, text, source } = params;
      if(typeof text!=="string" || !text.trim() || text.length>4096) throw new Error("Nachricht muss 1–4096 Zeichen haben");
      const message=source ? `${source}:\n${text}` : text;
      if(deferDelivery(user,message)) return {content:[{type:"text",text:JSON.stringify({status:"ok",delivery:"scheduler",text:message})}],details:{}};
      const fs = await import('node:fs');
      const path = await import('node:path');

      let usersConfig = {};
      try {
        const configPath = path.resolve('/workspace/users.json');
        usersConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "users.json nicht gefunden" }) }], details: {} };
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return { content: [{ type: "text", text: JSON.stringify({ error: "TELEGRAM_BOT_TOKEN ist nicht gesetzt" }) }], details: {} };

      const userObj = usersConfig.users?.[user];
      const chatId = userObj?.chat_id;
      if (!chatId) return { content: [{ type: "text", text: JSON.stringify({ error: `Keine Chat-ID für User '${user}' gefunden` }) }], details: {} };


      const data = await fetchJson(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message })
      }, {signal,timeout:30000});

      if (data.ok) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Nachricht an ${user} gesendet`, chat_id: chatId }) }], details: data };
      } else {
        return { content: [{ type: "text", text: JSON.stringify({ error: data.description || "Telegram API Fehler" }) }], details: data };
      }
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], details: {} };
    }
  }
};

export default tool;