import type { ITurnFinishedMessage } from './conversational-ai-api/type'

export type LatencyTurn = {
  turn_id: number
  agent_id: string
  start_at?: number
  e2e_latency_ms?: number
  segmented_latency_ms?: Array<{ name?: string; latency?: number }>
}

export function parseTurnFinishedMessage(
  msg: ITurnFinishedMessage
): LatencyTurn | null {
  const payload = msg?.payload
  if (!payload || typeof payload.turn_id !== 'number') return null
  return {
    turn_id: payload.turn_id,
    agent_id: payload.agent_id,
    start_at: payload.start?.start_at,
    e2e_latency_ms: payload.metrics?.e2e_latency_ms,
    segmented_latency_ms: payload.metrics?.segmented_latency_ms,
  }
}
