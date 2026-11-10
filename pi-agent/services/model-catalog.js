import path from "node:path";
import { createRequire } from "node:module";
import { HttpError, redact } from "../../shared/errors.js";

// Use the SDK's existing TypeScript loader and our native Ollama adapter.
// No second capability detector, transport, or package installation is needed.
async function loadAdapter(agentDir) {
  const sdkRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { createJiti } = sdkRequire("jiti");
  const jiti = createJiti(import.meta.url);
  const source = path.join(agentDir, "extensions/pi-ollama/src");
  const [discovery, settings, adapter, provider, ai] = await Promise.all([
    jiti.import(path.join(source,"discovery.ts")), jiti.import(path.join(source,"settings.ts")),
    jiti.import(path.join(source,"index.ts")), jiti.import(path.join(source,"provider.ts")),
    import("@earendil-works/pi-ai"),
  ]);
  return { async refresh(runtime) {
    const options = settings.loadSettings();
    const found = await discovery.discoverModels(options);
    runtime.registerProvider("ollama", {
      api: "ollama-native", baseUrl: options.baseUrl, apiKey: "ollama",
      streamSimple: (model, context, request) => provider.streamOllama(model, context, request, options, ai.AssistantMessageEventStream),
      models: found.map(model => adapter.toProviderModel(model,options)),
    });
    discovery.saveCache(found);
    return found;
  }};
}

export function createModelCatalog(config, { load = loadAdapter, now = Date.now } = {}) {
  let adapter, pending, updated = 0, discovered = [];
  async function refresh(runtime, force = false) {
    if (config.provider !== "ollama") return;
    if (!force && updated && now()-updated < 30000) return;
    if (!pending) pending = (async () => {
      adapter ??= await load(config.agentDir);
      const found = await adapter.refresh(runtime);
      discovered = found;
      updated = now();
    })().catch(error => {
      console.error(JSON.stringify({event:"model_catalog_failed",message:redact(error.message)}));
      throw new HttpError(503,"Die Modellliste von Ollama ist gerade nicht erreichbar. Die bisherige Auswahl bleibt erhalten.","MODELS_UNAVAILABLE"); })
      .finally(() => { pending = undefined; });
    return pending;
  }
  function models(runtime) {
    const listed = config.provider === "ollama" ? discovered : runtime.getModels(config.provider);
    return listed.map(entry => {
      const model = runtime.getModel(config.provider,entry.id);
      return model && { id:model.id, name:model.name || model.id, provider:model.provider,
        vision:model.input?.includes("image") || false, reasoning:Boolean(model.reasoning),
        tools:config.provider !== "ollama" || Boolean(entry.tools), context_window:model.contextWindow };
    }).filter(Boolean).sort((a,b)=>a.id.localeCompare(b.id));
  }
  return {refresh,models};
}
