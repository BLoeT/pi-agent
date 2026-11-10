export function stripThinking(text) {
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


/** Observe the SDK before prompt() starts so no first delta is lost. */
export async function collectResponse(session, prompt, { image, onEvent = () => {}, onFirstDelta = () => {}, onMetric = () => {}, now = () => performance.now() } = {}) {
  let response = "";
  let thinking = "";
  let sawDelta = false;
  let lastStopReason;
  const first = new Set();
  const toolStarts = new Map();
  const metric = (type, details = {}) => { try { onMetric({ type, ...details }); } catch {} };
  const firstPart = (kind, delta) => {
    if (!delta || first.has(kind)) return;
    first.add(kind);
    metric(`first_${kind}`);
  };
  const unsubscribe = session.subscribe(event => {
    if (event.type === "message_update") {
      const part = event.assistantMessageEvent;
      if (["thinking_delta", "text_delta"].includes(part?.type) && !sawDelta) {
        sawDelta = true;
        onFirstDelta();
      }
      if (part?.type === "thinking_delta") {
        firstPart("thinking", part.delta);
        thinking += part.delta || "";
        onEvent({ thinking: part.delta || "" });
      } else if (part?.type === "text_delta") {
        firstPart("text", part.delta);
        response += part.delta || "";
        onEvent({ delta: part.delta || "" });
      }
    } else if (event.type === "message_start" && event.message?.role === "assistant") {
      metric("model_round");
    } else if (event.type === "tool_execution_start") {
      toolStarts.set(event.toolCallId, now());
      metric("tool_start");
      onEvent({ tool_call: { name: event.toolName, input: event.args } });
    } else if (event.type === "tool_execution_update") {
      onEvent({ tool_update: { name: event.toolName, result: event.partialResult } });
    } else if (event.type === "tool_execution_end") {
      const started = toolStarts.get(event.toolCallId);
      toolStarts.delete(event.toolCallId);
      metric("tool_end", { ms: started === undefined ? null : Math.max(0, now() - started) });
      onEvent({ tool_result: { name: event.toolName, result: event.result, isError: event.isError } });
    } else if (event.type === "message_end") {
      const message = event.message;
      if (message?.role === "assistant") lastStopReason = message.stopReason;
      if (!response && message?.role === "assistant" && Array.isArray(message.content)) {
        const text = message.content.find(part => part.type === "text" && part.thinking !== true)?.text;
        if (text) {
          response = stripThinking(text);
          firstPart("text", response);
          onEvent({ delta: response });
        }
      }
    }
  });
  try {
    const options = image ? {
      images: [{ type: "image", data: image, mimeType: image.startsWith("iVBOR") ? "image/png" : image.startsWith("UklGR") ? "image/webp" : "image/jpeg" }],
    } : undefined;
    await session.prompt(prompt, options);
    if (lastStopReason === "length") {
      const notice = "\n\nAntwortlimit erreicht. Bitte teile die Aufgabe auf.";
      response += notice;
      onEvent({ delta: notice });
      return {response:stripThinking(response),thinking,truncated:true};
    }
    return { response: stripThinking(response), thinking };
  } finally {
    unsubscribe();
  }
}
