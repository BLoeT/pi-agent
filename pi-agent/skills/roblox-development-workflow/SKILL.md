---
name: roblox-development-workflow
description: Develop, inspect, debug, and modify Roblox Studio experiences through the Roblox MCP tools. Use whenever a task involves Roblox game structure, Instances, Luau scripts, Studio state, assets, playtesting, or debugging.
---

# Roblox Development Workflow

You are modifying a real Roblox Studio experience through MCP tools. Do not guess the DataModel, instance paths, Studio ID, play state, or API behavior. Inspect first, make the smallest safe change, then verify it in Studio.

## 1. Select the correct Studio instance

1. Call `roblox_list_roblox_studios` before any other Roblox operation.
2. Read the returned instance IDs and human-readable names/place identifiers.
3. Select the Studio instance that matches the user's intended project.
4. If more than one instance could match, ask the user which one to modify. Never choose an arbitrary instance.
5. Pass the selected `studio_id` to every tool that requires it.

Do not invent or reuse a `studio_id` from an earlier unrelated task or session.

## 2. Determine the current Studio state

1. Call `roblox_get_studio_state`.
2. Check whether Studio is in Edit mode or a playtest.
3. For tools requiring `datamodel_type`, use only a value reported as available by `get_studio_state`.
4. Use `Edit` for edit-time DataModel operations. `Edit` is rejected while playing.
5. During a playtest, distinguish `Client` from `Server`; inspect the correct side for the behavior being investigated.
6. If the required state is unavailable, use `roblox_start_stop_play` only when switching state is necessary. Do not stop a playtest the user is actively using without a clear reason.

## 3. Explore before changing anything

For any non-trivial task:

1. Use `roblox_search_game_tree` to inspect the relevant part of the hierarchy. Start with a narrow path such as `Workspace`, `ReplicatedStorage`, `ServerScriptService`, `ServerStorage`, `StarterPlayer`, or `StarterGui` rather than dumping the entire DataModel.
2. Use `roblox_inspect_instance` for relevant Instances to read their class, properties, attributes, children, and exact paths.
3. Use `roblox_script_search` when you know part of a script's name.
4. Use `roblox_script_grep` when searching for a function, event, property, remote, or symbol across scripts.
5. Use `roblox_script_read` to read the complete contents of each script that may be affected. Do not edit based only on a filename or a partial grep result.
6. Track exact paths and class names from tool results. Do not invent paths.

For broad or multi-script investigations, use the `explore` subagent when appropriate. Ask it to return relevant paths, script contents or excerpts, dependencies, and a concise architecture summary. The subagent is for investigation; review its findings before making edits.

## 4. Plan the implementation

Before writing or editing code, form a short plan that identifies:

- The behavior the user asked for.
- The exact Instances and scripts involved.
- Whether each script belongs on the server, client, or is a shared ModuleScript.
- Required remotes, modules, attributes, tags, and data flow.
- Existing code that must be preserved.
- How the result will be tested.

Respect Roblox's client/server security model:

- The server is authoritative for currency, inventory, damage, rewards, progression, purchases, and other security-sensitive state.
- Treat all client input and RemoteEvent/RemoteFunction arguments as untrusted.
- Validate types, ranges, ownership, distance, cooldowns, and game state on the server.
- Do not put secrets or privileged logic in LocalScripts or ReplicatedStorage.
- Use RemoteEvents/RemoteFunctions deliberately; do not create duplicate remotes if the project already has the required ones.
- Avoid creating a second competing system when the experience already has an established module or service for that behavior.

## 5. Verify Roblox APIs before relying on uncertain details

- Use the `rbx-docs-search` skill through `roblox_skill` when an API, class, property, event, method, service, or engine behavior is uncertain.
- Retrieve the relevant official Creator Hub reference with `roblox_http_get` when necessary.
- Prefer official Roblox API documentation over memory or assumptions.
- Do not invent API names, enum members, event signatures, or property names.
- Use the existing project conventions when they are valid; do not refactor unrelated code.

## 6. Edit scripts safely

For an existing script:

1. Read it with `roblox_script_read` before editing.
2. Prefer the smallest targeted edit that preserves surrounding logic and style.
3. Use `roblox_multi_edit` with the exact dot-notation path returned by inspection/search.
4. Every `old_string` must match the current script exactly, including whitespace.
5. Every `old_string` and `new_string` must differ.
6. Remember that edits in one `multi_edit` call are applied sequentially and atomically. Plan overlapping edits carefully.
7. After editing, read the script again and verify the resulting code.

For a new script:

1. Confirm the intended parent path and script class (`Script`, `LocalScript`, or `ModuleScript`).
2. Use `roblox_multi_edit` with the exact path and required `className`.
3. Create the initial contents with the first edit using an empty `old_string`.
4. Verify that the script exists at the expected path and read it back.

Do not claim a script is correct merely because the write operation succeeded.

## 7. Luau quality requirements

- Use Luau syntax, not JavaScript, TypeScript, Python, or generic Lua assumptions.
- Use `local` for variables unless a global is intentionally required.
- Prefer `task.wait`, `task.spawn`, and `task.defer` over deprecated scheduling APIs.
- Handle asynchronous operations and yielding deliberately.
- Check potentially missing Instances before using them (`FindFirstChild`, `WaitForChild` with a sensible timeout, or an equivalent project convention).
- Avoid unbounded `while` loops. Every loop waiting for a state change must yield.
- Avoid expensive work on `RunService` frame events unless necessary.
- Disconnect event connections and clean up temporary Instances when their lifecycle ends.
- Avoid duplicate event connections, duplicate remotes, and repeated initialization.
- Preserve strict typing conventions already used by the project; add useful Luau types where they clarify interfaces.
- Handle failure paths and provide actionable warnings/errors rather than silently swallowing exceptions.
- Do not use `pcall` to hide errors. If using it, inspect and handle its returned success flag and error value.
- Keep server-authoritative logic on the server and presentation/input logic on the client.

## 8. Validate after every meaningful change

1. Read back every changed script.
2. Check that paths, class names, references, and required Instances match the actual DataModel.
3. Call `roblox_get_console_output` and inspect new errors and warnings. Distinguish pre-existing log entries from errors caused by the change where possible.
4. If runtime behavior matters, start a playtest with `roblox_start_stop_play`, then inspect the correct Client/Server DataModel and exercise the relevant behavior.
5. Use `roblox_user_keyboard_input` or `roblox_user_mouse_input` only when real interaction is needed.
6. Capture the screen with `roblox_screen_capture` when visual layout or scene appearance must be checked.
7. Stop the playtest and return to Edit mode when appropriate.
8. If an error appears, diagnose it before making another speculative change. Use `rbx-debug` for deeper runtime debugging when useful.
9. Re-read and re-test after each fix.

`roblox_execute_luau` runs on Studio's main thread. It can freeze Studio until the code yields. For bulk creation or large loops, split work into bounded chunks and yield between chunks. Do not run a large unbounded operation in one call.

## 9. Asset and generated-content operations

- Use `roblox_search_asset` before inserting an asset when the user asks to find one.
- Use `roblox_insert_asset` with the returned asset ID and the correct parent path.
- For generated models/scenes, choose the specific generation tool that matches the request (`roblox_generate_scene`, `roblox_generate_procedural_model`, `roblox_generate_mesh`, `roblox_generate_avatar`, etc.).
- Long-running generation tools should use their asynchronous mode when offered. Keep the returned `jobId`; call `roblox_wait_job_finished` only when the result is needed for the next step or the user explicitly asks to wait.
- Do not insert assets from another creator/group inventory into the current experience without the consent required by the tool's instructions.

## 10. Report honestly

At the end, summarize:

- What changed and the exact paths affected.
- Which tests or playtests were actually performed.
- Any remaining errors, warnings, or unverified behavior.
- Never say a test passed if it was not run.
- Never claim visual or runtime behavior is correct based only on static code inspection.
