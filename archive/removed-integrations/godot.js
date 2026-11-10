import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { checkPermission } from "../lib/users.js";
import { getGodotProjectDir } from "../lib/helpers.js";

function ensureGodotProjectDir() {
  fs.mkdirSync(getGodotProjectDir(), { recursive: true });
}

function resolveGodotPath(filePath) {
  const projectDir = getGodotProjectDir();
  // res:// prefix → relative to project
  if (filePath.startsWith("res://")) return path.join(projectDir, filePath.slice(6));
  // Reject absolute paths (would escape the project)
  if (path.isAbsolute(filePath)) return path.join(projectDir, path.basename(filePath));
  return path.join(projectDir, filePath);
}

// Robust check: is the resolved path inside the project dir?
function isInsideProject(absPath) {
  const root = path.resolve(getGodotProjectDir());
  const rel = path.relative(root, path.resolve(absPath));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function listGodotFilesRecursive(dir, prefix = "") {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name.startsWith(".") || item.name === "node_modules" || item.name === ".godot") continue;
    const relPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      entries.push({ path: relPath, type: "dir" });
      entries.push(...listGodotFilesRecursive(path.join(dir, item.name), relPath));
    } else {
      entries.push({ path: relPath, type: "file" });
    }
  }
  return entries;
}

export default defineTool({
  name: "godot",
  label: "Godot",
  description: "Verwaltet ein Godot 4 Spielprojekt. Actions: create_project, write_file, read_file, list_files, delete_file. Szenen (.tscn), Scripts (.gd) und Ressourcen werden direkt als Dateien geschrieben. Zum Starten/Testen öffnet der Nutzer das Projekt in Godot auf dem Mac.",
  parameters: Type.Object({
    action: Type.String({ description: "create_project, write_file, read_file, list_files, delete_file" }),
    project_name: Type.Optional(Type.String()),
    file_path: Type.Optional(Type.String()),
    content: Type.Optional(Type.String()),
  }),
  execute: async (_toolCallId, { action, project_name, file_path, content }) => {
    const denied = checkPermission("godot");
    if (denied) return denied;
    try {
      switch (action) {
        case "create_project": {
          const name = project_name || "MeinSpiel";
          ensureGodotProjectDir();
          const projectGodot = `; Engine configuration file.\n[application]\nconfig/name="${name}"\nrun/main_scene=""\nconfig/features=PackedStringArray("4.4")\n\n[rendering]\nrenderer/rendering_method="forward_plus"\n`;
          fs.writeFileSync(path.join(getGodotProjectDir(), "project.godot"), projectGodot, "utf-8");
          for (const dir of ["scenes", "scripts", "assets", "assets/sprites", "assets/audio"]) {
            fs.mkdirSync(path.join(getGodotProjectDir(), dir), { recursive: true });
          }
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Godot-Projekt "${name}" erstellt. Öffne es in Godot: workspace/users/<name>/godot-project/` }) }], details: {} };
        }
        case "write_file": {
          if (!file_path?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "file_path erforderlich" }) }], details: {} };
          if (content == null) return { content: [{ type: "text", text: JSON.stringify({ error: "content erforderlich" }) }], details: {} };
          ensureGodotProjectDir();
          const absPath = resolveGodotPath(file_path);
          if (!isInsideProject(absPath)) return { content: [{ type: "text", text: JSON.stringify({ error: "Pfad muss im Projekt liegen" }) }], details: {} };
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, content, "utf-8");
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Datei geschrieben: ${path.relative(getGodotProjectDir(), absPath)}` }) }], details: {} };
        }
        case "read_file": {
          if (!file_path?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "file_path erforderlich" }) }], details: {} };
          const absPath = resolveGodotPath(file_path);
          if (!isInsideProject(absPath)) return { content: [{ type: "text", text: JSON.stringify({ error: "Pfad muss im Projekt liegen" }) }], details: {} };
          if (!fs.existsSync(absPath)) return { content: [{ type: "text", text: JSON.stringify({ error: `Nicht gefunden: ${file_path}` }) }], details: {} };
          const fileContent = fs.readFileSync(absPath, "utf-8");
          const truncated = fileContent.length > 5000;
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", path: file_path, content: truncated ? fileContent.slice(0, 5000) + "\n..." : fileContent }) }], details: {} };
        }
        case "list_files": {
          ensureGodotProjectDir();
          const files = listGodotFilesRecursive(getGodotProjectDir()).filter(f => f.type === "file").map(f => f.path);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${files.length} Dateien`, files }) }], details: {} };
        }
        case "delete_file": {
          if (!file_path?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "file_path erforderlich" }) }], details: {} };
          const absPath = resolveGodotPath(file_path);
          if (!isInsideProject(absPath)) return { content: [{ type: "text", text: JSON.stringify({ error: "Pfad muss im Projekt liegen" }) }], details: {} };
          if (!fs.existsSync(absPath)) return { content: [{ type: "text", text: JSON.stringify({ error: `Nicht gefunden: ${file_path}` }) }], details: {} };
          fs.unlinkSync(absPath);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Gelöscht: ${file_path}` }) }], details: {} };
        }
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Verfügbar: create_project, write_file, read_file, list_files, delete_file" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Godot-Fehler: ${e.message}` }], details: {} };
    }
  },
});
