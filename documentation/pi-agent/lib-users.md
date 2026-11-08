# pi-agent/lib/users.js — Multi-User System

Verwaltet Nutzer, Berechtigungen, Workspace-Pfade und den aktuellen User-Kontext. Dieses Modul ist das Fundament der Multi-User-Fähigkeit.

## Der zentrale Trick: `_currentUserId`

```javascript
let _currentUserId = null;
```

Eine modul-globale Variable die den aktuell aktiven User hält. Wird vor jeder Anfrage gesetzt. Alle Tools fragen sie ab um zu wissen wessen Daten sie verarbeiten.

## Funktionen

### `loadUsersConfig()`
Liest `workspace/users.json` und gibt das Config-Objekt zurück (`{ users, groups }`). Bei Fehler ein leeres Objekt. Wird bei jedem Aufruf frisch gelesen — so wirken Änderungen an users.json sofort (kein Neustart nötig).

### `saveUsersConfig(config)`
Schreibt die Config zurück nach users.json. Wird vom admin-Tool genutzt (User anlegen/ändern).

### `getUserByName(username)`
Sucht einen User per Name (case-insensitive). Gibt `{ id, name, chat_id, permissions, groups, ... }` zurück oder `null`.

### `getUserByChatId(chatId)`
Sucht einen User per Telegram-Chat-ID. Wird vom Telegram-Bot genutzt um eingehende Nachrichten dem richtigen User zuzuordnen.

### `userHasPermission(userId, permission)`
Prüft ob ein User eine bestimmte Berechtigung hat (z.B. "godot", "admin"). Basis der Zugriffskontrolle.

### `getUserWorkspacePath(userId)`
Gibt den Pfad zum persönlichen Workspace zurück: `/workspace/users/<userId>`.

### `getUserGroups(userId)`
Gibt die Gruppen eines Users zurück (z.B. "familie", "eltern") inklusive Gruppen-Details.

### `getSharedGroupPaths(userId)`
Für jede Gruppe des Users: die geteilten Ressourcen-Pfade (Gruppen-Kalender, geteilte Listen-Ordner, Liste der geteilten Listennamen). Wird von Kalender- und Listen-Tools genutzt um geteilte Daten einzubeziehen.

### `ensureUserWorkspace(userId)`
Legt die Verzeichnisstruktur für einen User an (lists, generated-images, flashcards, expenses, memory, projects — und godot-project falls Berechtigung vorhanden). Idempotent (schadet nicht wenn schon da).

### `setCurrentUser(userId)`
Setzt `_currentUserId` und stellt sicher dass der Workspace existiert. Wird zu Beginn jeder Anfrage im `/prompt`-Endpoint aufgerufen.

### `getCurrentUserId()`
Gibt den aktuellen User zurück. Fallback: "enrico" (für Web-Chat und hey-ribo, die keine User-ID mitschicken).

### `getCurrentUserWorkspace()`
Kurzform für den Workspace-Pfad des aktuellen Users.

### `checkPermission(toolName)`
Der Wächter für jedes Tool. Gibt `null` zurück wenn erlaubt, oder ein fertiges Fehler-Objekt wenn nicht. Jedes Tool ruft dies am Anfang auf:
```javascript
const denied = checkPermission("music");
if (denied) return denied;
```
