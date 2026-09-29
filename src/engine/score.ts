import type { Architecture, Metrics } from './types'
import { infraCost } from './validation'

export interface Score {
  key: 'performance' | 'reliability' | 'scalability' | 'cost'
  label: string
  value: number
  why: string
}

const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)))
const scale = (v: number, best: number, worst: number) => clamp(((v - worst) / (best - worst)) * 100)

/** Single components whose failure takes a whole tier down. */
export function singlePoints(arch: Architecture): string[] {
  const count = (k: string) => arch.nodes.filter((n) => n.kind === k).length
  const out: string[] = []
  if (count('server') === 1) out.push('the only server')
  if (count('load-balancer') === 1) out.push('the only load balancer')
  if (count('database') === 1 && count('replica') === 0) out.push('the only database')
  return out
}

/**
 * Independent trade-off scores for a design and its last run. They are never
 * combined into one number: improving one usually costs another.
 */
export function scoreDesign(arch: Architecture, m: Metrics): Score[] {
  const spofs = singlePoints(arch)
  const peak = Math.max(0, ...Object.values(m.utilization))
  const cost = infraCost(arch)
  const perUnit = cost ? m.succeeded / cost : 0
  return [
    {
      key: 'performance',
      label: 'Performance',
      value: scale(m.avgLatency, 40, 500),
      why: `Average latency ${Math.round(m.avgLatency)}ms (40ms or less is excellent, 500ms or more is unusable).`,
    },
    {
      key: 'reliability',
      label: 'Reliability',
      value: clamp(m.successRate * 100 - spofs.length * 12),
      why: `${Math.round(m.successRate * 100)}% of requests succeeded${spofs.length ? `, but ${spofs.join(', ')} ${spofs.length === 1 ? 'is a single point' : 'are single points'} of failure` : ', and no tier depends on a single component'}.`,
    },
    {
      key: 'scalability',
      label: 'Scalability',
      value: scale(peak, 0.5, 1.2),
      why: peak ? `Busiest component ran at ${Math.round(peak * 100)}% of capacity. Headroom means you can absorb growth.` : 'No component has a capacity limit in this run.',
    },
    {
      key: 'cost',
      label: 'Cost efficiency',
      value: scale(perUnit, 15, 2),
      why: `Infrastructure cost ${cost}, serving ${perUnit.toFixed(1)} successful requests per cost unit.`,
    },
  ]
}

export const grade = (v: number) => (v >= 75 ? 'High' : v >= 45 ? 'Medium' : 'Low')
