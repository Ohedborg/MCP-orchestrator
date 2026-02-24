const MCP_VERSION = '2024-11-05';

const jsonRpc = (id, method, params = {}) => ({
  jsonrpc: '2.0',
  id,
  method,
  params
});

const unwrap = async (response) => {
  if (!response.ok) {
    throw new Error(`MCP upstream error: ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || payload.error);
  }
  return payload.result ?? payload;
};

export async function initializeServer(endpoint) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(
      jsonRpc(1, 'initialize', {
        protocolVersion: MCP_VERSION,
        clientInfo: {
          name: 'mcp-orchestrator',
          version: '0.2.0'
        },
        capabilities: {
          tools: {}
        }
      })
    )
  });

  return unwrap(response);
}

export async function listTools(endpoint) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(jsonRpc(2, 'tools/list', {}))
  });

  const result = await unwrap(response);
  return result.tools || [];
}

export async function callTool(endpoint, name, argumentsPayload = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(
      jsonRpc(3, 'tools/call', {
        name,
        arguments: argumentsPayload
      })
    )
  });

  return unwrap(response);
}
