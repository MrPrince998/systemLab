import { describe, expect, it } from 'vitest'
import { defaultConfig } from './defaults'
import { reviewArchitecture } from './review'
import type { Architecture, Kind } from './types'

const node = (id: string, kind: Kind, config = {}) => ({ id, kind, state: 'healthy' as const, config: { ...defaultConfig[kind], ...config } })
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target, latency: 10 })
const titles = (a: Architecture) => reviewArchitecture(a).map((i) => i.title)

describe('architecture review', () => {
  it('flags a single server as a single point of failure', () => {
    const arch = { nodes: [node('c', 'client'), node('s', 'server'), node('d', 'database')], edges: [edge('c', 's'), edge('s', 'd')] }
    const spof = reviewArchitecture(arch).find((i) => i.title.includes('one server'))
    expect(spof?.tone).toBe('warn')
    expect(spof?.kill).toBe('s')
  })

  it('warns when health checks are off and praises them when on', () => {
    const arch: Architecture = {
      nodes: [node('c', 'client'), node('lb', 'load-balancer', { healthChecks: false }), node('s1', 'server'), node('s2', 'server')],
      edges: [edge('c', 'lb'), edge('lb', 's1'), edge('lb', 's2')],
    }
    expect(titles(arch)).toContain('lb has health checks off')
    arch.nodes[1].config.healthChecks = true
    expect(titles(arch)).toContain('Horizontal scaling with failover')
  })

  it('finds nodes no client can reach', () => {
    const arch = { nodes: [node('c', 'client'), node('s', 'server'), node('d', 'database')], edges: [edge('c', 's')] }
    expect(titles(arch)).toContain('d gets no traffic')
  })

  it('lists warnings before praise', () => {
    const arch = { nodes: [node('c', 'client'), node('s', 'server'), node('k', 'cache'), node('d', 'database')], edges: [edge('c', 's'), edge('s', 'k'), edge('k', 'd')] }
    const tones = reviewArchitecture(arch).map((i) => i.tone)
    expect(tones.indexOf('warn')).toBeLessThan(tones.indexOf('good'))
  })
})
