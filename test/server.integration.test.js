import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
const { app } = await import('../src/server.js');

const startMockMcp = () =>
  new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const rpc = JSON.parse(body);

      if (rpc.method === 'initialize') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } }
          })
        );
        return;
      }

      if (rpc.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'echo' }] } }));
        return;
      }

      if (rpc.method === 'tools/call') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: { content: [{ type: 'text', text: JSON.stringify(rpc.params.arguments) }] }
          })
        );
      }
    });

    server.listen(0, () => resolve(server));
  });

test('registers mcp server and executes workflow via orchestrator mcp interface', async () => {
  const upstream = await startMockMcp();
  const upstreamPort = upstream.address().port;
  const orchestrator = await new Promise((resolve) => app.listen(0, () => resolve(app)));
  const port = orchestrator.address().port;
  const base = `http://127.0.0.1:${port}`;

  const registration = await fetch(`${base}/api/servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Echo MCP',
      endpoint: `http://127.0.0.1:${upstreamPort}`,
      toolName: 'echo'
    })
  }).then((res) => res.json());

  const workflow = await fetch(`${base}/api/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'One Step',
      steps: [{ serverId: registration.server.id, toolName: 'echo', y: 90 }]
    })
  }).then((res) => res.json());

  const mcpTools = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} })
  }).then((res) => res.json());

  assert.equal(mcpTools.result.tools.length, 1);

  const call = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        workflowId: workflow.workflow.id,
        input: { from: 'ide' }
      }
    })
  }).then((res) => res.json());

  assert.ok(call.result.content[0].text.includes('workflowName'));

  await new Promise((resolve) => orchestrator.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
});
