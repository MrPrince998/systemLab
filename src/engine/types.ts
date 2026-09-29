export type Kind = 'client' | 'server' | 'load-balancer' | 'cache' | 'database' | 'replica' | 'queue'
export type Health = 'healthy' | 'failed'
export type NodeConfig = Record<string, number | boolean>

export interface ArchNode {
  id: string
  kind: Kind
  state: Health
  config: NodeConfig
}

export interface ArchEdge {
  id: string
  source: string
  target: string
  latency: number
}

export interface Architecture {
  nodes: ArchNode[]
  edges: ArchEdge[]
}

export type EventType =
  | 'REQUEST_CREATED'
  | 'REQUEST_ROUTED'
  | 'HEALTH_CHECK'
  | 'CACHE_LOOKUP'
  | 'CACHE_HIT'
  | 'CACHE_MISS'
  | 'CACHE_STORE'
  | 'CACHE_INVALIDATE'
  | 'CACHE_UNAVAILABLE'
  | 'DATABASE_QUERY'
  | 'DATABASE_WRITE'
  | 'REPLICA_READ'
  | 'REPLICATION'
  | 'STALE_READ'
  | 'MESSAGE_ENQUEUED'
  | 'MESSAGE_CONSUMED'
  | 'QUEUE_FULL'
  | 'RETRY'
  | 'CIRCUIT_OPENED'
  | 'FAST_FAIL'
  | 'OVERLOADED'
  | 'TIMEOUT'
  | 'RESPONSE_RETURNED'
  | 'REQUEST_FAILED'
  | 'REQUEST_SUCCEEDED'

export interface SimEvent {
  type: EventType
  timestamp: number
  requestId: number
  nodeId?: string
  from?: string
  to?: string
  detail: string
}

export interface RunOptions {
  /** Requests fired during one virtual second. */
  requests: number
  /** Number of distinct keys clients ask for (small = cache friendly). */
  keyspace: number
  /** Failure Lab: extra milliseconds added to every network hop. */
  extraLatencyMs: number
  /** Failure Lab: drop every Nth request at the client (0 = off). */
  dropEveryN: number
  /** Fraction of requests that are writes (0–1). Defaults to 0: all reads. */
  writeRatio?: number
}

export interface Metrics {
  total: number
  succeeded: number
  failed: number
  successRate: number
  errorRate: number
  avgLatency: number
  p95Latency: number
  reads: number
  writes: number
  cacheHits: number
  cacheMisses: number
  cacheHitRate: number
  dbQueries: number
  dbWrites: number
  replicaReads: number
  staleReads: number
  retries: number
  fastFails: number
  /** Messages still waiting in queues after the run. */
  queueDepth: number
  messagesConsumed: number
  failuresByReason: Record<string, number>
  /** requests handled per node during the run */
  nodeLoad: Record<string, number>
  /** load / capacity, only for nodes that have a capacity */
  utilization: Record<string, number>
  /** messages waiting per queue after the run */
  backlog: Record<string, number>
}

export interface RunResult {
  events: SimEvent[]
  metrics: Metrics
}
