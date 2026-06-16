# opencode harness — verified API surface (pinned to opencode 1.17.6)

Everything here was confirmed live against the installed binary
(`~/.opencode/bin/opencode`, v1.17.6), not from memory. Re-verify on upgrade.

## Server

- Start: `opencode serve --port 0 --hostname 127.0.0.1`. Port is parsed from
  stdout/stderr line `opencode server listening on http://127.0.0.1:<port>`.
- **Root the server at the session workspace dir** (`spawn(..., { cwd })`) so it
  loads that directory's `opencode.json` (this is how per-session MCP config is
  picked up). Create the session with `directory` = the same dir.

## Session run loop

- `POST /session { title, directory }` → `{ id }` (opencode session id `ses_…`).
- `POST /session/{id}/prompt_async { model?: {providerID, modelID}, system?, parts:[{type:"text",text}] }`
  → 204; the response streams over SSE.
- **Events: `GET /event` (SSE), NOT polling.** Relevant `type`s:
  - `message.part.delta { sessionID, messageID, field:"text", delta }` — streaming text
  - `session.status { sessionID, status:{ type:"busy" } }` — running
  - `session.idle { sessionID }` — turn complete (there is **no** `state` field;
    `GET /session/status` returns `{ "<sid>": { type:"busy" } }` only while busy)
  - `session.error` — failure
- Abort: `POST /session/{id}/abort`.
- Models: `opencode models` prints `provider/model` per line (connected providers
  only). Health: `opencode --version`.

## Host tools via MCP (Workstream C)

opencode can't register an in-process custom tool directly, but it connects to a
**remote MCP server**. We host one in main (`HostToolBridge`, MCP SDK
`Server` + stateless `StreamableHTTPServerTransport`) and point each session at
it.

- Config shape (written to `<workspaceRoot>/opencode.json`):
  ```json
  { "$schema": "https://opencode.ai/config.json",
    "mcp": { "multiplex": { "type": "remote", "url": "http://127.0.0.1:<port>/mcp/<sessionId>" } } }
  ```
- Verified handshake (serve cwd = workspace root): `POST /mcp … initialize` →
  `notifications/initialized` → `tools/list` → `tools/call`. The agent then
  invokes the tool; opencode may surface it namespaced (e.g. `multiplex_open_repo`).
- The bridge routes by URL path `/mcp/<our sessionId>` to that session's
  registered `HostTool[]`; `tools/call` runs the handler in main (creates the
  worktree, persists the `Workspace`) and returns the worktree path to the agent.
- A `system` note on the first prompt tells the agent to call `open_repo` before
  touching a repo, and lists the available repos.

**End-to-end verified:** a real agent run called `open_repo`, a worktree
materialized on the session branch, and the agent read a file from it.
