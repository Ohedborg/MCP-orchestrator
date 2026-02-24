# MCP Orchestrator

A workflow canvas for composing multiple MCP servers into one MCP server endpoint.

## Product behavior

- Register external MCP servers (endpoint + tool name).
- During registration, the orchestrator behaves as an MCP client and performs:
  1. `initialize`
  2. `tools/list`
- Build a chain workflow (up to 5 steps).
- Execute the chain so each step calls the configured MCP tool and passes output forward.
- Expose all workflows as tools from a single MCP server endpoint (`POST /mcp`) for IDE consumption.

## Run

```bash
npm start
```

Then open <http://localhost:4173>.

## HTTP APIs

- `GET /api/state`
- `POST /api/servers` body: `{ "name", "endpoint", "toolName", "description" }`
- `POST /api/workflows` body: `{ "name", "steps": [{ "serverId", "toolName", "y" }] }`
- `POST /api/workflows/run` body: `{ "workflowId", "input" }`

## MCP endpoint exposed by orchestrator

`POST /mcp` with JSON-RPC 2.0 payloads:

- `initialize`
- `tools/list`
- `tools/call` with params `{ "workflowId", "input" }`

Example:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```
