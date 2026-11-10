import { runAsUser } from "../lib/users.js";
import { limitToolResult } from "../lib/context.js";
import { recordInteraction } from "../lib/interactions.js";

export function wrapTool(tool, userId, record = recordInteraction) {
  return { ...tool, execute: (...args) => runAsUser(userId, async () => {
    const result = await tool.execute(...args);
    // Memory can explicitly log legacy calls; never log the logger itself.
    if (tool.name !== "memory" && !result?.isError && !args[2]?.aborted) {
      try { record(tool.name); } catch {
        console.warn(JSON.stringify({ event: "interaction_log_unavailable" }));
      }
    }
    return limitToolResult(result);
  }, { signal: args[2] }) };
}
