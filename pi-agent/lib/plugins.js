/**
 * Plugin Loader
 * Loads .js plugin files from workspace/plugins/ at startup.
 *
 * Access control: each plugin can have an optional sidecar metadata file
 * (<plugin>.meta.json) with { "allowed_users": ["enrico", ...] }.
 * Missing/invalid metadata and empty lists deny access; null explicitly allows all admins.
 */
import fs from "fs";
import { getCurrentUserId, userHasPermission } from "./users.js";
import path from "path";

const pluginInfo = new Map();
export function getPluginInfo(file) { return pluginInfo.get(file) || {name:file,description:""}; }

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
  if (!fs.existsSync(metaPath)) return { allowed_users: [] };
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    return { allowed_users: meta.allowed_users === null || (Array.isArray(meta.allowed_users) && meta.allowed_users.every(v => typeof v === "string")) ? meta.allowed_users : [] };
  } catch (_) {
    return { allowed_users: [] };
  }
}

export function writePluginMeta(pluginFile, meta) {
  const metaPath = getMetaPath(pluginFile);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

// Check if a user may use a given plugin (by allowed_users list)
export function userCanUsePlugin(pluginFile, userId) {
  const meta = readPluginMeta(pluginFile);
  // null explicitly allows all; an empty array denies everyone.
  if (meta.allowed_users === null) return true;
  return meta.allowed_users.includes(userId);
}

export async function loadPlugins() {
  ensurePluginsDir();
  const plugins = [];
  const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(PLUGINS_DIR, file);
    try {
      const access = readPluginMeta(file);
      if (access.allowed_users !== null && access.allowed_users.length === 0) continue;
      const module = await import(`file://${filePath}`);
      const tool = (module.default && module.default.name) ? module.default
                 : (module.tool && module.tool.name) ? module.tool
                 : null;
      if (tool) {
        pluginInfo.set(file,{name:tool.name,description:tool.description || ""});
        const meta = readPluginMeta(file);
        const guardedTool = { ...tool, execute: (...args) => {
          const userId = getCurrentUserId();
          if (!userCanUsePlugin(file, userId)) throw new Error("Kein Plugin-Zugriff");
          // Existing arbitrary-code plugins remain available only to administrators.
          if (!userHasPermission(userId, "admin")) throw new Error("Plugins benötigen Admin-Berechtigung");
          return tool.execute(...args);
        } };
        plugins.push({ tool: guardedTool, file, allowed_users: meta.allowed_users });
        const scope = (meta.allowed_users && meta.allowed_users.length > 0)
          ? `nur: ${meta.allowed_users.join(", ")}`
          : (meta.allowed_users === null ? "alle Admins" : "niemand");
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
