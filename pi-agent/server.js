/** Process lifecycle only. Import app.js to construct an app without starting it. */
import { Agent, setGlobalDispatcher } from "undici";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { loadPlugins } from "./lib/plugins.js";
import { createSessionStore } from "./services/sessions.js";
import { createChatService } from "./services/chat.js";
import { redact } from "../shared/errors.js";

async function main() {
  const config = loadConfig();
  // Model generation may exceed ordinary HTTP body/header deadlines.
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  setGlobalDispatcher(dispatcher);
  let plugins = [];
  try { plugins = await loadPlugins(); }
  catch (error) { console.error(JSON.stringify({ event: "plugins_unavailable", message: redact(error.message) })); }
  const sessions = createSessionStore(config, plugins);
  const chat = createChatService({ sessions, maxPending: config.maxPendingPerUser });
  const app = createApp({ config, chat });
  const server = app.listen(config.port, config.host, () => {
    console.log(JSON.stringify({ event: "agent_ready", port: config.port, plugins: plugins.length }));
  });
  server.on("error", error => {
    console.error(JSON.stringify({ event: "server_error", code: error.code }));
    process.exitCode = 1;
    void shutdown();
  });
  let closing;
  function shutdown() {
    if (closing) return closing;
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    closing = (async () => {
      const stopped = new Promise(resolve => server.close(resolve));
      server.closeIdleConnections();
      await chat.close();
      await stopped;
      await dispatcher.close();
      clearTimeout(deadline);
      console.log(JSON.stringify({ event: "agent_stopped" }));
    })();
    return closing;
  }
  for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => { void shutdown(); });
}

main().catch(error => {
  console.error(JSON.stringify({ event: "startup_failed", message: redact(error.message) }));
  process.exitCode = 1;
});
