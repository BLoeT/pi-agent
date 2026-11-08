/**
 * Multi-User System
 * Handles user config, permissions, workspace paths, and current user context.
 */
import fs from "fs";
import path from "path";

const USERS_CONFIG_PATH = process.env.USERS_CONFIG_PATH || path.join("/workspace", "users.json");

// Current user context (set per request, used by tools)
let _currentUserId = null;

export function loadUsersConfig() {
  try {
    if (!fs.existsSync(USERS_CONFIG_PATH)) return { users: {}, groups: {} };
    const content = fs.readFileSync(USERS_CONFIG_PATH, "utf-8");
    return JSON.parse(content);
  } catch (e) {
    console.error("⚠️ Failed to load users.json:", e.message);
    return { users: {}, groups: {} };
  }
}

export function saveUsersConfig(config) {
  fs.writeFileSync(USERS_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function getUserByName(username) {
  const config = loadUsersConfig();
  const userId = username?.toLowerCase();
  if (!userId || !config.users[userId]) return null;
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
  return user.permissions.includes(permission);
}

export function getUserWorkspacePath(userId) {
  return path.join("/workspace", "users", userId);
}

export function getUserGroups(userId) {
  const config = loadUsersConfig();
  const user = config.users[userId];
  if (!user) return [];
  return (user.groups || []).map(groupId => ({
    id: groupId,
    ...config.groups[groupId],
  }));
}

export function getSharedGroupPaths(userId) {
  const groups = getUserGroups(userId);
  return groups.map(g => ({
    id: g.id,
    description: g.description,
    calendarPath: g.shared_calendar ? path.join("/workspace", "shared", g.id, "calendar.ics") : null,
    listsDir: path.join("/workspace", "shared", g.id, "lists"),
    sharedLists: g.shared_lists || [],
  }));
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
  if (userHasPermission(userId, "godot")) {
    dirs.push(path.join(base, "godot-project"));
  }
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function setCurrentUser(userId) {
  _currentUserId = userId;
  if (userId) ensureUserWorkspace(userId);
}

export function getCurrentUserId() {
  return _currentUserId || "enrico";
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
