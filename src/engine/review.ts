import type { ArchNode, Architecture, Kind, Metrics } from './types'

export interface ReviewItem {
  tone: 'good' | 'warn' | 'info'
  title: string
  detail: string
  /** An experiment the student can run to test the claim themselves. */
  kill?: string
}

/**
 * Rule-based architecture review. It points at risks and asks the student to
 * predict and test, rather than handing over the fix.
 */
export function reviewArchitecture(arch: Architecture, last?: Metrics | null): ReviewItem[] {
  const { nodes, edges } = arch
  if (!nodes.length) {
    return [{ tone: 'info', title: 'Start with a client', detail: 'Every system begins with someone asking for something. Add a Client, then a Server.' }]
  }

  const items: ReviewItem[] = []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const outs = (id: string) =>
    edges.filter((e) => e.source === id).map((e) => byId.get(e.target)).filter((n): n is ArchNode => !!n)

  const clients = nodes.filter((n) => n.kind === 'client')
  if (!clients.length) items.push({ tone: 'warn', title: 'No client', detail: 'Nothing sends traffic into this system, so nothing can be simulated.' })
  for (const c of clients) {
    if (!outs(c.id).length) items.push({ tone: 'warn', title: `${c.id} isn’t connected`, detail: 'Drag from its right handle to the component it should call.' })
  }

  // Everything reachable from a client takes part in a simulation.
  const seen = new Set<string>()
  const stack = clients.map((c) => c.id)
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const n of outs(id)) stack.push(n.id)
  }
  const orphans = nodes.filter((n) => !seen.has(n.id))
  if (clients.length && orphans.length) {
    items.push({
      tone: 'warn',
      title: `${orphans.map((n) => n.id).join(', ')} ${orphans.length === 1 ? 'gets' : 'get'} no traffic`,
      detail: 'No path from a client reaches them, so they never take part in a simulation.',
    })
  }

  const reached = (k: Kind) => nodes.filter((n) => n.kind === k && seen.has(n.id))
  const servers = reached('server')
  const lbs = reached('load-balancer')
  const caches = reached('cache')
  const dbs = reached('database')

  if (servers.length === 1) {
    items.push({
      tone: 'warn',
      title: 'Single point of failure: one server',
      detail: `Predict what happens to users if ${servers[0].id} crashes, then test it.`,
      kill: servers[0].id,
    })
  }

  if (clients.some((c) => outs(c.id).filter((n) => n.kind === 'server').length > 1)) {
    items.push({
      tone: 'info',
      title: 'Clients are choosing servers themselves',
      detail: 'Real clients know one address. What could sit in front, hide how many servers you run and route around dead ones?',
    })
  }

  for (const lb of lbs) {
    const backs = outs(lb.id)
    if (backs.length >= 2 && lb.config.healthChecks === true) {
      items.push({
        tone: 'good',
        title: 'Horizontal scaling with failover',
        detail: `${lb.id} spreads traffic across ${backs.length} backends and skips unhealthy ones.`,
        kill: backs[0].id,
      })
    } else if (backs.length >= 2) {
      items.push({
        tone: 'warn',
        title: `${lb.id} has health checks off`,
        detail: 'How does a load balancer find out a server died? Predict how many requests fail if one crashes.',
        kill: backs[0].id,
      })
    } else if (backs.length === 1) {
      items.push({ tone: 'info', title: `${lb.id} has one backend`, detail: 'There is nothing to balance yet. What happens if you add more servers behind it?' })
    }
  }
  if (lbs.length === 1 && servers.length >= 2) {
    items.push({
      tone: 'info',
      title: 'The load balancer is now the single point of failure',
      detail: 'You removed one weak spot and created another. Real systems run load balancers in pairs.',
      kill: lbs[0].id,
    })
  }

  if (dbs.length) {
    for (const s of servers) {
      if (!outs(s.id).length) items.push({ tone: 'warn', title: `${s.id} can’t reach any data`, detail: 'It answers without a cache or database behind it. Connect it to where the data lives.' })
    }
  }

  for (const c of caches) {
    if (!outs(c.id).length) {
      items.push({ tone: 'warn', title: `${c.id} has no origin`, detail: 'On a miss, a cache must ask something else. Connect it to a database.' })
    } else {
      items.push({
        tone: 'good',
        title: 'Cache in front of the database',
        detail: `${c.id} answers repeated reads without a query. What happens to the database if the cache disappears?`,
        kill: c.id,
      })
    }
  }

  if (dbs.length === 1 && !nodes.some((n) => n.kind === 'replica')) {
    items.push({
      tone: 'info',
      title: 'One database holds everything',
      detail: `If ${dbs[0].id} fails, every request that needs data fails with it. Real systems replicate the database for this reason.`,
      kill: dbs[0].id,
    })
  }

  const replicas = reached('replica')
  const queues = reached('queue')
  for (const r of replicas) {
    if (!edges.some((e) => e.target === r.id && byId.get(e.source)?.kind === 'database')) {
      items.push({ tone: 'warn', title: `${r.id} has no primary`, detail: 'A replica is a copy of a database. Connect a Database → this replica so it receives the data.' })
    }
  }
  if (replicas.length && dbs.length) {
    items.push({
      tone: 'good',
      title: 'Reads are spread across replicas',
      detail: `Writes still go to the primary. What do readers see right after a write? Raise the write ratio and look for STALE READ events.`,
      kill: dbs[0].id,
    })
  }
  for (const q of queues) {
    const workers = outs(q.id)
    if (!workers.length) items.push({ tone: 'warn', title: `${q.id} has no workers`, detail: 'Messages pile up forever. Connect the queue to a Server that will process the jobs.' })
    else items.push({ tone: 'good', title: 'Writes are absorbed by a queue', detail: `Users get an instant answer while ${workers.length} worker${workers.length === 1 ? '' : 's'} catch up. How big can the backlog get before it’s a problem?`, kill: workers[0].id })
  }
  for (const s of servers) {
    const retries = Number(s.config.retries ?? 0)
    if (retries >= 2 && s.config.circuitBreaker !== true) {
      items.push({ tone: 'warn', title: `${s.id} retries ${retries}× with no circuit breaker`, detail: 'When a dependency is struggling, retries multiply its load (a retry storm). Predict what happens if its database dies.' })
    }
    if (Number(s.config.timeoutMs ?? 1000) >= 1000 && outs(s.id).length) {
      items.push({ tone: 'info', title: `${s.id} waits up to ${s.config.timeoutMs ?? 1000}ms`, detail: 'Long timeouts make users wait on dead dependencies. How short can it be without cutting off slow-but-healthy calls?' })
    }
  }

  if (last) {
    if (last.staleReads > 0) items.push({ tone: 'info', title: `${last.staleReads} stale reads last run`, detail: 'Some readers saw data older than the latest write. Is that acceptable for this feature (a like count) or not (a bank balance)?' })
    if (last.queueDepth > 0) items.push({ tone: 'info', title: `Backlog of ${last.queueDepth} messages`, detail: 'Workers could not keep up this second. Is the backlog shrinking or growing between runs?' })
    if (!caches.length && dbs.length && last.total >= 10 && last.dbQueries >= last.total * 0.9) {
      items.push({
        tone: 'info',
        title: 'Every request hit the database',
        detail: 'Users asked for the same few keys again and again, yet each one became a fresh query. What could remember answers?',
      })
    }
    for (const [id, u] of Object.entries(last.utilization)) {
      if (u <= 1) continue
      const load = last.nodeLoad[id]
      items.push({
        tone: 'warn',
        title: `Bottleneck: ${id}`,
        detail: `Last run it received ${load} requests but can handle ${Math.round(load / u)}. Add capacity beside it, or reduce what reaches it.`,
      })
    }
  }

  const order = { warn: 0, info: 1, good: 2 }
  return items.sort((a, b) => order[a.tone] - order[b.tone])
}
