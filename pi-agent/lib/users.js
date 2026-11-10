/**
 * Multi-User System
 * Handles user config, permissions, workspace paths, and current user context.
 */
import fs from "fs";
import path from "path";
import { AsyncLocalStorage } from "node:async_hooks";
import { readJson, atomicWrite, assertSafePath } from "./storage.js";
import { validUserId } from "./security.js";

const USERS_CONFIG_PATH = process.env.USERS_CONFIG_PATH || path.join("/workspace", "users.json");

// Current user context (set per request, used by tools)
const userContext = new AsyncLocalStorage();
export function runAsUser(userId, callback, options = {}) {
  if (!validUserId(userId)) throw new Error("Ungültiger Nutzer");
  const parent = userContext.getStore();
  const context = parent?.userId === userId && options.scheduled === undefined
    ? {...parent,signal:options.signal || parent.signal,...(options.attachment !== undefined ? {attachment:options.attachment} : {})} : {userId, scheduled: Boolean(options.scheduled), requestId: options.requestId, attachment:options.attachment, deliveries: [],signal:options.signal};
  return userContext.run(context, callback);
}
export function deferDelivery(userId, text) {
  const context = userContext.getStore();
  if (!context?.scheduled) return false;
  if (userId !== context.userId) throw new Error("Geplante Antworten werden nur an den zugehörigen Nutzer zugestellt");
  const value=String(text).trim();
  if (value && !context.deliveries.includes(value)) context.deliveries.push(value);
  return true;
}
export function getToolSignal() { return userContext.getStore()?.signal; }
export function getDeferredDeliveries() { return userContext.getStore()?.deliveries || []; }
export function loadUsersConfig() {
  const config = readJson(USERS_CONFIG_PATH, {users:{},groups:{}});
  if (!config.users || typeof config.users !== "object") throw new Error("Ungültige Nutzerkonfiguration");
  return config;
}
export function saveUsersConfig(config) { atomicWrite(USERS_CONFIG_PATH, JSON.stringify(config,null,2)); }

export function getUserByName(username) {
  const config = loadUsersConfig();
  const userId = username?.toLowerCase();
  if (!validUserId(userId) || !Object.hasOwn(config.users, userId)) return null;
  return { id: userId, ...config.users[userId] };
}

export function getUserByChatId(chatId) {
  const config = loadUsersConfig();
  for (const [id, user] of Object.entries(config.users)) {
    if (user.chat_id === chatId) return { id, ...user };
  }
  return null;
}

export function userHasPermission(userId, permission) {
  const user = getUserByName(userId);
  if (!user) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function getUserWorkspacePath(userId) {
  if (!validUserId(userId)) throw new Error("Ungültiger Nutzer");
  const base = path.join("/workspace", "users", userId);
  try { if(fs.lstatSync(base).isSymbolicLink()) throw new Error("Nutzerordner darf kein Symlink sein"); } catch(error) {if(error.code!=="ENOENT") throw error;}
  return base;
}

export function getUserGroups(userId) {
  const config = loadUsersConfig();
  const user = config.users[userId];
  if (!user) return [];
  return (user.groups || []).filter(groupId => validUserId(groupId) && Object.hasOwn(config.groups || {},groupId)).map(groupId => ({
    id: groupId,
    ...config.groups[groupId],
  }));
}

export function getSharedGroupPaths(userId) {
  const groups = getUserGroups(userId);
  return groups.map(g => {
    assertSafePath(path.join("/workspace","shared",g.id,"calendar.ics"));
    assertSafePath(path.join("/workspace","shared",g.id,"lists"));
    return ({
    id: g.id,
    description: g.description,
    calendarPath: g.shared_calendar ? path.join("/workspace", "shared", g.id, "calendar.ics") : null,
    listsDir: path.join("/workspace", "shared", g.id, "lists"),
    sharedLists: g.shared_lists || [],
  });});
}

export function ensureUserWorkspace(userId) {
  const base = getUserWorkspacePath(userId);
  const dirs = [
    base,
    path.join(base, "lists"),
    path.join(base, "generated-images"),
    path.join(base, "flashcards"),
    path.join(base, "expenses"),
    path.join(base, "memory"),
    path.join(base, "projects"),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getCurrentUserId() {
  const id = userContext.getStore()?.userId;
  if (!id) throw new Error("Nutzerkontext fehlt");
  return id;
}

export function getCurrentUserWorkspace() {
  return getUserWorkspacePath(getCurrentUserId());
}

export function checkPermission(toolName) {
  const userId = getCurrentUserId();
  if (!userHasPermission(userId, toolName)) {
    const user = getUserByName(userId);
    const name = user?.name || userId;
    return { content: [{ type: "text", text: JSON.stringify({ error: `${name} hat keinen Zugriff auf dieses Feature.` }) }], details: {} };
  }
  return null;
}

export function getExecutionMeta() { const current = userContext.getStore(); return {scheduled:Boolean(current?.scheduled),requestId:current?.requestId}; }

export function getCurrentAttachment() { return userContext.getStore()?.attachment; }
