import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('creates workflow with capped ordered steps', () => {
  const store = createStore();
  const servers = Array.from({ length: 7 }, (_, index) =>
    store.addServer({
      name: `Server ${index + 1}`,
      endpoint: `http://localhost:${9000 + index}/mcp`,
      toolName: 'run'
    })
  );

  const workflow = store.addWorkflow({
    name: 'IDE Chain',
    steps: servers.map((server, index) => ({ serverId: server.id, y: 60 + index * 80 }))
  });

  assert.equal(workflow.steps.length, 5);
  assert.equal(workflow.steps[0].order, 1);
  assert.equal(workflow.steps[4].order, 5);
});
