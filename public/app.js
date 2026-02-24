const canvasGrid = document.getElementById('canvas-grid');
const canvas = document.getElementById('canvas');
const serverList = document.getElementById('server-list');
const workflowList = document.getElementById('workflow-list');

const addServerBtn = document.getElementById('add-server-btn');
const importJsonBtn = document.getElementById('import-json-btn');
const importJsonInput = document.getElementById('import-json-input');
const createWorkflowBtn = document.getElementById('create-workflow-btn');
const runWorkflowBtn = document.getElementById('run-workflow-btn');
const refreshBtn = document.getElementById('refresh-btn');
const centerBtn = document.getElementById('center-btn');

const serverDialog = document.getElementById('server-dialog');
const serverForm = document.getElementById('server-form');

let state = { servers: [], workflows: [], maxSteps: 5 };
let selectedWorkflowId = null;
let viewport = { x: -420, y: -140 };
let drag = null;

const applyViewport = () => {
  canvas.style.transform = `translate(${viewport.x}px, ${viewport.y}px)`;
  canvasGrid.style.backgroundPosition = `${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px`;
};

const centerViewport = () => {
  viewport = { x: -420, y: -120 };
  applyViewport();
};

const fetchState = async () => {
  const res = await fetch('/api/state');
  state = await res.json();

  if (!state.workflows.find((wf) => wf.id === selectedWorkflowId)) {
    selectedWorkflowId = state.workflows[0]?.id ?? null;
  }

  render();
};

const renderServers = () => {
  serverList.innerHTML = '';
  state.servers.forEach((server) => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${server.name}</strong><br /><small>${server.toolName}</small>`;
    serverList.append(li);
  });
};

const renderWorkflows = () => {
  workflowList.innerHTML = '';
  state.workflows.forEach((wf) => {
    const li = document.createElement('li');
    li.className = wf.id === selectedWorkflowId ? 'active' : '';
    li.innerHTML = `<strong>${wf.name}</strong><br /><small>${wf.steps.length} nodes</small>`;
    li.addEventListener('click', () => {
      selectedWorkflowId = wf.id;
      render();
    });
    workflowList.append(li);
  });
};

const renderCanvas = () => {
  canvas.innerHTML = '';
  const workflow = state.workflows.find((wf) => wf.id === selectedWorkflowId);

  if (!workflow) {
    canvas.innerHTML = '<p style="position:absolute;left:460px;top:220px;color:#667085;">Create a chain to start building your MCP workflow.</p>';
    return;
  }

  const nodes = workflow.steps.map((step) => ({
    ...step,
    x: step.x ?? 520,
    y: step.y ?? 100 + (step.order - 1) * 120
  }));

  const lane = document.createElement('div');
  lane.className = 'lane';
  lane.style.left = `${nodes[0].x + 125}px`;
  lane.style.top = `${nodes[0].y - 18}px`;
  lane.style.height = `${nodes[nodes.length - 1].y - nodes[0].y + 120}px`;
  canvas.append(lane);

  nodes.forEach((step, index) => {
    const connector = document.createElement('div');
    connector.className = 'connector';
    connector.style.left = `${step.x + 118}px`;
    connector.style.top = `${step.y - 25}px`;
    canvas.append(connector);

    const node = document.createElement('article');
    node.className = 'flow-node';
    node.style.left = `${step.x}px`;
    node.style.top = `${step.y}px`;

    const server = state.servers.find((entry) => entry.id === step.serverId);
    node.innerHTML = `
      <span class="badge">Step ${step.order}</span>
      <h4>${step.serverName}</h4>
      <small>${server?.endpoint || ''}</small>
      <div style="margin-top:6px"><small>tool: ${step.toolName}</small></div>
    `;

    if (index === nodes.length - 1) {
      const tail = document.createElement('div');
      tail.className = 'connector';
      tail.style.left = `${step.x + 118}px`;
      tail.style.top = `${step.y + 108}px`;
      canvas.append(tail);
    }

    canvas.append(node);
  });
};

const render = () => {
  renderServers();
  renderWorkflows();
  renderCanvas();
  applyViewport();
};

canvasGrid.addEventListener('pointerdown', (event) => {
  drag = { x: event.clientX, y: event.clientY, startX: viewport.x, startY: viewport.y };
  canvasGrid.classList.add('dragging');
  canvasGrid.setPointerCapture(event.pointerId);
});

canvasGrid.addEventListener('pointermove', (event) => {
  if (!drag) return;
  viewport.x = drag.startX + (event.clientX - drag.x);
  viewport.y = drag.startY + (event.clientY - drag.y);
  applyViewport();
});

canvasGrid.addEventListener('pointerup', (event) => {
  if (!drag) return;
  drag = null;
  canvasGrid.classList.remove('dragging');
  canvasGrid.releasePointerCapture(event.pointerId);
});

addServerBtn.addEventListener('click', () => serverDialog.showModal());
refreshBtn.addEventListener('click', fetchState);
centerBtn.addEventListener('click', centerViewport);
importJsonBtn.addEventListener('click', () => importJsonInput.click());

importJsonInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const payload = JSON.parse(text);

    const response = await fetch('/api/servers/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      alert(result.error || 'Import failed');
    } else if (result.errors?.length) {
      alert(`Imported ${result.imported.length} server(s). Errors: ${result.errors.map((error) => `${error.name}: ${error.error}`).join(', ')}`);
    } else {
      alert(`Imported ${result.imported.length} server(s).`);
    }

    await fetchState();
  } catch {
    alert('Invalid JSON file');
  } finally {
    importJsonInput.value = '';
  }
});

serverDialog.addEventListener('close', async () => {
  if (serverDialog.returnValue !== 'submit') {
    serverForm.reset();
    return;
  }

  const form = new FormData(serverForm);
  const response = await fetch('/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.get('name'),
      endpoint: form.get('endpoint'),
      toolName: form.get('toolName'),
      description: form.get('description')
    })
  });

  if (!response.ok) {
    const responsePayload = await response.json();
    alert(responsePayload.error || 'Could not register MCP server');
  }

  serverForm.reset();
  await fetchState();
});

createWorkflowBtn.addEventListener('click', async () => {
  if (!state.servers.length) {
    alert('Add at least one server first.');
    return;
  }

  const name = prompt('Workflow name', `Flow ${state.workflows.length + 1}`);
  if (!name) return;

  const steps = state.servers.slice(0, state.maxSteps).map((server, index) => ({
    serverId: server.id,
    toolName: server.toolName,
    x: 520,
    y: 100 + index * 120
  }));

  await fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, steps })
  });

  await fetchState();
});

runWorkflowBtn.addEventListener('click', async () => {
  if (!selectedWorkflowId) {
    alert('Pick a workflow first.');
    return;
  }

  const response = await fetch('/api/workflows/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId: selectedWorkflowId, input: { source: 'canvas' } })
  });

  const responsePayload = await response.json();
  if (!response.ok) {
    alert(responsePayload.error || 'Run failed');
    return;
  }

  alert(JSON.stringify(responsePayload.result, null, 2));
});

fetchState();
