/**
 * Plugin Loader
 * Loads .js plugin files from workspace/plugins/ at startup.
 *
 * Access control: each plugin can have an optional sidecar metadata file
 * (<plugin>.meta.json) with { "allowed_users": ["enrico", ...] }.
 * If no meta file exists or allowed_users is empty/null, all users can use it.
 */
import fs from "fs";
import path from "path";

const PLUGINS_DIR = path.join("/workspace", "plugins");

export function ensurePluginsDir() {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
}

function getMetaPath(pluginFile) {
  // jokes.js → jokes.meta.json
  const base = pluginFile.replace(/\.js$/, "");
  return path.join(PLUGINS_DIR, `${base}.meta.json`);
}

export function readPluginMeta(pluginFile) {
  const metaPath = getMetaPath(pluginFile);
  if (!fs.existsSync(metaPath)) return { allowed_users: null };
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch (_) {
    return { allowed_users: null };
  }
}

export function writePluginMeta(pluginFile, meta) {
  const metaPath = getMetaPath(pluginFile);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

// Check if a user may use a given plugin (by allowed_users list)
export function userCanUsePlugin(pluginFile, userId) {
  const meta = readPluginMeta(pluginFile);
  // null or empty → available to everyone
  if (!meta.allowed_users || meta.allowed_users.length === 0) return true;
  return meta.allowed_users.includes(userId);
}

export async function loadPlugins() {
  ensurePluginsDir();
  const plugins = [];
  const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(PLUGINS_DIR, file);
    try {
      const module = await import(`file://${filePath}`);
      const tool = (module.default && module.default.name) ? module.default
                 : (module.tool && module.tool.name) ? module.tool
                 : null;
      if (tool) {
        const meta = readPluginMeta(file);
        plugins.push({ tool, file, allowed_users: meta.allowed_users || null });
        const scope = (meta.allowed_users && meta.allowed_users.length > 0)
          ? `nur: ${meta.allowed_users.join(", ")}`
          : "alle User";
        console.log(`🔌 Plugin loaded: ${tool.name} (${file}, ${scope})`);
      } else {
        console.warn(`⚠️  Plugin ${file}: no default or tool export found, skipping`);
      }
    } catch (e) {
      console.error(`❌ Plugin ${file} failed to load: ${e.message}`);
    }
  }
  return plugins;
}

export { PLUGINS_DIR };
