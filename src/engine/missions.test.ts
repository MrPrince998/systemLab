import { describe, expect, it } from 'vitest'
import { buildGraph, challenges, type Solution } from '../data/challenges'
import { evaluateChallenge } from './validation'

/** A design that looks reasonable but misses the mission's point. */
const naive: Record<string, Solution> = {
  b1: { nodes: [], edges: '' },
  b2: { nodes: [['c', 'client'], ['s', 'server']], edges: 'c>s' },
  i1: { nodes: [['c', 'client'], ['s', 'server'], ['db', 'database']], edges: 'c>s s>db' },
  i2: { nodes: [['c', 'client'], ['s', 'server'], ['db', 'database']], edges: 'c>s s>db' },
  i3: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ['s1', 'server'], ['s2', 'server'], ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 s1>db s2>db' },
  i4: { nodes: [['c', 'client'], ['s', 'server'], ['cache', 'cache'], ['db', 'database']], edges: 'c>s s>cache cache>db' },
  a1: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ['s1', 'server'], ['s2', 'server'], ['s3', 'server'], ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 lb>s3 s1>db s2>db s3>db' },
  a2: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...[1, 2, 3, 4, 5].map((i) => [`s${i}`, 'server'] as [string, 'server']), ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 lb>s3 lb>s4 lb>s5 s1>db s2>db s3>db s4>db s5>db' },
  a3: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...[1, 2, 3, 4].map((i) => [`s${i}`, 'server'] as [string, 'server']), ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 lb>s3 lb>s4 s1>db s2>db s3>db s4>db' },
  a4: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ['s1', 'server'], ['s2', 'server'], ['s3', 'server'], ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 lb>s3 s1>db s2>db s3>db' },
  a5: { nodes: [['c', 'client'], ['s', 'server'], ['db', 'database']], edges: 'c>s s>db' },
  s1: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...[1, 2, 3, 4, 5].map((i) => [`s${i}`, 'server'] as [string, 'server']), ['cache', 'cache'], ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 lb>s3 lb>s4 lb>s5 s1>cache s2>cache s3>cache s4>cache s5>cache cache>db' },
  s2: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...[1, 2, 3, 4, 5, 6].map((i) => [`s${i}`, 'server'] as [string, 'server']), ['cache', 'cache'], ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 lb>s3 lb>s4 lb>s5 lb>s6 s1>cache s2>cache s3>cache s4>cache s5>cache s6>cache cache>db' },
  s3: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...[1, 2, 3, 4, 5].map((i) => [`s${i}`, 'server'] as [string, 'server']), ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 lb>s3 lb>s4 lb>s5 s1>db s2>db s3>db s4>db s5>db' },
  s4: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...[1, 2, 3, 4, 5].map((i) => [`s${i}`, 'server'] as [string, 'server']), ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 lb>s3 lb>s4 lb>s5 s1>db s2>db s3>db s4>db s5>db' },
  s5: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...[1, 2, 3, 4].map((i) => [`s${i}`, 'server'] as [string, 'server']), ['cache', 'cache'], ['db', 'database']], edges: 'c>lb lb>s1 lb>s2 lb>s3 lb>s4 s1>cache s2>cache s3>cache s4>cache cache>db' },
}

describe('missions', () => {
  it('has a naive design for every mission', () => {
    expect(Object.keys(naive).sort()).toEqual(challenges.map((c) => c.id).sort())
  })

  for (const c of challenges) {
    it(`${c.id} (${c.title}): the sample solution passes and the naive design fails`, () => {
      const good = evaluateChallenge(buildGraph(c, c.solution), c)
      expect(good.results.filter((r) => !r.passed).map((r) => `${r.label}: got ${r.actual}`)).toEqual([])
      expect(evaluateChallenge(buildGraph(c, naive[c.id]), c).passed).toBe(false)
    })
  }
})
