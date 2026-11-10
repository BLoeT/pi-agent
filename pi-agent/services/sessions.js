import path from "node:path";
import { createModelCatalog } from "./model-catalog.js";
import { createModelPreferences, validateModelId, applyModel } from "./model-selection.js";
import { RequestQueue } from "./request-queue.js";
import { configureModelRequests } from "./model-requests.js";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { ensureUserWorkspace, getUserWorkspacePath } from "../lib/users.js";
import { installContextBudget } from "../lib/context.js";
import { userContextExtension } from "./prompt-context.js";
import { wrapTool } from "./tool-execution.js";
import { coreTools } from "../tools/index.js";
import { HttpError } from "../../shared/errors.js";

/** Owns SDK configuration and session lifecycle, never HTTP requests. */
export function createSessionStore(config, loadedPlugins = [], {baseTools = coreTools} = {}) {
  const turns = new RequestQueue(64);
  const sessions = new Map();
  const pending = new Map();
  let closed = false;
  let runtimePromise;
  const catalog = createModelCatalog(config);
  const preferences = createModelPreferences(config);
  const sessionTools = new WeakMap();

  function getRuntime() {
    if (!runtimePromise) {
      runtimePromise = (async () => {
        const runtime = await ModelRuntime.create({
          authPath: path.join(config.agentDir, "auth.json"),
          modelsPath: path.join(config.agentDir, "models.json"),
        });
        const key = config.provider === "anthropic" ? config.anthropicKey : "ollama";
        if (!key) throw new Error("ANTHROPIC_API_KEY fehlt");
        configureModelRequests(runtime, turns, config.maxOutputTokens);
        await runtime.setRuntimeApiKey(config.provider, key);
        await catalog.refresh(runtime);
        return runtime;
      })().catch(error => {
        runtimePromise = undefined;
        throw error;
      });
    }
    return runtimePromise;
  }

  async function create(userId) {
    const runtime = await getRuntime();
    const model = runtime.getModel(config.provider, config.model) || runtime.getModel(config.provider,catalog.models(runtime)[0]?.id);
    if (!model) throw new HttpError(503,"Kein Chatmodell verfügbar. Bitte zuerst ein Modell in Ollama installieren.");
    ensureUserWorkspace(userId);
    const cwd = getUserWorkspacePath(userId);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: config.agentDir,
      extensionFactories: [userContextExtension(userId)],
      additionalExtensionPaths: [path.join(config.agentDir, "extensions/pi-ollama/src/index.ts")],
    });
    await resourceLoader.reload();
    const plugins = loadedPlugins
      .filter(plugin => plugin.allowed_users === null || plugin.allowed_users.includes(userId))
      .map(plugin => plugin.tool);
    const tools = [...baseTools, ...plugins].map(tool => wrapTool(tool, userId));
    const { session } = await createAgentSession({
      cwd,
      agentDir: config.agentDir,
      sessionManager: SessionManager.inMemory(cwd),
      modelRuntime: runtime,
      model,
      customTools: tools,
      noTools: "builtin",
      resourceLoader,
      thinkingLevel: config.thinkingLevel,
    });
    if (closed) {
      session.dispose();
      throw new HttpError(503, "Dienst wird neu gestartet", "SHUTTING_DOWN");
    }
    installContextBudget(session, undefined, config.maxOutputTokens);
    sessionTools.set(session,session.getActiveToolNames());
    sessions.set(userId, session);
    console.log(JSON.stringify({ event: "session_created", thinking_level: session.thinkingLevel }));
    return session;
  }

  async function raw(userId) {
    if (closed) throw new HttpError(503, "Dienst wird neu gestartet", "SHUTTING_DOWN");
    if (sessions.has(userId)) return sessions.get(userId);
    if (!pending.has(userId)) {
      pending.set(userId, create(userId).finally(() => pending.delete(userId)));
    }
    return pending.get(userId);
  }

  async function get(userId) {
    const session = await raw(userId);
    const runtime = await getRuntime();
    const id = preferences.get(userId);
    const metadata = catalog.models(runtime).find(model=>model.id===id);
    const model = metadata && runtime.getModel(config.provider,id);
    if (!model) throw new HttpError(409,`Das gewählte Modell „${id}“ ist nicht verfügbar. Bitte die Modellliste aktualisieren und ein verfügbares Modell wählen.`,"MODEL_UNAVAILABLE");
    await applyModel(session,model,metadata,sessionTools.get(session));
    return session;
  }

  async function listModels(userId, refresh = false) {
    const runtime = await getRuntime();
    await catalog.refresh(runtime,refresh);
    const available = catalog.models(runtime);
    return {provider:config.provider, selected:preferences.get(userId), default:config.model, models:available};
  }

  async function setModel(userId, id) {
    validateModelId(id);
    const runtime = await getRuntime();
    await catalog.refresh(runtime,true);
    const metadata = catalog.models(runtime).find(model=>model.id===id);
    const model = metadata && runtime.getModel(config.provider,id);
    if (!model) throw new HttpError(400,"Dieses Modell ist nicht verfügbar. Bitte die Modellliste aktualisieren.","MODEL_UNAVAILABLE");
    const session = await raw(userId);
    const previous=session.model, previousTools=session.getActiveToolNames(), previousThinking=session.thinkingLevel;
    try {
      await applyModel(session,model,metadata,sessionTools.get(session));
      preferences.set(userId,id);
    } catch(error) {
      if(previous)await session.setModel(previous);
      session.setActiveToolsByName(previousTools);
      session.setThinkingLevel(previousThinking);
      throw error;
    }
    return {provider:config.provider,selected:id,model:metadata};
  }

  function reset(userId) {
    sessions.get(userId)?.dispose();
    sessions.delete(userId);
  }

  function dispose() {
    closed = true;
    turns.close();
    for (const session of sessions.values()) session.dispose();
    sessions.clear();
  }

  return { get, reset, dispose, listModels, setModel };
}
