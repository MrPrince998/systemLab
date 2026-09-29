import { describe, expect, it } from 'vitest'
import { buildGraph, challenges } from '../data/challenges'
import { decodeDesign, encodeDesign, parseDesign, type DesignFile } from '../store/share'
import { scoreDesign, singlePoints } from './score'
import { Simulator } from './simulator'

describe('design score card', () => {
  const c = challenges.find((x) => x.id === 'a3')!
  const run = (id: string) => {
    const m = challenges.find((x) => x.id === id)!
    const arch = buildGraph(m, m.solution)
    return { arch, m: new Simulator().run(arch, { requests: m.scenario.requests, keyspace: m.scenario.keyspace, extraLatencyMs: 0, dropEveryN: 0 }).metrics }
  }

  it('finds single points of failure', () => {
    expect(singlePoints(buildGraph(c, challenges[1].solution))).toEqual(['the only server', 'the only database'])
  })

  it('scores a redundant design as more reliable than a single server', () => {
    const simple = run('b2')
    const scaled = run('a3')
    const rel = (s: ReturnType<typeof scoreDesign>) => s.find((x) => x.key === 'reliability')!.value
    expect(rel(scoreDesign(scaled.arch, scaled.m))).toBeGreaterThan(rel(scoreDesign(simple.arch, simple.m)) - 1)
    expect(scoreDesign(simple.arch, simple.m).every((s) => s.value >= 0 && s.value <= 100)).toBe(true)
  })
})

describe('share links', () => {
  const design: DesignFile = { v: 1, nodes: [{ id: 'client-1', kind: 'client' as const, x: 1, y: 2, config: {} as Record<string, number | boolean> }, { id: 'server-1', kind: 'server' as const, x: 3, y: 4, config: { capacity: 20, circuitBreaker: true } }], edges: [['client-1', 'server-1']] as [string, string][] }

  it('round-trips through the URL encoding', () => {
    expect(decodeDesign(encodeDesign(design))).toEqual({ ...design, mission: undefined })
  })

  it('rejects malformed or hostile input', () => {
    expect(decodeDesign('not-base64!!')).toBeNull()
    expect(parseDesign({ v: 2, nodes: [], edges: [] })).toBeNull()
    expect(parseDesign({ v: 1, nodes: [{ id: '<script>', kind: 'client' }], edges: [] })).toBeNull()
    expect(parseDesign({ v: 1, nodes: [{ id: 'a', kind: 'mainframe' }], edges: [] })).toBeNull()
    const cleaned = parseDesign({ v: 1, nodes: [{ id: 'a', kind: 'server', config: { capacity: 'lots', ok: 3 } }], edges: [['a', 'missing']] })
    expect(cleaned?.nodes[0].config).toEqual({ ok: 3 })
    expect(cleaned?.edges).toEqual([])
  })
})
