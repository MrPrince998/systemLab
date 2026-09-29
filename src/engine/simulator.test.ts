import { describe, expect, it } from 'vitest'
import { defaultConfig } from './defaults'
import { Simulator } from './simulator'
import type { Architecture, Kind, RunOptions } from './types'

const node = (id: string, kind: Kind, config = {}) => ({
  id,
  kind,
  state: 'healthy' as const,
  config: { ...defaultConfig[kind], ...config },
})
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target, latency: 10 })
const opts = (o: Partial<RunOptions> = {}): RunOptions => ({
  requests: 1,
  keyspace: 1,
  extraLatencyMs: 0,
  dropEveryN: 0,
  ...o,
})

const webApp = (): Architecture => ({
  nodes: [node('c', 'client'), node('s', 'server'), node('d', 'database')],
  edges: [edge('c', 's'), edge('s', 'd')],
})

const cached = (): Architecture => ({
  nodes: [node('c', 'client'), node('s', 'server'), node('k', 'cache'), node('d', 'database')],
  edges: [edge('c', 's'), edge('s', 'k'), edge('k', 'd')],
})

const lb = (): Architecture => ({
  nodes: [
    node('c', 'client'),
    node('lb', 'load-balancer'),
    node('s1', 'server'),
    node('s2', 'server'),
    node('s3', 'server'),
  ],
  edges: [edge('c', 'lb'), edge('lb', 's1'), edge('lb', 's2'), edge('lb', 's3')],
})

describe('basic web app', () => {
  it('routes client → server → database and back', () => {
    const { events, metrics } = new Simulator().run(webApp(), opts())
    expect(metrics.succeeded).toBe(1)
    expect(metrics.dbQueries).toBe(1)
    expect(events.filter((e) => e.type === 'REQUEST_ROUTED').map((e) => e.detail)).toEqual(['c → s', 's → d'])
    expect(events.filter((e) => e.type === 'RESPONSE_RETURNED').map((e) => e.detail)).toEqual(['d → s', 's → c'])
  })

  it('is deterministic', () => {
    const a = new Simulator().run(webApp(), opts({ requests: 10 }))
    const b = new Simulator().run(webApp(), opts({ requests: 10 }))
    expect(a).toEqual(b)
  })
})

describe('cache', () => {
  it('misses then hits, and skips the database on a hit', () => {
    const sim = new Simulator()
    const first = sim.run(cached(), opts())
    expect(first.metrics.cacheMisses).toBe(1)
    expect(first.metrics.dbQueries).toBe(1)
    expect(first.events.some((e) => e.type === 'CACHE_STORE')).toBe(true)

    const second = sim.run(cached(), opts())
    expect(second.metrics.cacheHits).toBe(1)
    expect(second.metrics.dbQueries).toBe(0)
    expect(second.metrics.avgLatency).toBeLessThan(first.metrics.avgLatency)
  })

  it('expires entries after the TTL', () => {
    const arch = cached()
    arch.nodes.find((n) => n.id === 'k')!.config.ttlMs = 500
    const sim = new Simulator()
    sim.run(arch, opts())
    expect(sim.run(arch, opts()).metrics.cacheMisses).toBe(1)
  })

  it('bypasses a dead cache and hits the database', () => {
    const arch = cached()
    arch.nodes.find((n) => n.id === 'k')!.state = 'failed'
    const { metrics } = new Simulator().run(arch, opts({ requests: 5 }))
    expect(metrics.succeeded).toBe(5)
    expect(metrics.dbQueries).toBe(5)
  })
})

describe('load balancer', () => {
  it('round-robins across healthy servers', () => {
    const { metrics } = new Simulator().run(lb(), opts({ requests: 6 }))
    expect(metrics.nodeLoad).toMatchObject({ s1: 2, s2: 2, s3: 2 })
  })

  it('routes around a failed server when health checks are on', () => {
    const arch = lb()
    arch.nodes.find((n) => n.id === 's2')!.state = 'failed'
    const { metrics, events } = new Simulator().run(arch, opts({ requests: 6 }))
    expect(metrics.nodeLoad.s2).toBe(0)
    expect(metrics.succeeded).toBe(6)
    expect(events.some((e) => e.type === 'HEALTH_CHECK' && e.detail.includes('DOWN'))).toBe(true)
  })

  it('keeps sending traffic to a dead server without health checks', () => {
    const arch = lb()
    arch.nodes.find((n) => n.id === 'lb')!.config.healthChecks = false
    arch.nodes.find((n) => n.id === 's2')!.state = 'failed'
    const { metrics } = new Simulator().run(arch, opts({ requests: 6 }))
    expect(metrics.failed).toBe(2)
    expect(metrics.failuresByReason['server down']).toBe(2)
  })
})

describe('capacity and failure', () => {
  it('overloads a single server past its capacity', () => {
    const { metrics } = new Simulator().run(webApp(), opts({ requests: 30 }))
    expect(metrics.failed).toBe(10)
    expect(metrics.failuresByReason['server overloaded']).toBe(10)
  })

  it('fails requests instead of pretending success when the only database is down', () => {
    const arch = webApp()
    arch.nodes.find((n) => n.id === 'd')!.state = 'failed'
    const { metrics, events } = new Simulator().run(arch, opts())
    expect(metrics.succeeded).toBe(0)
    expect(events.some((e) => e.type === 'TIMEOUT')).toBe(true)
  })

  it('drops every Nth request and adds network latency', () => {
    const base = new Simulator().run(webApp(), opts({ requests: 10 }))
    const slow = new Simulator().run(webApp(), opts({ requests: 10, extraLatencyMs: 50, dropEveryN: 5 }))
    expect(slow.metrics.failuresByReason.dropped).toBe(2)
    expect(slow.metrics.avgLatency).toBeGreaterThan(base.metrics.avgLatency)
  })
})

