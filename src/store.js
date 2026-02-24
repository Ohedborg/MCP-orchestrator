import { randomUUID } from 'node:crypto';

const MAX_STEPS = 5;

export function createStore() {
  const state = {
    servers: [],
    workflows: []
  };

  const addServer = ({ name, endpoint, description, toolName, transport = 'streamable-http' }) => {
    const server = {
      id: randomUUID(),
      name,
      endpoint,
      description: description || '',
      toolName,
      transport,
      createdAt: new Date().toISOString()
    };
    state.servers.push(server);
    return server;
  };

  const addWorkflow = ({ name, steps }) => {
    const resolvedSteps = steps
      .slice(0, MAX_STEPS)
      .map((step, index) => {
        const server = state.servers.find((candidate) => candidate.id === step.serverId);
        if (!server) {
          return null;
        }
        return {
          id: randomUUID(),
          order: index + 1,
          serverId: server.id,
          serverName: server.name,
          toolName: step.toolName || server.toolName,
          x: step.x ?? 50,
          y: step.y ?? 90 + index * 110
        };
      })
      .filter(Boolean);

    if (!resolvedSteps.length) {
      return null;
    }

    const workflow = {
      id: randomUUID(),
      name,
      steps: resolvedSteps,
      createdAt: new Date().toISOString()
    };

    state.workflows.push(workflow);
    return workflow;
  };

  const getServer = (serverId) => state.servers.find((server) => server.id === serverId);
  const getWorkflow = (workflowId) => state.workflows.find((workflow) => workflow.id === workflowId);

  const asSnapshot = () => ({
    servers: state.servers,
    workflows: state.workflows,
    maxSteps: MAX_STEPS
  });

  return {
    addServer,
    addWorkflow,
    getServer,
    getWorkflow,
    asSnapshot
  };
}
