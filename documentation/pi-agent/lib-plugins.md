# pi-agent/lib/plugins.js — Plugin-Loader

Lädt selbst geschriebene Plugins beim Start und verwaltet deren Zugriffskontrolle. Plugins liegen als `.js`-Dateien in `workspace/plugins/`.

## Konzept

Ein Plugin ist eine ES-Module-Datei die ein Tool als `default` exportiert. Optional gibt es eine Metadaten-Datei daneben (`<plugin>.meta.json`) die festlegt welche User das Plugin nutzen dürfen.

Beispiel:
```
workspace/plugins/
├── jokes.js              ← Das Plugin
└── jokes.meta.json       ← { "allowed_users": ["enrico"] }  (optional)
```

## Funktionen

### `ensurePluginsDir()`
Legt den `workspace/plugins/`-Ordner an falls er nicht existiert.

### `getMetaPath(pluginFile)` (intern)
Leitet den Pfad der Metadaten-Datei ab: `jokes.js` → `jokes.meta.json`.

### `readPluginMeta(pluginFile)`
Liest die Metadaten eines Plugins. Gibt `{ allowed_users: [...] }` zurück oder `{ allowed_users: null }` wenn keine Meta-Datei existiert (= für alle verfügbar).

### `writePluginMeta(pluginFile, meta)`
Schreibt die Metadaten. Wird vom develop-Tool bei `grant_access`/`revoke_access` genutzt.

### `userCanUsePlugin(pluginFile, userId)`
Prüft ob ein User ein Plugin nutzen darf. Wenn `allowed_users` leer/null → alle dürfen. Sonst nur die gelisteten User.

### `loadPlugins()`
Die Hauptfunktion, beim Server-Start aufgerufen:
1. Liest alle `.js`-Dateien aus `workspace/plugins/`
2. Importiert jede dynamisch (`import()`)
3. Erwartet einen `default`- oder `tool`-Export mit einem `name`
4. Liest die zugehörigen Metadaten (allowed_users)
5. Gibt ein Array von `{ tool, file, allowed_users }` zurück

Kaputte Plugins werden übersprungen (Fehler wird geloggt, aber der Server startet trotzdem). Im Server werden die Plugins dann pro User gefiltert (nur erlaubte werden in die Session geladen).
