/**
 * Dynamische Roblox-MCP-Tools für das pi Coding Agent SDK.
 *
 * Verwendung:
 *   import { loadRobloxMcpTools } from "./roblox-mcp-tools.js";
 *
 *   const robloxTools = await loadRobloxMcpTools();
 *
 *   const { session } = await createAgentSession({
 *     ...sessionConfig,
 *     customTools: [...coreTools, ...robloxTools],
 *   });
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_BRIDGE_URL = "http://host.docker.internal:8090";
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Wandelt MCP-Toolnamen in gültige pi-Toolnamen um.
 */
function sanitizeToolName(name) {
  const safe = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `roblox_${safe || "unnamed_tool"}`;
}

/**
 * Kombiniert das Abbruchsignal des Agents mit einem Timeout.
 */
function makeSignal(parentSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  return parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
}

/**
 * Konvertiert MCP-Inhalte in das pi-Tool-Ergebnisformat.
 */
function normalizeMcpContent(content) {
  if (!Array.isArray(content)) {
    return [
      {
        type: "text",
        text: JSON.stringify(content ?? null),
      },
    ];
  }

  const normalized = [];

  for (const item of content) {
    if (item?.type === "text") {
      normalized.push({
        type: "text",
        text: String(item.text ?? ""),
      });
    } else if (
      item?.type === "image" &&
      typeof item.data === "string" &&
      typeof item.mimeType === "string"
    ) {
      normalized.push({
        type: "image",
        data: item.data,
        mimeType: item.mimeType,
      });
    } else {
      normalized.push({
        type: "text",
        text: JSON.stringify(item),
      });
    }
  }

  return normalized.length
    ? normalized
    : [{ type: "text", text: "(MCP returned no content)" }];
}

/**
 * Liest eine JSON-Antwort und behandelt HTTP-Fehler.
 */
async function readJson(response) {
  const text = await response.text();
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Bridge returned non-JSON (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      parsed?.error ??
        parsed?.message ??
        `Bridge HTTP ${response.status}`,
    );
  }

  return parsed;
}

/**
 * Lädt die MCP-Tooldefinitionen und registriert jedes Tool einzeln.
 *
 * Umgebungsvariablen:
 *   ROBLOX_BRIDGE_URL       Standard: http://host.docker.internal:8090
 *   ROBLOX_MCP_TIMEOUT      Standard: 60000 Millisekunden
 *   ROBLOX_MCP_REQUIRED     Standard: true; false erlaubt Start ohne Roblox-Tools
 */
export async function loadRobloxMcpTools(options = {}) {
  const bridgeUrl = (
    options.bridgeUrl ??
    process.env.ROBLOX_BRIDGE_URL ??
    DEFAULT_BRIDGE_URL
  ).replace(/\/+$/, "");

  const rawTimeout = Number(
    options.timeoutMs ?? process.env.ROBLOX_MCP_TIMEOUT,
  );

  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0
      ? rawTimeout
      : DEFAULT_TIMEOUT_MS;

  const required =
    options.required ??
    String(process.env.ROBLOX_MCP_REQUIRED ?? "true").toLowerCase() !==
      "false";

  // MCP-Toolliste vom Bridge-Server laden
  let payload;

  try {
    const response = await fetch(`${bridgeUrl}/tools`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
      },
    });

    payload = await readJson(response);
  } catch (error) {
    if (!required) {
      console.warn(
        `[roblox-mcp] Bridge nicht erreichbar. ` +
          `Roblox-Tools werden übersprungen: ${error.message}`,
      );

      return [];
    }

    throw new Error(
      `[roblox-mcp] MCP-Tools konnten nicht von ${bridgeUrl} geladen werden: ` +
        error.message,
      { cause: error },
    );
  }

  // Unterstützt unterschiedliche Antwortformen:
  // { tools: [...] }
  // { tools: { tools: [...] } }
  // [...]
  const mcpTools = Array.isArray(payload?.tools)
    ? payload.tools
    : Array.isArray(payload?.tools?.tools)
      ? payload.tools.tools
      : Array.isArray(payload)
        ? payload
        : null;

  if (!mcpTools) {
    throw new Error(
      "[roblox-mcp] Ungültige /tools-Antwort: Toolliste fehlt.",
    );
  }

  const usedNames = new Set();
  const tools = [];

  for (const mcpTool of mcpTools) {
    if (!mcpTool?.name) continue;

    const name = sanitizeToolName(mcpTool.name);

    if (usedNames.has(name)) {
      throw new Error(
        `[roblox-mcp] Toolnamen-Kollision: ${mcpTool.name} -> ${name}`,
      );
    }

    usedNames.add(name);

    // MCP inputSchema ist ein JSON Schema.
    const schema =
      mcpTool.inputSchema &&
      typeof mcpTool.inputSchema === "object" &&
      mcpTool.inputSchema.type
        ? mcpTool.inputSchema
        : {
            type: "object",
            properties: {},
            additionalProperties: true,
          };

    tools.push(
      defineTool({
        name,
        label: `Roblox: ${mcpTool.name}`,

        description: [
          mcpTool.description ||
            `Rufe das Roblox-MCP-Tool "${mcpTool.name}" auf.`,
          "Verwende die exakte studio_id aus roblox_list_roblox_studios.",
          "Wenn datamodel_type benötigt wird, rufe zuerst roblox_get_studio_state auf und verwende einen dort verfügbaren exakten Wert.",
        ].join(" "),

        parameters: Type.Unsafe(schema),

        // Roblox Studio ist zustandsbehaftet; Aufrufe serialisieren.
        executionMode: "sequential",

        async execute(_toolCallId, params, signal) {
          const callSignal = makeSignal(signal, timeoutMs);

          try {
            const response = await fetch(`${bridgeUrl}/call`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json",
              },
              body: JSON.stringify({
                tool_name: mcpTool.name,
                arguments: params ?? {},
                timeout: timeoutMs,
              }),
              signal: callSignal,
            });

            const result = await readJson(response);

            const isError = Boolean(
              result?.isError ?? result?.result?.isError,
            );

            const content = normalizeMcpContent(
              result?.content ?? result?.result?.content ?? result,
            );

            return {
              content,
              details: {
                mcpTool: mcpTool.name,
                isError,
              },
              ...(isError ? { isError: true } : {}),
            };
          } catch (error) {
            const timedOut =
              callSignal.aborted && !signal?.aborted;

            return {
              content: [
                {
                  type: "text",
                  text:
                    `[roblox-mcp] ${
                      timedOut
                        ? `Timeout nach ${timeoutMs} ms`
                        : "Tool-Aufruf fehlgeschlagen"
                    }: ${error.message}`,
                },
              ],
              details: {
                mcpTool: mcpTool.name,
              },
              isError: true,
            };
          }
        },
      }),
    );
  }

  if (tools.length === 0 && required) {
    throw new Error(
      "[roblox-mcp] Der Bridge-Server hat keine MCP-Tools geliefert.",
    );
  }

  console.info(
    `[roblox-mcp] ${tools.length} Tools registriert: ` +
      tools.map((tool) => tool.name).join(", "),
  );

  return tools;
}