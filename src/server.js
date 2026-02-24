import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createStore } from './store.js';
import { callTool, initializeServer, listTools } from './mcpClient.js';

const port = Number(process.env.PORT || 4173);
const publicDir = join(process.cwd(), 'public');
const store = createStore();
const supportedProtocolVersion = '2024-11-05';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const readBody = async (req) => {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const respondJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const jsonRpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const jsonRpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const parseIdeJsonConfig = (config) => {
  const mcpServers = config?.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object') {
    return { error: 'JSON must contain an mcpServers object' };
  }

  const entries = Object.entries(mcpServers).map(([name, definition]) => ({
    name,
    endpoint: definition.url || definition.endpoint,
    description: definition.description || '',
    toolName: definition.toolName,
    transport: definition.transport || 'streamable-http'
  }));

  return { entries };
};

const registerServer = async ({ name, endpoint, description, toolName, transport }) => {
  const init = await initializeServer(endpoint);
  const tools = await listTools(endpoint);

  const selectedTool = toolName || tools[0]?.name;
  if (!selectedTool) {
    return { error: `No tools found on server: ${name}` };
  }

  if (!tools.some((tool) => tool.name === selectedTool)) {
    return { error: `Tool not found on server: ${selectedTool}`, tools };
  }

  const server = store.addServer({ name, endpoint, description, toolName: selectedTool, transport });
  return { server, negotiated: init, tools };
};

const executeWorkflow = async ({ workflowId, input = {} }) => {
  const workflow = store.getWorkflow(workflowId);
  if (!workflow) {
    return { error: 'Workflow not found' };
  }

  let cursor = input;
  const trace = [];

  for (const step of workflow.steps) {
    const server = store.getServer(step.serverId);
    if (!server) {
      return { error: `Step server missing: ${step.serverId}` };
    }

    try {
      const result = await callTool(server.endpoint, step.toolName, {
        input: cursor,
        workflowId,
        step: step.order
      });

      trace.push({
        step: step.order,
        serverId: server.id,
        serverName: server.name,
        endpoint: server.endpoint,
        toolName: step.toolName,
        result
      });

      cursor = {
        upstream: cursor,
        output: result
      };
    } catch (error) {
      return {
        error: `Failed at step ${step.order}`,
        details: String(error.message || error),
        trace
      };
    }
  }

  return {
    workflowId,
    workflowName: workflow.name,
    protocolVersion: supportedProtocolVersion,
    trace,
    final: cursor
  };
};

const serveStatic = async (res, pathname) => {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(publicDir, cleanPath);
  const extension = extname(filePath);
  const type = contentTypes[extension] || 'application/octet-stream';

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
};

export const app = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/state') {
    respondJson(res, 200, store.asSnapshot());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/servers') {
    const body = await readBody(req);
    if (!body) {
      respondJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const { name, endpoint, description, toolName } = body;
    if (!name || !endpoint || !toolName) {
      respondJson(res, 400, { error: 'name, endpoint, and toolName are required' });
      return;
    }

    try {
      const result = await registerServer({ name, endpoint, description, toolName, transport: 'streamable-http' });
      if (result.error) {
        respondJson(res, 400, result);
        return;
      }

      respondJson(res, 201, result);
      return;
    } catch (error) {
      respondJson(res, 502, { error: 'Failed to connect to MCP server', details: String(error.message || error) });
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/servers/import') {
    const body = await readBody(req);
    if (!body) {
      respondJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const parsed = parseIdeJsonConfig(body);
    if (parsed.error) {
      respondJson(res, 400, parsed);
      return;
    }

    const imported = [];
    const errors = [];

    for (const entry of parsed.entries) {
      if (!entry.name || !entry.endpoint) {
        errors.push({ name: entry.name || 'unknown', error: 'name and endpoint/url are required' });
        continue;
      }

      try {
        const result = await registerServer(entry);
        if (result.error) {
          errors.push({ name: entry.name, error: result.error });
          continue;
        }
        imported.push(result.server);
      } catch (error) {
        errors.push({ name: entry.name, error: String(error.message || error) });
      }
    }

    respondJson(res, 201, { imported, errors });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/workflows') {
    const body = await readBody(req);
    if (!body) {
      respondJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const { name, steps } = body;
    if (!name || !Array.isArray(steps) || !steps.length) {
      respondJson(res, 400, { error: 'name and steps[] are required' });
      return;
    }

    const workflow = store.addWorkflow({ name, steps });
    if (!workflow) {
      respondJson(res, 400, { error: 'No valid steps for workflow' });
      return;
    }

    respondJson(res, 201, { workflow });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/workflows/run') {
    const body = await readBody(req);
    if (!body) {
      respondJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const { workflowId, input } = body;
    const result = await executeWorkflow({ workflowId, input });

    if (result.error) {
      respondJson(res, 400, result);
      return;
    }

    respondJson(res, 200, { result });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/mcp') {
    const request = await readBody(req);
    if (!request) {
      respondJson(res, 400, jsonRpcError(null, -32700, 'Parse error'));
      return;
    }

    const { id = null, method, params = {} } = request;

    if (method === 'initialize') {
      respondJson(
        res,
        200,
        jsonRpcResult(id, {
          protocolVersion: supportedProtocolVersion,
          serverInfo: { name: 'mcp-orchestrator', version: '0.2.0' },
          capabilities: { tools: {} }
        })
      );
      return;
    }

    if (method === 'tools/list') {
      const workflows = store.asSnapshot().workflows;
      const tools = workflows.map((workflow) => ({
        name: `workflow_${workflow.id.slice(0, 8)}`,
        description: `Run chained MCP workflow: ${workflow.name}`,
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'object' }
          },
          additionalProperties: true
        },
        _meta: {
          workflowId: workflow.id,
          steps: workflow.steps.length
        }
      }));

      respondJson(res, 200, jsonRpcResult(id, { tools }));
      return;
    }

    if (method === 'tools/call') {
      const workflowId = params.workflowId;
      if (!workflowId) {
        respondJson(res, 200, jsonRpcError(id, -32602, 'workflowId is required'));
        return;
      }

      const result = await executeWorkflow({ workflowId, input: params.input || {} });
      if (result.error) {
        respondJson(res, 200, jsonRpcError(id, -32000, result.details || result.error));
        return;
      }

      respondJson(
        res,
        200,
        jsonRpcResult(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        })
      );
      return;
    }

    respondJson(res, 200, jsonRpcError(id, -32601, `Method not found: ${method}`));
    return;
  }

  await serveStatic(res, url.pathname);
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`MCP orchestrator listening on http://localhost:${port}`);
  });
}
