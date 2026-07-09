// Drop-in mock for lib/agoraService.js — no real agents, no cost, and every
// call is recorded so tests can assert on dispatch behavior.
//
// Usage per test file:
//   vi.mock('../lib/agoraService.js', () => import('./helpers/agoraMock.js'));
//   import * as agoraMock from './helpers/agoraMock.js';

export const calls = {
  join: [],        // {channelName, agentName, extra}
  speak: [],       // {agentId, text, priority}
  think: [],       // {agentId, text}
  leave: [],       // {agentId}
  broadcasts: [],  // {channel, payload} — server→client state snapshots
};

let historyContents = [];

/** Configure what getAgentHistory returns (array of {role, content, turn_id}). */
export function setHistory(contents) {
  historyContents = contents;
}

export function resetMock() {
  for (const key of Object.keys(calls)) calls[key].length = 0;
  historyContents = [];
}

export async function joinAgent(channelName, agentName, ttsVendor, avatarVendor, extraConfig = {}) {
  calls.join.push({ channelName, agentName, ttsVendor, avatarVendor, extra: extraConfig });
  return { agent_id: `TESTAGENT-${channelName}` };
}

export async function speak(agentId, text, priority = 'INTERRUPT', interruptable = true) {
  calls.speak.push({ agentId, text, priority, interruptable });
  return { success: true };
}

export async function think(agentId, text) {
  calls.think.push({ agentId, text });
  return { success: true };
}

export async function interrupt() {
  return { success: true };
}

export async function leaveAgent(agentId) {
  calls.leave.push({ agentId });
  return { success: true };
}

export async function listAgents() {
  return { data: { count: 0, list: [] } };
}

export async function queryAgent() {
  return {};
}

export async function getAgentHistory(agentId) {
  return { agent_id: agentId, channel: '', contents: historyContents, status: 'RUNNING' };
}

export async function publishChannelMessage(channel, payload) {
  calls.broadcasts.push({ channel, payload });
}
