import { redact } from "../shared/errors.js";

/** Owns Telegram formatting/uploads and optional voice replies. */
export function createMessenger({ bot, client, InputFile, getUserIdForChat }) {
  const replyOptions = messageId => messageId ? { reply_parameters: { message_id: messageId } } : {};

  async function text(chatId, content, messageId) {
    const options = replyOptions(messageId);
    if (content.length <= 4096) return bot.api.sendMessage({ chat_id: chatId, text: content, ...options });
    return bot.api.sendDocument({
      chat_id: chatId,
      document: new InputFile(Buffer.from(content, "utf8"), { filename: "Ribo-Nachricht.txt" }),
      caption: "Deine vollständige Ribo-Nachricht",
      ...options,
    });
  }

  async function reply(chatId, content, messageId, {voice = true, trace} = {}) {
    if (!content?.trim()) return text(chatId, "🤷 Keine Antwort vom Agent erhalten.", messageId);
    const clean = content.replace(/\[(FILE|IMAGE):[^\]]+\]/g, "").trim();
    await text(chatId, clean || "📎 Anbei:", messageId);
    trace?.mark("text_sent_ms");
    trace?.mark("first_visible_ms");
    const markers = [...content.matchAll(/\[(FILE|IMAGE):([^:]+):([^\]]+)\]/g)];
    for (const [_, kind, userId, relative] of markers) {
      try {
        if (!getUserIdForChat || getUserIdForChat(chatId) !== userId) {
          throw new Error("Datei gehört nicht zum Empfänger");
        }
        const data = await (trace ? trace.measure("attachment_download_ms",()=>client.downloadAttachment(userId,relative)) : client.downloadAttachment(userId,relative));
        const file = new InputFile(new Uint8Array(data), { filename: relative.split("/").pop() });
        const options = { chat_id: chatId, ...replyOptions(messageId) };
        if (kind === "IMAGE") await bot.api.sendPhoto({ ...options, photo: file });
        else await bot.api.sendDocument({ ...options, document: file });
      } catch (error) {
        if (client.closed) return;
        console.warn(JSON.stringify({ event: "attachment_failed", message: redact(error.message) }));
      }
    }
    if (!voice || clean.length > 1000 || !clean) return;
    try {
      const audio = await (trace ? trace.measure("tts_ms",()=>client.textToSpeech(clean)) : client.textToSpeech(clean));
      if (!client.closed) {
        await bot.api.sendVoice({ chat_id: chatId, voice: new InputFile(new Uint8Array(audio), { filename: "voice.ogg" }), ...replyOptions(messageId) });
        trace?.mark("voice_sent_ms");
      }
    } catch (error) {
      if (!client.closed) console.warn(JSON.stringify({ event: "voice_unavailable", message: redact(error.message) }));
    }
  }

  return { text, reply, scheduled: (user, content) => text(user.chat_id, content) };
}
