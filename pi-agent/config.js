import path from "node:path";
import { fileURLToPath } from "node:url";

const defaults = {
  ollama: "qwen3.8-27b-64k:latest",
  anthropic: "claude-sonnet-5",
};

export function loadConfig(env = process.env) {
  const provider = (env.LLM_PROVIDER || "ollama").toLowerCase();
  if (!Object.hasOwn(defaults, provider)) throw new Error("Unbekannter LLM_PROVIDER");
  if (provider === "anthropic" && !env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY fehlt");
  const thinkingLevel = env.THINKING_LEVEL || env.REASONING_EFFORT || "low";
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinkingLevel)) {
    throw new Error("Ungültiger THINKING_LEVEL");
  }
  const port = Number(env.RIBO_AGENT_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Ungültiger Agent-Port");
  if ((env.RIBO_INTERNAL_TOKEN || "").length < 32) throw new Error("RIBO_INTERNAL_TOKEN fehlt oder ist zu kurz");
  if ((env.RIBO_WEB_PASSWORD || "").length < 16) throw new Error("RIBO_WEB_PASSWORD fehlt oder ist zu kurz");
  const maxOutputTokens = Number(env.RIBO_MAX_OUTPUT_TOKENS || 8192);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 32768) throw new Error("Ungültiges Antwortlimit");
  return Object.freeze({
    maxOutputTokens,
    provider,
    model: env.PI_MODEL || defaults[provider],
    thinkingLevel,
    agentDir: env.RIBO_AGENT_DIR || "/home/node/.pi/agent",
    anthropicKey: env.ANTHROPIC_API_KEY,
    port,
    host: env.RIBO_AGENT_HOST || "0.0.0.0",
    internalToken: env.RIBO_INTERNAL_TOKEN,
    webUser: env.RIBO_WEB_USER || "enrico",
    webPassword: env.RIBO_WEB_PASSWORD,
    publicDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "public"),
    maxPendingPerUser: 4,
    maxMessageLength: 10000,
    maxImageLength: 14 * 1024 * 1024,
  });
}
