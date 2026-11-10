/** Telegram process lifecycle. No transport, business logic or filesystem work here. */
import { createPreferences } from "./preferences.js";
import { Bot, InputFile } from "node-telegram-bot-api";
import { run } from "node-telegram-bot-api/node";
import { Agent, setGlobalDispatcher } from "undici";
import { loadConfig } from "./config.js";
import { createUsersRepository } from "./users.js";
import { createServiceClient } from "./client.js";
import { createMessenger } from "./messenger.js";
import { createMessageHandler } from "./handlers.js";
import { startBackgroundServices } from "./scheduler.js";
import { redact } from "../shared/errors.js";

async function main() {
  const config = loadConfig();
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  setGlobalDispatcher(dispatcher);
  const bot = new Bot(config.botToken);
  const users = createUsersRepository(config.usersFile);
  const client = createServiceClient(config, { bot });
  const messenger = createMessenger({ bot, client, InputFile, getUserIdForChat: users.getUserIdForChat });
  const scheduler = startBackgroundServices({
    bot, loadUsersConfig: users.load, sendToAgent: client.sendToAgent, deliver: messenger.scheduled,
  });
  bot.on("message", createMessageHandler({ bot, users, client, messenger, checkHabitConfirmation: scheduler.checkHabitConfirmation, preferences:createPreferences() }));
  bot.catch(error => console.error(JSON.stringify({ event: "telegram_handler_failed", message: redact(error?.message || error) })));
  const stop = () => { scheduler.stop(); client.close(); };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
  console.log(JSON.stringify({ event: "telegram_ready", configured_users: Object.keys(users.load().users).length }));
  try { await run(bot); }
  finally {
    stop();
    for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, stop);
    await dispatcher.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ event: "telegram_startup_failed", message: redact(error.message) }));
  process.exitCode = 1;
});
