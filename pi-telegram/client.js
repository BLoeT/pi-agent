import { readAgentStream } from "./stream.js";
/** Transport to the agent/audio services; never sends Telegram messages. */
export function createServiceClient(config, { bot, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const thinkingModes = new Map();
  const headers = (extra = {}) => ({ ...extra, Authorization: `Bearer ${config.internalToken}` });

  async function request(url, options = {}, timeout = 30000) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    signal.throwIfAborted();
    const response = await fetchImpl(url, { ...options, signal });
    if (!response.ok) throw Object.assign(new Error(`Dienst antwortet mit HTTP ${response.status}`),{status:response.status});
    return response;
  }

  async function bytes(response, limit) {
    const size = Number(response.headers.get("content-length"));
    if (size > limit) { await response.body?.cancel(); throw new Error("Datei zu groß"); }
    const chunks = [];
    let total = 0;
    if (!response.body) return Buffer.alloc(0);
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > limit) throw new Error("Datei zu groß");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, total);
  }

  async function sendToAgent(message, userId, image = null, options = {}) {
    const body = { message, user_id: userId, thinking_level: thinkingModes.get(userId) || "low" };
    if (!options.scheduled && options.onDelta) body.stream = true;
    if (image) body.image_base64 = image;
    if (options.scheduled) body.delivery_mode = "scheduler";
    const response = await request(`${config.agentUrl}/prompt`, {
      method: "POST", headers: headers({ "Content-Type": "application/json", ...(options.requestId ? {"X-Request-ID":options.requestId} : {}) }), body: JSON.stringify(body),
    }, config.agentTimeout);
    const data = response.headers.get("content-type")?.includes("text/event-stream")
      ? await readAgentStream(response, options.onDelta) : await response.json();
    return options.scheduled ? { response: data.response || "", deliveries: data.deliveries || [] } : data.response || "";
  }

  async function saveUpload(userId,image,name) {
    const response=await request(`${config.agentUrl}/uploads`,{
      method:"POST",headers:headers({"Content-Type":"application/json"}),
      body:JSON.stringify({user_id:userId,image_base64:image,...(name?{name}:{})}),
    },60000);
    return response.json();
  }

  async function models(userId, refresh=false) {
    return (await request(`${config.agentUrl}/models/list`,{
      method:"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify({user_id:userId,refresh}),
    },60000)).json();
  }
  async function setModel(userId,model) {
    return (await request(`${config.agentUrl}/model`,{
      method:"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify({user_id:userId,model}),
    },60000)).json();
  }

  async function reset(userId) {
    await request(`${config.agentUrl}/reset`, {
      method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ user_id: userId }),
    });
  }

  async function textToSpeech(text) {
    const response = await request(`${config.audioUrl}/tts`, {
      method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ text }),
    }, config.audioTimeout);
    return bytes(response, config.maxAttachmentBytes);
  }

  async function transcribeAudio(audio) {
    const response = await request(`${config.audioUrl}/transcribe`, {
      method: "POST", headers: headers({ "Content-Type": "audio/ogg" }), body: audio,
    }, config.audioTimeout);
    return (await response.json()).text || "";
  }

  async function downloadTelegramFile(fileId) {
    const file = await bot.api.getFile({ file_id: fileId });
    if (!file?.file_path || file.file_size > config.maxInputBytes) throw new Error("Datei fehlt oder ist zu groß");
    const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
    return bytes(await request(url, {}, 60000), config.maxInputBytes);
  }

  async function downloadAttachment(userId, relative) {
    const parts = relative.split("/").map(encodeURIComponent).join("/");
    return bytes(await request(`${config.agentUrl}/files/${encodeURIComponent(userId)}/${parts}`, { headers: headers() }, 60000), config.maxAttachmentBytes);
  }

  return {
    thinkingModes, sendToAgent, saveUpload, models, setModel, reset, textToSpeech, transcribeAudio, downloadTelegramFile, downloadAttachment,
    close: () => controller.abort(),
    get closed() { return controller.signal.aborted; },
  };
}
