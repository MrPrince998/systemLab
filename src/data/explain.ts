import type { Metrics } from '../engine/types'

const reasonText: Record<string, (n: number) => string> = {
  dropped: (n) => `${n} requests were lost in the network.`,
  'no healthy backend': (n) => `${n} requests found no backend to route to.`,
  timeout: (n) => `${n} requests hit a timeout: a caller stopped waiting for a slow answer.`,
  'circuit open': (n) => `${n} requests failed fast because a circuit breaker was open. That’s quick failure instead of a long wait.`,
  'queue full': (n) => `${n} requests were rejected because a queue was full. Workers can’t keep up.`,
  'write sent to replica': (n) => `${n} writes were sent to a read-only replica. Writes must reach the primary database.`,
  'replica has no primary': (n) => `${n} reads hit a replica with no primary feeding it, so it has no data.`,
  'routing loop': (n) => `${n} requests went round in circles. Check for a loop in your connections.`,
}

/** Turns run metrics into observations. They point at symptoms, not the fix. */
export function observations(m: Metrics): string[] {
  const out: string[] = []
  if (m.failed === 0) out.push(`All ${m.total} requests succeeded.`)
  for (const [reason, n] of Object.entries(m.failuresByReason)) {
    if (reasonText[reason]) out.push(reasonText[reason](n))
    else if (reason.endsWith('overloaded')) out.push(`${n} requests were rejected because a ${reason.replace(' overloaded', '')} received more than its capacity. Which node is running hot?`)
    else if (reason.endsWith('down')) out.push(`${n} requests timed out waiting for a ${reason.replace(' down', '')} that never answered.`)
    else out.push(`${n} requests failed: ${reason}.`)
  }
  const hot = Object.entries(m.utilization).filter(([, u]) => u > 1).map(([id]) => id)
  if (hot.length) out.push(`Over capacity: ${hot.join(', ')}. These are your bottlenecks.`)
  if (m.writes) out.push(`${m.writes} writes and ${m.reads} reads.`)
  if (m.cacheHits + m.cacheMisses > 0) out.push(`Cache hit rate ${Math.round(m.cacheHitRate * 100)}%, so only ${m.dbQueries + m.replicaReads} reads reached a database.`)
  if (m.replicaReads) out.push(`Replicas served ${m.replicaReads} reads; the primary served ${m.dbQueries}.`)
  if (m.staleReads) out.push(`${m.staleReads} reads returned out-of-date data (replication lag or an un-invalidated cache).`)
  if (m.messagesConsumed || m.queueDepth) out.push(`Workers finished ${m.messagesConsumed} queued jobs; ${m.queueDepth} are still waiting.`)
  if (m.retries) out.push(`Servers retried ${m.retries} times. Every retry is extra load on something that may already be struggling.`)
  return out
}
