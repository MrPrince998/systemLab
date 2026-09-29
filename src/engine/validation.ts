import type { Challenge, MetricKey } from '../data/challenges'
import { technologies } from '../data/technologies'
import { Simulator } from './simulator'
import type { ArchNode, Architecture, Metrics } from './types'

export interface ObjectiveResult {
  label: string
  actual: number
  target: string
  passed: boolean
}

export const infraCost = (arch: Architecture) => arch.nodes.reduce((sum, n) => sum + technologies[n.kind].cost, 0)

export function metricValue(key: MetricKey, m: Metrics, arch: Architecture): number {
  if (key === 'cost') return infraCost(arch)
  if (key === 'maxDbUtilization') {
    const dbs = arch.nodes.filter((n) => n.kind === 'database' || n.kind === 'replica')
    return Math.max(0, ...dbs.map((d) => m.utilization[d.id] ?? 0))
  }
  return m[key]
}

/** Runs the challenge scenario on a fresh simulator, crashing the components it lists. */
export function evaluateChallenge(arch: Architecture, c: Challenge) {
  const nodes: ArchNode[] = arch.nodes.map((n) => ({ ...n, state: 'healthy' }))
  for (const kind of c.scenario.kill ?? []) {
    const victim = nodes.find((n) => n.kind === kind && n.state === 'healthy')
    if (victim) victim.state = 'failed'
  }
  const scenarioArch = { ...arch, nodes }
  const { metrics } = new Simulator().run(scenarioArch, {
    requests: c.scenario.requests,
    keyspace: c.scenario.keyspace,
    writeRatio: c.scenario.writeRatio ?? 0,
    extraLatencyMs: 0,
    dropEveryN: 0,
  })
  const results: ObjectiveResult[] = c.objectives.map((o) => {
    const actual = metricValue(o.metric, metrics, scenarioArch)
    const passed = o.op === '>=' ? actual >= o.value : actual <= o.value
    return { label: o.label, actual, target: `${o.op} ${o.value}`, passed }
  })
  return { results, passed: results.every((r) => r.passed), metrics }
}
