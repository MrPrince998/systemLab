import type { Kind, NodeConfig } from './types'

export const defaultConfig: Record<Kind, NodeConfig> = {
  client: {},
  server: { capacity: 20, processingMs: 15, retries: 0, timeoutMs: 1000, circuitBreaker: false },
  'load-balancer': { healthChecks: true, processingMs: 2 },
  cache: { ttlMs: 3000, processingMs: 2 },
  database: { capacity: 25, queryMs: 40 },
  replica: { capacity: 25, queryMs: 40, lagMs: 200 },
  queue: { maxDepth: 100, processingMs: 2 },
}

export const DEFAULT_EDGE_LATENCY = 10
export const TIMEOUT_MS = 1000
/** Consecutive failures before a circuit breaker opens. */
export const CIRCUIT_THRESHOLD = 5
/** How long an open circuit fails fast before letting a probe through. */
export const CIRCUIT_COOLDOWN_MS = 1000
export const RETRY_BACKOFF_MS = 20
/** Guards against routing loops a student can draw (server → server → server …). */
export const MAX_HOPS = 16
