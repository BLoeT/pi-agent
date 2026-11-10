function serviceUrl(value, label) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} muss eine HTTP(S)-Adresse ohne Zugangsdaten sein`);
  }
  return url.toString().replace(/\/+$/, "");
}

export function loadConfig(env = process.env) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN fehlt");
  if ((env.RIBO_INTERNAL_TOKEN || "").length < 32) throw new Error("RIBO_INTERNAL_TOKEN fehlt oder ist zu kurz");
  return Object.freeze({
    botToken: env.TELEGRAM_BOT_TOKEN,
    internalToken: env.RIBO_INTERNAL_TOKEN,
    agentUrl: serviceUrl(env.AGENT_URL || "http://pi-agent:8080", "AGENT_URL"),
    audioUrl: serviceUrl(env.RIBO_URL || "http://host.docker.internal:8085", "RIBO_URL"),
    usersFile: env.USERS_CONFIG_PATH || "/workspace/users.json",
    agentTimeout: 3600000,
    audioTimeout: 180000,
    maxInputBytes: 20 * 1024 * 1024,
    maxAttachmentBytes: 50 * 1024 * 1024,
  });
}
