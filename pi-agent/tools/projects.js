import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import { randomUUID } from "node:crypto";
import { resolveWithin, safeName } from "../lib/security.js";
import path from "path";
import { getCurrentUserId, getUserWorkspacePath, checkPermission } from "../lib/users.js";

function getProjectsDir() {
  const userId = getCurrentUserId();
  return resolveWithin(getUserWorkspacePath(userId), "projects");
}

// Resolve a path within the projects dir, with robust traversal check
function resolveProjectPath(relPath) {
  try { return resolveWithin(getProjectsDir(), relPath); } catch { return null; }
}

function listRecursive(dir, base, entries = []) {
  if (!fs.existsSync(dir)) return entries;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
    const abs = path.join(dir, item.name);
    const rel = path.relative(base, abs);
    if (item.isDirectory()) {
      entries.push({ path: rel + "/", type: "dir" });
      listRecursive(abs, base, entries);
    } else {
      entries.push({ path: rel, type: "file", size: fs.statSync(abs).size });
    }
  }
  return entries;
}

export default defineTool({
  name: "projects",
  label: "Projekte",
  description: "Erstellt und verwaltet Code-Projekte (JavaScript, Python, Java, etc.) im Workspace des Nutzers. Actions: write_file (Datei schreiben), read_file (lesen), list (Projektdateien auflisten), delete_file (löschen), zip (Projekt als ZIP zum Download/Versand packen).",
  parameters: Type.Object({
    action: Type.String({ description: "write_file, read_file, list, delete_file, zip" }),
    project: Type.Optional(Type.String({ description: "Projektname (z.B. counter-app, csv-merger)" })),
    file_path: Type.Optional(Type.String({ description: "Relativer Pfad innerhalb des Projekts (z.B. src/main/java/App.java, index.js, pom.xml)" })),
    content: Type.Optional(Type.String({ description: "Dateiinhalt (für write_file)" })),
    offset: Type.Optional(Type.Number({ description: "Startzeile für read_file (1-basiert, default: 1)" })),
    limit: Type.Optional(Type.Number({ description: "Anzahl Zeilen für read_file (default: 200)" })),
  }),
  execute: async (_toolCallId, { action, project, file_path, content, offset, limit }, signal) => {
    const denied = checkPermission("projects");
    if (denied) return denied;
    try {
      const userId = getCurrentUserId();

      switch (action) {
        case "write_file": {
          if (!project?.trim() || !file_path?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "project und file_path erforderlich" }) }], details: {} };
          if (content == null) return { content: [{ type: "text", text: JSON.stringify({ error: "content erforderlich" }) }], details: {} };
          const abs = resolveProjectPath(path.join(project.trim(), file_path.trim()));
          if (!abs) return { content: [{ type: "text", text: JSON.stringify({ error: "Ungültiger Pfad" }) }], details: {} };
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content, "utf-8");
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Datei geschrieben: ${project}/${file_path}` }) }], details: {} };
        }

        case "read_file": {
          if (!project?.trim() || !file_path?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "project und file_path erforderlich" }) }], details: {} };
          const abs = resolveProjectPath(path.join(project.trim(), file_path.trim()));
          if (!abs || !fs.existsSync(abs)) return { content: [{ type: "text", text: JSON.stringify({ error: `Nicht gefunden: ${file_path}` }) }], details: {} };
          if(offset!==undefined && (!Number.isInteger(offset) || offset<1)) throw new Error("offset muss eine positive ganze Zahl sein");
          if(limit!==undefined && (!Number.isInteger(limit) || limit<1 || limit>500)) throw new Error("limit muss zwischen 1 und 500 liegen");
          if(fs.statSync(abs).size>2*1024*1024) throw new Error("Datei zu groß für Textanzeige (max. 2 MB)");
          const fileContent = fs.readFileSync(abs, "utf-8");
          const allLines = fileContent.split("\n");
          const totalLines = allLines.length;
          const start = Math.max(0, (offset || 1) - 1);
          const end = Math.min(totalLines, start + (limit || 200));
          const slice = allLines.slice(start, end);
          const display = slice.map((l, i) => `${start + i + 1}: ${l}`).join("\n");
          const truncated = end < totalLines;
          return { content: [{ type: "text", text: JSON.stringify({
            status: "ok",
            path: file_path,
            total_lines: totalLines,
            showing: `${start + 1}-${end}`,
            truncated,
            content: display,
          }) }], details: {} };
        }

        case "list": {
          const projectsDir = getProjectsDir();
          if (project?.trim()) {
            const abs = resolveProjectPath(project.trim());
            if (!abs || !fs.existsSync(abs)) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Projekt "${project}" existiert nicht.`, files: [] }) }], details: {} };
            const files = listRecursive(abs, abs);
            const formatted = files.map(f => f.type === "dir" ? `📁 ${f.path}` : `   ${f.path}`).join("\n");
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${project}:\n${formatted}`, files }) }], details: {} };
          }
          // List all projects
          if (!fs.existsSync(projectsDir)) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine Projekte vorhanden.", projects: [] }) }], details: {} };
          const projects = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
          if (projects.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine Projekte vorhanden.", projects: [] }) }], details: {} };
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Projekte: ${projects.join(", ")}`, projects }) }], details: {} };
        }

        case "delete_file": {
          if (!project?.trim() || !file_path?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "project und file_path erforderlich" }) }], details: {} };
          const abs = resolveProjectPath(path.join(project.trim(), file_path.trim()));
          if (!abs || !fs.existsSync(abs)) return { content: [{ type: "text", text: JSON.stringify({ error: `Nicht gefunden: ${file_path}` }) }], details: {} };
          fs.unlinkSync(abs);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Gelöscht: ${project}/${file_path}` }) }], details: {} };
        }

        case "zip": {
          if (!project?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "project erforderlich" }) }], details: {} };
          const projectAbs = resolveProjectPath(project.trim());
          if (!projectAbs || !fs.existsSync(projectAbs)) return { content: [{ type: "text", text: JSON.stringify({ error: `Projekt "${project}" existiert nicht` }) }], details: {} };

          const { ZipArchive } = await import("archiver");
          const zipName = `${safeName(project)}.zip`;
          const zipPath = resolveWithin(getProjectsDir(), zipName);
          const temporary = resolveWithin(getProjectsDir(), `export-${randomUUID()}.tmp`);
          try {
            await new Promise((resolve,reject)=>{
              const archive = new ZipArchive({zlib:{level:6}});
              const output = fs.createWriteStream(temporary,{flags:"wx",mode:0o600});
              const abort=()=>{archive.abort();output.destroy();reject(signal?.reason || new Error("Export abgebrochen"));};
              output.on("close",()=>{signal?.removeEventListener("abort",abort);resolve();});
              output.on("error",reject);archive.on("error",error=>{output.destroy();reject(error);});
              archive.on("warning",error=>{output.destroy();reject(error);});
              if(signal?.aborted) {abort();return;}
              signal?.addEventListener("abort",abort,{once:true});
              archive.pipe(output);
              for(const file of listRecursive(projectAbs,projectAbs).filter(f=>f.type==="file")) {
                archive.file(resolveWithin(projectAbs,file.path),{name:`${project}/${file.path}`});
              }
              archive.finalize().catch(reject);
            });
            resolveWithin(getProjectsDir(),zipName);
            fs.renameSync(temporary,zipPath);
          } finally {try{fs.unlinkSync(temporary);}catch(error){if(error.code!=="ENOENT")throw error;}}

          const relPath = `projects/${zipName}`;
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Projekt "${project}" als ZIP gepackt.`, file_marker: `[FILE:${userId}:${relPath}]` }) }], details: {} };
        }

        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Verfügbar: write_file, read_file, list, delete_file, zip" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Projekt-Fehler: ${e.message}` }], details: {} };
    }
  },
});
