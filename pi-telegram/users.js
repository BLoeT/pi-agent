import { readJson } from "../shared/storage.js";
import { validUserId } from "../shared/identity.js";

export function createUsersRepository(file = "/workspace/users.json") {
  function load() {
    const config = readJson(file, { users: {}, groups: {} });
    if (!config?.users || typeof config.users !== "object" || Array.isArray(config.users)) throw new Error("Ungültige Nutzerkonfiguration");
    return config;
  }
  function getByChat(chatId) {
    return Object.entries(load().users)
      .filter(([id]) => validUserId(id))
      .map(([id, user]) => ({ ...user, id }))
      .find(user => user.chat_id === chatId) || null;
  }
  return {
    load,
    getUserByChatId: getByChat,
    getUserIdForChat: chatId => getByChat(chatId)?.id || null,
    isAuthorized: chatId => Boolean(getByChat(chatId)),
  };
}
