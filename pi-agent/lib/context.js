function messageTokens(message) {
  const text = JSON.stringify(message, function (key, value) {
    return key === "data" && this?.type === "image" ? undefined : value;
  }) || "";
  const images = Array.isArray(message?.content)
    ? message.content.filter(part => part.type === "image").length : 0;
  return Math.ceil(text.length / 3) + images * 4096 + 16;
}

export function estimateTokens(messages) {
  return messages.reduce((total, message) => total + messageTokens(message), 0);
}

/** Linear scan; preserve system/tool declarations and whole user/tool rounds. */
export function trimHistory(messages, budget = 36000, maxMessages = 40) {
  const costs = messages.map(messageTokens);
  let total = costs.reduce((sum, cost) => sum + cost, 0);
  let count = messages.length;
  if (count <= maxMessages && total <= budget) return messages;
  let cut = 0;
  for (let index = 0; index < messages.length; index++) {
    if (messages[index]?.role === "user" && index > 0 && count <= maxMessages && total <= budget) {
      cut = index;
      break;
    }
    if (messages[index]?.role !== "system") {
      total -= costs[index];
      count--;
    }
  }
  // An oversized latest round stays intact for SDK compaction/overflow handling.
  return cut ? messages.filter((message, index) => index >= cut || message?.role === "system") : messages;
}

export function contextBudget(model = {}, maxOutputTokens = Infinity) {
  const window = Number.isFinite(model.contextWindow) && model.contextWindow > 0 ? model.contextWindow : 65536;
  const response = Number.isFinite(model.maxTokens) && model.maxTokens > 0 ? model.maxTokens : 16384;
  return Math.max(1, window - Math.min(response,maxOutputTokens) - 1024);
}

/** Run after SDK projection so the real prompt, current tools and new input are counted. */
export function installContextBudget(session, log = console.log, maxOutputTokens = Infinity) {
  const agent = session.agent;
  const previous = agent.transformContext;
  agent.transformContext = async (messages, signal) => {
    const projected = previous ? await previous.call(agent, messages, signal) : messages;
    const budget = contextBudget(session.model,maxOutputTokens);
    const kept = trimHistory(projected, budget, 40);
    if (kept !== projected) {
      try { log(JSON.stringify({ event: "context_trimmed", before_messages: projected.length,
        after_messages: kept.length, estimated_tokens: estimateTokens(kept), budget })); } catch {}
    }
    return kept;
  };
}

export function limitToolResult(result, maxChars = 24000) {
  if (!result || !Array.isArray(result.content)) return result;
  let remaining = maxChars;
  const marker = "\n[Ausgabe gekürzt; gezielt mit kleinerem Bereich erneut abfragen.]\n";
  return { ...result, content: result.content.map(part => {
    if (part.type !== "text" || typeof part.text !== "string") return part;
    const allowance = remaining;
    remaining = Math.max(0, remaining - part.text.length);
    if (part.text.length <= allowance) return part;
    if (allowance <= marker.length) return { ...part, text: "" };
    const tail = Math.floor((allowance - marker.length) / 4);
    return { ...part, text: part.text.slice(0, allowance - marker.length - tail) + marker + (tail ? part.text.slice(-tail) : "") };
  }) };
}
