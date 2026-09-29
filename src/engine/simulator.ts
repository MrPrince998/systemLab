import {
  CIRCUIT_COOLDOWN_MS,
  CIRCUIT_THRESHOLD,
  DEFAULT_EDGE_LATENCY,
  MAX_HOPS,
  RETRY_BACKOFF_MS,
  TIMEOUT_MS,
} from './defaults'
import type {
  ArchEdge,
  ArchNode,
  Architecture,
  EventType,
  Kind,
  Metrics,
  RunOptions,
  RunResult,
  SimEvent,
} from './types'

interface Outcome {
  ok: boolean
  dur: number
  reason?: string
}

interface Ctx {
  nodes: Map<string, ArchNode>
  out: Map<string, ArchEdge[]>
  /** replica id → primary databases replicating into it */
  primaries: Map<string, string[]>
  events: SimEvent[]
  load: Map<string, number>
  opts: RunOptions
  reqId: number
  key: string
  write: boolean
}

interface CacheEntry {
  expires: number
  storedAt: number
}

interface Message {
  reqId: number
  key: string
  write: boolean
}

const num = (n: ArchNode, k: string, fallback: number) => {
  const v = n.config[k]
  return typeof v === 'number' ? v : fallback
}

const capacityOf = (n: ArchNode) => (typeof n.config.capacity === 'number' ? n.config.capacity : Infinity)

/** Spreads writes evenly through the run: ratio 0.2 makes every 5th request a write. */
const isWrite = (i: number, ratio: number) => Math.floor((i + 1) * ratio) > Math.floor(i * ratio)

/**
 * Deterministic, UI-independent simulator.
 *
 * One `run` = one virtual second of traffic. `capacity` on servers, databases
 * and replicas is "requests per virtual second", so pushing more than that in a
 * single run overloads them. Caches, queue backlogs, write history, circuit
 * breakers and the virtual clock persist between runs, like a live system.
 */
export class Simulator {
  private clock = 0
  private caches = new Map<string, Map<string, CacheEntry>>()
  private rr = new Map<string, number>()
  private lastWrite = new Map<string, number>()
  private backlog = new Map<string, Message[]>()
  private circuits = new Map<string, { fails: number; openUntil: number }>()

  reset() {
    this.clock = 0
    this.caches.clear()
    this.rr.clear()
    this.lastWrite.clear()
    this.backlog.clear()
    this.circuits.clear()
  }

  run(arch: Architecture, opts: RunOptions): RunResult {
    const nodes = new Map(arch.nodes.map((n) => [n.id, n]))
    const out = new Map<string, ArchEdge[]>()
    const primaries = new Map<string, string[]>()
    for (const e of arch.edges) {
      if (!nodes.has(e.source) || !nodes.has(e.target)) continue
      out.set(e.source, [...(out.get(e.source) ?? []), e])
      if (nodes.get(e.source)!.kind === 'database' && nodes.get(e.target)!.kind === 'replica') {
        primaries.set(e.target, [...(primaries.get(e.target) ?? []), e.source])
      }
    }

    const events: SimEvent[] = []
    const load = new Map<string, number>()
    const latencies: number[] = []
    const reasons: Record<string, number> = {}
    const writeRatio = Math.min(1, Math.max(0, opts.writeRatio ?? 0))
    let succeeded = 0
    let writes = 0

    const start = this.clock
    const clients = arch.nodes.filter((n) => n.kind === 'client')
    const spacing = 1000 / Math.max(1, opts.requests)
    const base = { nodes, out, primaries, events, load, opts }

    // Load balancers with health checks probe their backends once per run.
    for (const n of arch.nodes) {
      if (n.kind !== 'load-balancer' || n.config.healthChecks !== true) continue
      for (const e of out.get(n.id) ?? []) {
        const target = nodes.get(e.target)
        events.push({
          type: 'HEALTH_CHECK',
          timestamp: start,
          requestId: 0,
          nodeId: n.id,
          from: n.id,
          to: e.target,
          detail: `${n.id} probes ${e.target}: ${target?.state === 'failed' ? 'DOWN' : 'UP'}`,
        })
      }
    }

    for (let i = 0; i < opts.requests; i++) {
      const reqId = i + 1
      const t0 = start + i * spacing
      const client = clients[i % Math.max(1, clients.length)]
      const key = `key-${i % Math.max(1, opts.keyspace)}`
      const write = isWrite(i, writeRatio)
      if (write) writes++
      const ctx: Ctx = { ...base, reqId, key, write }
      const emit = (type: EventType, t: number, detail: string, extra: Partial<SimEvent> = {}) =>
        events.push({ type, timestamp: t, requestId: reqId, detail, ...extra })
      const fail = (reason: string) => (reasons[reason] = (reasons[reason] ?? 0) + 1)

      if (!client) {
        emit('REQUEST_FAILED', t0, 'No client on the canvas to send requests')
        fail('no client')
        latencies.push(0)
        continue
      }

      emit('REQUEST_CREATED', t0, `${client.id} ${write ? 'writes' : 'reads'} ${key}`, { nodeId: client.id })

      let outcome: Outcome
      if (opts.dropEveryN > 0 && reqId % opts.dropEveryN === 0) {
        emit('REQUEST_FAILED', t0, 'Request dropped by the network', { nodeId: client.id })
        outcome = { ok: false, dur: 0, reason: 'dropped' }
      } else {
        const edges = out.get(client.id) ?? []
        const edge = edges[this.next(client.id, edges.length)]
        if (!edge) {
          emit('REQUEST_FAILED', t0, `${client.id} is not connected to anything`, { nodeId: client.id })
          outcome = { ok: false, dur: 0, reason: 'client not connected' }
        } else {
          outcome = this.hop(client.id, edge, ctx, t0, TIMEOUT_MS, 0)
          if (outcome.ok) {
            emit('REQUEST_SUCCEEDED', t0 + outcome.dur, `Response received in ${Math.round(outcome.dur)}ms`, { nodeId: client.id })
          } else {
            emit('REQUEST_FAILED', t0 + outcome.dur, `Request failed: ${outcome.reason}`, { nodeId: client.id })
          }
        }
      }

      latencies.push(outcome.dur)
      if (outcome.ok) succeeded++
      else fail(outcome.reason ?? 'unknown')
    }

    // Workers pull queued messages with whatever capacity they have left this second.
    let consumed = 0
    for (const q of arch.nodes) if (q.kind === 'queue') consumed += this.drain(q, base, start)

    this.clock = start + 1000
    events.sort((a, b) => a.timestamp - b.timestamp || a.requestId - b.requestId)

    const count = (type: EventType) => events.filter((e) => e.type === type).length
    const hits = count('CACHE_HIT')
    const misses = count('CACHE_MISS')
    const sorted = [...latencies].sort((a, b) => a - b)
    const total = opts.requests
    const nodeLoad: Record<string, number> = {}
    const utilization: Record<string, number> = {}
    const backlog: Record<string, number> = {}
    for (const n of arch.nodes) {
      const l = load.get(n.id) ?? 0
      nodeLoad[n.id] = l
      if (typeof n.config.capacity === 'number') utilization[n.id] = l / n.config.capacity
      if (n.kind === 'queue') backlog[n.id] = this.backlog.get(n.id)?.length ?? 0
    }

    const metrics: Metrics = {
      total,
      succeeded,
      failed: total - succeeded,
      successRate: total ? succeeded / total : 0,
      errorRate: total ? (total - succeeded) / total : 0,
      avgLatency: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p95Latency: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
      reads: total - writes,
      writes,
      cacheHits: hits,
      cacheMisses: misses,
      cacheHitRate: hits + misses ? hits / (hits + misses) : 0,
      dbQueries: count('DATABASE_QUERY'),
      dbWrites: count('DATABASE_WRITE'),
      replicaReads: count('REPLICA_READ'),
      staleReads: count('STALE_READ'),
      retries: count('RETRY'),
      fastFails: count('FAST_FAIL'),
      queueDepth: Object.values(backlog).reduce((a, b) => a + b, 0),
      messagesConsumed: consumed,
      failuresByReason: reasons,
      nodeLoad,
      utilization,
      backlog,
    }
    return { events, metrics }
  }

  /** Round-robin index for a named rotation. */
  private next(key: string, size: number) {
    const i = this.rr.get(key) ?? 0
    this.rr.set(key, i + 1)
    return size ? i % size : 0
  }

  /**
   * Chooses where a server or cache sends a request. Writes prefer a queue
   * (async), then a cache (write-through), then the primary database. Reads
   * prefer a cache, then spread across the database and its replicas.
   */
  private pick(id: string, ctx: Ctx): ArchEdge | undefined {
    const edges = ctx.out.get(id) ?? []
    if (!edges.length) return undefined
    const of = (...kinds: Kind[]) => edges.filter((e) => kinds.includes(ctx.nodes.get(e.target)!.kind))
    const tiers = ctx.write
      ? [of('queue'), of('cache'), of('database'), of('server', 'load-balancer')]
      : [of('cache'), of('database', 'replica'), of('server', 'load-balancer'), of('queue')]
    const pool = tiers.find((t) => t.length) ?? edges
    return pool[this.next(`${id}:${ctx.write ? 'w' : 'r'}`, pool.length)]
  }

  /** Sends a request over `edge`; returns the round trip as seen by the caller. */
  private hop(from: string, edge: ArchEdge, ctx: Ctx, t: number, timeout: number, depth: number): Outcome {
    const lat = (edge.latency ?? DEFAULT_EDGE_LATENCY) + ctx.opts.extraLatencyMs
    const push = (type: EventType, at: number, detail: string, extra: Partial<SimEvent> = {}) =>
      ctx.events.push({ type, timestamp: at, requestId: ctx.reqId, detail, ...extra })

    push('REQUEST_ROUTED', t, `${from} → ${edge.target}`, { from, to: edge.target })
    const r = this.visit(edge.target, ctx, t + lat, timeout, depth + 1)
    if (!r.ok) return { ok: false, dur: lat + r.dur, reason: r.reason }
    const total = lat + r.dur + lat
    if (total > timeout) {
      // The caller stops waiting even though the callee did the work.
      push('TIMEOUT', t + timeout, `${from} gave up waiting for ${edge.target} after ${timeout}ms`, { nodeId: from })
      return { ok: false, dur: timeout, reason: 'timeout' }
    }
    push('RESPONSE_RETURNED', t + total, `${edge.target} → ${from}`, { from: edge.target, to: from })
    return { ok: true, dur: total }
  }

  private visit(id: string, ctx: Ctx, t: number, timeout: number, depth: number): Outcome {
    const node = ctx.nodes.get(id)!
    const emit = (type: EventType, at: number, detail: string) =>
      ctx.events.push({ type, timestamp: at, requestId: ctx.reqId, nodeId: id, detail })

    if (depth > MAX_HOPS) {
      emit('REQUEST_FAILED', t, 'Request went round in circles: check for a loop in your connections')
      return { ok: false, dur: 0, reason: 'routing loop' }
    }

    if (node.state === 'failed') {
      if (node.kind === 'cache') {
        // A dead cache is bypassed: fail fast and go straight to the origin.
        emit('CACHE_UNAVAILABLE', t, `${id} is down: bypassing cache`)
        const edge = this.pick(id, ctx)
        if (!edge) return { ok: false, dur: 20, reason: 'cache down, no origin' }
        const next = this.hop(id, edge, ctx, t + 20, timeout, depth)
        return { ok: next.ok, dur: 20 + next.dur, reason: next.reason }
      }
      emit('TIMEOUT', t + timeout, `${id} (${node.kind}) did not respond`)
      return { ok: false, dur: timeout, reason: `${node.kind} down` }
    }

    const load = (ctx.load.get(id) ?? 0) + 1
    ctx.load.set(id, load)
    const capacity = capacityOf(node)
    if (load > capacity) {
      emit('OVERLOADED', t, `${id} is over capacity (${load}/${capacity}) and rejects the request`)
      return { ok: false, dur: 30, reason: `${node.kind} overloaded` }
    }

    switch (node.kind) {
      case 'server':
        return this.serve(node, ctx, t, depth, emit)

      case 'load-balancer': {
        const p = num(node, 'processingMs', 2)
        const edges = ctx.out.get(id) ?? []
        const usable =
          node.config.healthChecks === true ? edges.filter((e) => ctx.nodes.get(e.target)?.state !== 'failed') : edges
        if (!usable.length) {
          emit('REQUEST_FAILED', t, 'No healthy backend available')
          return { ok: false, dur: p, reason: 'no healthy backend' }
        }
        const r = this.hop(id, usable[this.next(id, usable.length)], ctx, t + p, timeout, depth)
        return { ok: r.ok, dur: p + r.dur, reason: r.reason }
      }

      case 'cache': {
        const p = num(node, 'processingMs', 2)
        const store = this.caches.get(id) ?? new Map<string, CacheEntry>()
        this.caches.set(id, store)
        const edge = this.pick(id, ctx)

        if (ctx.write) {
          store.delete(ctx.key)
          emit('CACHE_INVALIDATE', t, `${id} drops ${ctx.key} so nobody reads the old value`)
          if (!edge) return { ok: false, dur: p, reason: 'cache has no origin' }
          const r = this.hop(id, edge, ctx, t + p, timeout, depth)
          return { ok: r.ok, dur: p + r.dur, reason: r.reason }
        }

        emit('CACHE_LOOKUP', t, `${id} looks up ${ctx.key}`)
        const entry = store.get(ctx.key)
        if (entry && entry.expires > t) {
          const w = this.lastWrite.get(ctx.key)
          if (w !== undefined && w > entry.storedAt) emit('STALE_READ', t + p, `${id} served an old copy of ${ctx.key}: it changed after it was cached`)
          emit('CACHE_HIT', t + p, `HIT ${ctx.key}: origin not contacted`)
          return { ok: true, dur: p }
        }
        emit('CACHE_MISS', t + p, entry ? `MISS ${ctx.key} (entry expired)` : `MISS ${ctx.key}`)
        if (!edge) return { ok: false, dur: p, reason: 'cache has no origin' }
        const r = this.hop(id, edge, ctx, t + p, timeout, depth)
        if (!r.ok) return { ok: false, dur: p + r.dur, reason: r.reason }
        const at = t + p + r.dur
        store.set(ctx.key, { expires: at + num(node, 'ttlMs', 3000), storedAt: at })
        emit('CACHE_STORE', at, `${id} stores ${ctx.key}`)
        return { ok: true, dur: p + r.dur }
      }

      case 'database': {
        // Contention: the busier the database, the slower each query.
        const q = num(node, 'queryMs', 40) * (1 + load / capacity)
        if (ctx.write) {
          emit('DATABASE_WRITE', t, `${id} writes ${ctx.key} (${Math.round(q)}ms)`)
          this.lastWrite.set(ctx.key, t + q)
          for (const e of ctx.out.get(id) ?? []) {
            const replica = ctx.nodes.get(e.target)
            if (replica?.kind !== 'replica') continue
            const lag = num(replica, 'lagMs', 200)
            ctx.events.push({ type: 'REPLICATION', timestamp: t + q + lag, requestId: ctx.reqId, from: id, to: replica.id, detail: `${id} → ${replica.id}: ${ctx.key} copied after ${lag}ms lag` })
          }
          return { ok: true, dur: q }
        }
        emit('DATABASE_QUERY', t, `${id} runs query for ${ctx.key} (${Math.round(q)}ms)`)
        return { ok: true, dur: q }
      }

      case 'replica': {
        if (ctx.write) {
          emit('REQUEST_FAILED', t, `${id} is read-only: writes must go to the primary database`)
          return { ok: false, dur: 5, reason: 'write sent to replica' }
        }
        if (!ctx.primaries.get(id)?.length) {
          emit('REQUEST_FAILED', t, `${id} has no primary database replicating into it, so it has no data`)
          return { ok: false, dur: 5, reason: 'replica has no primary' }
        }
        const q = num(node, 'queryMs', 40) * (1 + load / capacity)
        emit('REPLICA_READ', t, `${id} serves ${ctx.key} (${Math.round(q)}ms)`)
        const w = this.lastWrite.get(ctx.key)
        const lag = num(node, 'lagMs', 200)
        if (w !== undefined && t < w + lag) emit('STALE_READ', t + q, `${id} hasn’t received the latest write to ${ctx.key} yet (replication lag)`)
        return { ok: true, dur: q }
      }

      case 'queue': {
        const p = num(node, 'processingMs', 2)
        const backlog = this.backlog.get(id) ?? []
        this.backlog.set(id, backlog)
        const max = num(node, 'maxDepth', 100)
        if (backlog.length >= max) {
          emit('QUEUE_FULL', t, `${id} is full (${max} messages) and rejects new work`)
          return { ok: false, dur: p, reason: 'queue full' }
        }
        backlog.push({ reqId: ctx.reqId, key: ctx.key, write: ctx.write })
        emit('MESSAGE_ENQUEUED', t, `${id} accepts ${ctx.key} (depth ${backlog.length}). The client is answered now; a worker does the job later`)
        return { ok: true, dur: p }
      }

      default:
        return { ok: true, dur: 0 }
    }
  }

  /** Server: business logic, then calls downstream with its timeout, retry and circuit-breaker policy. */
  private serve(node: ArchNode, ctx: Ctx, t: number, depth: number, emit: (type: EventType, at: number, detail: string) => void): Outcome {
    const p = num(node, 'processingMs', 15)
    if (!ctx.out.get(node.id)?.length) return { ok: true, dur: p }
    const retries = num(node, 'retries', 0)
    const timeout = num(node, 'timeoutMs', TIMEOUT_MS)
    const breaker = node.config.circuitBreaker === true
    let elapsed = p
    let reason = 'no route'

    for (let attempt = 0; attempt <= retries; attempt++) {
      const edge = this.pick(node.id, ctx)!
      const key = `${node.id}->${edge.target}`
      const circuit = this.circuits.get(key) ?? { fails: 0, openUntil: -Infinity }
      this.circuits.set(key, circuit)
      const now = t + elapsed

      if (breaker && circuit.openUntil > now) {
        emit('FAST_FAIL', now, `Circuit ${node.id} → ${edge.target} is open: failing fast instead of waiting`)
        return { ok: false, dur: elapsed + 1, reason: 'circuit open' }
      }

      const r = this.hop(node.id, edge, ctx, now, timeout, depth)
      elapsed += r.dur
      if (r.ok) {
        circuit.fails = 0
        return { ok: true, dur: elapsed }
      }
      reason = r.reason ?? 'unknown'
      circuit.fails++
      if (breaker && circuit.fails >= CIRCUIT_THRESHOLD) {
        circuit.openUntil = t + elapsed + CIRCUIT_COOLDOWN_MS
        emit('CIRCUIT_OPENED', t + elapsed, `${node.id} saw ${circuit.fails} failures from ${edge.target} in a row and opens the circuit`)
      }
      if (attempt < retries) {
        emit('RETRY', t + elapsed, `${node.id} retries (attempt ${attempt + 2} of ${retries + 1})`)
        elapsed += RETRY_BACKOFF_MS * (attempt + 1)
      }
    }
    return { ok: false, dur: elapsed, reason }
  }

  /** Hands queued messages to consumers with spare capacity; the rest wait for the next second. */
  private drain(q: ArchNode, base: Omit<Ctx, 'reqId' | 'key' | 'write'>, start: number): number {
    const waiting = this.backlog.get(q.id) ?? []
    if (!waiting.length || q.state === 'failed') return 0
    const consumers = base.out.get(q.id) ?? []
    const remaining: Message[] = []
    let consumed = 0

    waiting.forEach((m, k) => {
      const t = start + (1000 * (k + 1)) / (waiting.length + 1)
      let delivered = false
      for (let tries = 0; tries < consumers.length && !delivered; tries++) {
        const edge = consumers[this.next(q.id, consumers.length)]
        const c = base.nodes.get(edge.target)!
        if (c.state === 'failed' || (base.load.get(c.id) ?? 0) >= capacityOf(c)) continue
        const ctx: Ctx = { ...base, reqId: m.reqId, key: m.key, write: m.write }
        const r = this.hop(q.id, edge, ctx, t, TIMEOUT_MS, 0)
        if (!r.ok) break // processing failed: keep the message for a later retry
        base.events.push({ type: 'MESSAGE_CONSUMED', timestamp: t + r.dur, requestId: m.reqId, nodeId: q.id, detail: `${edge.target} finished the job for ${m.key}` })
        consumed++
        delivered = true
      }
      if (!delivered) remaining.push(m)
    })
    this.backlog.set(q.id, remaining)
    return consumed
  }
}
