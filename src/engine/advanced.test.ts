import { describe, expect, it } from 'vitest'
import { defaultConfig } from './defaults'
import { Simulator } from './simulator'
import type { Architecture, Kind, NodeConfig, RunOptions } from './types'

const node = (id: string, kind: Kind, config: NodeConfig = {}) => ({ id, kind, state: 'healthy' as const, config: { ...defaultConfig[kind], ...config } })
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target, latency: 10 })
const opts = (o: Partial<RunOptions> = {}): RunOptions => ({ requests: 10, keyspace: 5, extraLatencyMs: 0, dropEveryN: 0, ...o })
const kill = (a: Architecture, id: string) => (a.nodes.find((n) => n.id === id)!.state = 'failed')

describe('writes and replicas', () => {
  const replicated = (): Architecture => ({
    nodes: [node('c', 'client'), node('s', 'server', { capacity: 100 }), node('db', 'database'), node('r1', 'replica'), node('r2', 'replica')],
    edges: [edge('c', 's'), edge('s', 'db'), edge('s', 'r1'), edge('s', 'r2'), edge('db', 'r1'), edge('db', 'r2')],
  })

  it('spreads reads across primary and replicas, sends writes to the primary', () => {
    const { metrics } = new Simulator().run(replicated(), opts({ requests: 30, writeRatio: 0.2 }))
    expect(metrics.writes).toBe(6)
    expect(metrics.dbWrites).toBe(6)
    expect(metrics.replicaReads).toBe(16)
    expect(metrics.dbQueries).toBe(8)
    expect(metrics.succeeded).toBe(30)
  })

  it('keeps serving reads from replicas when the primary dies', () => {
    const a = replicated()
    kill(a, 'db')
    a.nodes.find((n) => n.id === 's')!.config.timeoutMs = 100
    const { metrics } = new Simulator().run(a, opts({ requests: 30 }))
    expect(metrics.replicaReads).toBeGreaterThan(0)
    expect(metrics.succeeded).toBe(metrics.replicaReads)
  })

  it('reports stale reads while replication lags behind a write', () => {
    const a = replicated()
    a.nodes.filter((n) => n.kind === 'replica').forEach((n) => (n.config.lagMs = 5000))
    const { metrics } = new Simulator().run(a, opts({ requests: 20, keyspace: 1, writeRatio: 0.1 }))
    expect(metrics.staleReads).toBeGreaterThan(0)
  })

  it('refuses writes sent to a lone replica, and reads from a replica with no primary', () => {
    const a: Architecture = { nodes: [node('c', 'client'), node('s', 'server'), node('r', 'replica')], edges: [edge('c', 's'), edge('s', 'r')] }
    const { metrics } = new Simulator().run(a, opts({ requests: 4, writeRatio: 0.5 }))
    expect(metrics.succeeded).toBe(0)
    expect(metrics.failuresByReason['replica has no primary']).toBe(2)
    expect(metrics.failuresByReason['write sent to replica']).toBe(2)
  })

  it('a write through a cache invalidates the cached key', () => {
    const a: Architecture = {
      nodes: [node('c', 'client'), node('s', 'server'), node('k', 'cache'), node('db', 'database')],
      edges: [edge('c', 's'), edge('s', 'k'), edge('k', 'db')],
    }
    const { events } = new Simulator().run(a, opts({ requests: 4, keyspace: 1, writeRatio: 0.5 }))
    const types = events.filter((e) => e.nodeId === 'k').map((e) => e.type)
    expect(types).toContain('CACHE_INVALIDATE')
    expect(types.filter((t) => t === 'CACHE_HIT')).toHaveLength(0)
  })
})

describe('message queue', () => {
  const queued = (workers: number, cap = 10): Architecture => ({
    nodes: [
      node('c', 'client'),
      node('s', 'server', { capacity: 200 }),
      node('q', 'queue', { maxDepth: 50 }),
      ...Array.from({ length: workers }, (_, i) => node(`w${i}`, 'server', { capacity: cap })),
      node('db', 'database', { capacity: 200 }),
    ],
    edges: [edge('c', 's'), edge('s', 'q'), ...Array.from({ length: workers }, (_, i) => [edge('q', `w${i}`), edge(`w${i}`, 'db')]).flat()],
  })

  it('acknowledges writes fast and lets workers drain them', () => {
    const { metrics } = new Simulator().run(queued(2), opts({ requests: 15, writeRatio: 1 }))
    expect(metrics.succeeded).toBe(15)
    expect(metrics.avgLatency).toBeLessThan(60)
    expect(metrics.messagesConsumed).toBe(15)
    expect(metrics.queueDepth).toBe(0)
    expect(metrics.dbWrites).toBe(15)
  })

  it('builds a backlog when workers are too slow, and drains it next second', () => {
    const sim = new Simulator()
    const first = sim.run(queued(1), opts({ requests: 30, writeRatio: 1 }))
    expect(first.metrics.messagesConsumed).toBe(10)
    expect(first.metrics.queueDepth).toBe(20)
    const second = sim.run(queued(1), opts({ requests: 0, writeRatio: 1 }))
    expect(second.metrics.queueDepth).toBe(10)
  })

  it('rejects work once the queue is full', () => {
    const { metrics } = new Simulator().run(queued(0), opts({ requests: 60, writeRatio: 1 }))
    expect(metrics.failuresByReason['queue full']).toBe(10)
  })

  it('keeps messages when workers are down', () => {
    const a = queued(1)
    kill(a, 'w0')
    const { metrics } = new Simulator().run(a, opts({ requests: 5, writeRatio: 1 }))
    expect(metrics.succeeded).toBe(5)
    expect(metrics.queueDepth).toBe(5)
  })
})

describe('retries, timeouts and circuit breakers', () => {
  const withDb = (config: NodeConfig): Architecture => ({
    nodes: [node('c', 'client'), node('s', 'server', { capacity: 200, ...config }), node('db', 'database', { capacity: 200 })],
    edges: [edge('c', 's'), edge('s', 'db')],
  })

  it('retries multiply the time spent waiting on a dead dependency', () => {
    const plain = withDb({})
    kill(plain, 'db')
    const retrying = withDb({ retries: 2 })
    kill(retrying, 'db')
    const a = new Simulator().run(plain, opts())
    const b = new Simulator().run(retrying, opts())
    expect(b.metrics.retries).toBe(20)
    expect(b.metrics.avgLatency).toBeGreaterThan(a.metrics.avgLatency * 2)
  })

  it('a retry storm overloads a struggling dependency further', () => {
    const calm = withDb({})
    const storm = withDb({ retries: 3 })
    calm.nodes[2].config.capacity = 10
    storm.nodes[2].config.capacity = 10
    const a = new Simulator().run(calm, opts({ requests: 20 }))
    const b = new Simulator().run(storm, opts({ requests: 20 }))
    expect(b.metrics.nodeLoad.db).toBeGreaterThan(a.metrics.nodeLoad.db)
  })

  it('a short timeout fails faster than the default', () => {
    const a = withDb({})
    kill(a, 'db')
    const b = withDb({ timeoutMs: 100 })
    kill(b, 'db')
    expect(new Simulator().run(b, opts()).metrics.avgLatency).toBeLessThan(new Simulator().run(a, opts()).metrics.avgLatency / 5)
  })

  it('a circuit breaker opens after repeated failures and fails fast', () => {
    const a = withDb({ circuitBreaker: true })
    kill(a, 'db')
    const { metrics, events } = new Simulator().run(a, opts({ requests: 20 }))
    expect(events.some((e) => e.type === 'CIRCUIT_OPENED')).toBe(true)
    expect(metrics.fastFails).toBe(15)
    expect(metrics.nodeLoad.db).toBe(0)
  })

  it('stops routing loops', () => {
    const a: Architecture = { nodes: [node('c', 'client'), node('s1', 'server', { capacity: 999 }), node('s2', 'server', { capacity: 999 })], edges: [edge('c', 's1'), edge('s1', 's2'), edge('s2', 's1')] }
    const { metrics } = new Simulator().run(a, opts({ requests: 1 }))
    expect(metrics.failuresByReason['routing loop']).toBe(1)
  })
})
