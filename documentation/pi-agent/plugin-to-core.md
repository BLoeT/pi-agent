# Plugin → Core übernehmen (Anleitung)

Wenn ein Plugin (aus `workspace/plugins/`) sich bewährt hat, kannst du es fest in die
Core-Tools übernehmen. Danach ist es Teil des Images, wird immer geladen und kann eine
eigene Berechtigung bekommen.

> **Nur Admin.** Diese Schritte machst du **händisch** am Projekt (nicht Ribo), weil die
> Core-Tools im Docker-Image liegen (`COPY tools/`) und ein Rebuild nötig ist. Plugins
> dagegen liegen im gemounteten Volume `workspace/plugins/` und werden zur Laufzeit geladen.

## Warum händisch?

| | Plugin | Core-Tool |
|---|---|---|
| Ort | `workspace/plugins/<name>.js` (Volume) | `pi-agent/tools/<name>.js` (Image) |
| Laden | dynamisch beim Start (`loadPlugins`) | statischer Import in `server.js` |
| Zugriff | `.meta.json` (`allowed_users`) | Permission in `users.json` + `checkPermission` |
| Änderung aktiv nach | `docker compose restart pi-agent` | **Rebuild**: `docker compose build pi-agent` |

Ribo (im Container) kann `pi-agent/tools/` und `server.js` nicht schreiben und keinen
Rebuild auslösen — deshalb die manuellen Schritte.

## Schritte

Beispiel: Plugin `jokes.js` soll Core-Tool werden.

### 1. Datei kopieren
```bash
cp workspace/plugins/jokes.js pi-agent/tools/jokes.js
```

### 2. In `server.js` importieren
Bei den anderen Tool-Imports ergänzen (oben im File, wo `import xTool from "./tools/x.js"` steht):
```js
import jokesTool from "./tools/jokes.js";
```

### 3. In das `coreTools`-Array aufnehmen
Das Array `const coreTools = [...]` in `server.js` um das Tool erweitern:
```js
const coreTools = [homeassistantTool, /* ... */, capabilitiesTool, jokesTool];
```

### 4. (Optional) Berechtigung einführen
Wenn das Tool permission-geschützt sein soll:

a) Im Tool-Code am Anfang von `execute` ergänzen (wie die anderen Tools):
```js
import { checkPermission } from "../lib/users.js";
// ...
const denied = checkPermission("jokes");
if (denied) return denied;
```

b) In `workspace/users.json` die Permission `"jokes"` bei den berechtigten Nutzern
in deren `permissions`-Array eintragen.

c) (Optional) In `pi-agent/tools/capabilities.js` die Feature-Liste um eine Zeile ergänzen,
damit "Was kannst du?" das neue Tool anzeigt:
```js
{ perm: "jokes", text: "😄 Witze erzählen" },
```

> Ohne `checkPermission` ist das Tool für alle nutzbar (wie personality/memory).

### 5. Plugin-Reste entfernen
Damit das Tool nicht doppelt (als Plugin UND Core) geladen wird:
```bash
rm workspace/plugins/jokes.js
rm -f workspace/plugins/jokes.meta.json
```

### 6. Neu bauen und starten
```bash
docker compose build pi-agent
docker compose up -d pi-agent
```

## Kontrolle
- `curl -s localhost:8080/health` → läuft der Container?
- Ribo fragen "Was kannst du?" → taucht das Tool auf (falls in capabilities.js ergänzt)?
- Tool einmal auslösen zum Funktionstest.

## Häufige Fehler
- **Tool taucht nicht auf:** Import oder `coreTools`-Eintrag vergessen (Schritt 2/3).
- **"Kein Zugriff":** Permission in `users.json` fehlt (Schritt 4b), oder Tippfehler
  zwischen `checkPermission("name")` und der Permission in `users.json`.
- **Doppelte Registrierung/Konflikt:** altes Plugin in `workspace/plugins/` nicht gelöscht (Schritt 5).
- **Änderung wirkt nicht:** nur `restart` statt `build` gemacht — Core-Tools brauchen Rebuild.
