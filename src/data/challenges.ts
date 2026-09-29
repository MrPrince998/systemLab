import { defaultConfig } from '../engine/defaults'
import type { Architecture, Kind, NodeConfig } from '../engine/types'

export type MetricKey =
  | 'successRate'
  | 'errorRate'
  | 'avgLatency'
  | 'p95Latency'
  | 'dbQueries'
  | 'cacheHitRate'
  | 'maxDbUtilization'
  | 'cost'
  | 'queueDepth'
  | 'staleReads'

export interface Objective {
  label: string
  metric: MetricKey
  op: '>=' | '<='
  value: number
}

export type LevelId = 'beginner' | 'intermediate' | 'advanced' | 'senior'

export interface Level {
  id: LevelId
  title: string
  subtitle: string
  icon: string
  color: string
}

export interface Challenge {
  id: string
  level: LevelId
  title: string
  tagline: string
  brief: string
  concepts: string[]
  availableKinds: Kind[]
  /** Hardware for this mission. Students can't change these, only the architecture. */
  defaults?: Partial<Record<Kind, NodeConfig>>
  /** Traffic sent during validation, and components that crash (first healthy one of each kind listed). */
  scenario: { requests: number; keyspace: number; writeRatio?: number; kill?: Kind[] }
  objectives: Objective[]
  hints: string[]
  /** One design that passes. Shown after completion as a comparison, never as the only answer. */
  solution: Solution
}

/** Compact graph: nodes as [id, kind, config overrides], edges as "a>b a>c". */
export interface Solution {
  nodes: [string, Kind, NodeConfig?][]
  edges: string
}

/** Builds a graph with the mission's hardware, the way a student would. */
export function buildGraph(c: Pick<Challenge, 'defaults'>, g: Solution): Architecture {
  return {
    nodes: g.nodes.map(([id, kind, config]) => ({ id, kind, state: 'healthy', config: { ...defaultConfig[kind], ...c.defaults?.[kind], ...config } })),
    edges: g.edges.split(/\s+/).filter(Boolean).map((pair) => {
      const [source, target] = pair.split('>')
      return { id: `${source}->${target}`, source, target, latency: 10 }
    }),
  }
}

/** Config fields fixed by the mission's hardware; design choices (health checks, TTL) stay editable. */
export const FIXED_FIELDS = ['capacity', 'processingMs', 'queryMs']

export const levels: Level[] = [
  { id: 'beginner', title: 'Beginner', subtitle: 'How a request travels: clients, servers and databases.', icon: '🌱', color: '#34d399' },
  { id: 'intermediate', title: 'Intermediate', subtitle: 'Make it faster and bigger: load balancing and caching.', icon: '⚡', color: '#38bdf8' },
  { id: 'advanced', title: 'Advanced', subtitle: 'Keep it running when parts fail: health checks and redundancy.', icon: '🛡️', color: '#a78bfa' },
  { id: 'senior', title: 'Senior', subtitle: 'Real design scenarios with traffic, failures and a budget.', icon: '🏛️', color: '#f472b6' },
]

const basic: Kind[] = ['client', 'server', 'load-balancer', 'cache', 'database']
const all: Kind[] = [...basic, 'replica', 'queue']
const S = (n: number, prefix = 's') => Array.from({ length: n }, (_, i) => [`${prefix}${i + 1}`, 'server'] as [string, Kind])
const fan = (from: string, n: number, to?: string, prefix = 's') => Array.from({ length: n }, (_, i) => `${from}>${prefix}${i + 1}` + (to ? ` ${prefix}${i + 1}>${to}` : '')).join(' ')

export const challenges: Challenge[] = [
  {
    id: 'b1',
    level: 'beginner',
    title: 'Your first request',
    tagline: 'Connect a client to a server.',
    brief: 'A user opens your website. Their browser (the client) needs a server to answer. Build the smallest system that responds.',
    concepts: ['Client', 'Server', 'Request / response'],
    availableKinds: ['client', 'server'],
    scenario: { requests: 5, keyspace: 5 },
    objectives: [{ label: 'Every request gets a response', metric: 'successRate', op: '>=', value: 1 }],
    hints: ['Drag a Client and a Server onto the canvas.', 'Drag from the Client’s right dot to the Server’s left dot.'],
    solution: { nodes: [['c', 'client'], ['s', 'server']], edges: 'c>s' },
  },
  {
    id: 'b2',
    level: 'beginner',
    title: 'Pages need data',
    tagline: 'Add a database behind the server.',
    brief: 'Your pages show user profiles, which live in a database. Requests must travel all the way to the data and back.',
    concepts: ['Database', 'Query', 'Three-tier architecture'],
    availableKinds: ['client', 'server', 'database'],
    scenario: { requests: 10, keyspace: 5 },
    objectives: [
      { label: 'Every request succeeds', metric: 'successRate', op: '>=', value: 1 },
      { label: 'Requests reach the database', metric: 'dbQueries', op: '>=', value: 1 },
    ],
    hints: ['A server alone has no data. Where does data live?', 'Build Client → Server → Database.'],
    solution: { nodes: [['c', 'client'], ['s', 'server'], ['db', 'database']], edges: 'c>s s>db' },
  },
  {
    id: 'i1',
    level: 'intermediate',
    title: 'Handle 3× more traffic',
    tagline: 'One server can’t keep up.',
    brief: 'Launch day: 60 requests per second, but each server handles only 20. Users are seeing errors.',
    concepts: ['Horizontal scaling', 'Load balancer', 'Round-robin'],
    availableKinds: ['client', 'server', 'load-balancer', 'database'],
    defaults: { server: { capacity: 20 }, database: { capacity: 200 } },
    scenario: { requests: 60, keyspace: 20 },
    objectives: [{ label: 'At least 99% of requests succeed', metric: 'successRate', op: '>=', value: 0.99 }],
    hints: ['Build client → server → database first and simulate. Which node goes red?', 'One server isn’t enough. How do you use several?', 'Client → Load Balancer → 3 Servers. Every server also connects to the database.'],
    solution: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...S(3), ['db', 'database']], edges: `c>lb ${fan('lb', 3, 'db')}` },
  },
  {
    id: 'i2',
    level: 'intermediate',
    title: 'Improve read performance',
    tagline: 'The database drowns in repeated reads.',
    brief: 'Users keep asking for the same 5 pages. The database handles only 15 queries per second, but 40 requests arrive.',
    concepts: ['Cache', 'Cache hit / miss', 'Database load'],
    availableKinds: ['client', 'server', 'cache', 'database'],
    defaults: { server: { capacity: 100 }, database: { capacity: 15 } },
    scenario: { requests: 40, keyspace: 5 },
    objectives: [
      { label: 'At least 99% of requests succeed', metric: 'successRate', op: '>=', value: 0.99 },
      { label: 'Database queries ≤ 15', metric: 'dbQueries', op: '<=', value: 15 },
      { label: 'Average latency ≤ 100ms', metric: 'avgLatency', op: '<=', value: 100 },
    ],
    hints: ['The same pages are requested again and again. What could remember the answers?', 'Put a Cache between the server and the database.', 'Server → Cache → Database, with no direct server → database connection.'],
    solution: { nodes: [['c', 'client'], ['s', 'server'], ['cache', 'cache'], ['db', 'database']], edges: 'c>s s>cache cache>db' },
  },
  {
    id: 'i3',
    level: 'intermediate',
    title: 'Hit the latency budget',
    tagline: 'A slow database, an impatient product team.',
    brief: 'Each database query takes 150ms. Product wants pages in under 90ms on average. Users mostly view the same 4 dashboards.',
    concepts: ['Latency', 'Caching', 'Hot keys'],
    availableKinds: ['client', 'server', 'load-balancer', 'cache', 'database'],
    defaults: { server: { capacity: 100 }, database: { capacity: 100, queryMs: 150 } },
    scenario: { requests: 40, keyspace: 4 },
    objectives: [
      { label: 'At least 99% of requests succeed', metric: 'successRate', op: '>=', value: 0.99 },
      { label: 'Average latency ≤ 90ms', metric: 'avgLatency', op: '<=', value: 90 },
    ],
    hints: ['Simulate and read the timeline: where does most of the time go?', 'Adding servers won’t make one query faster. Can you skip the query?', 'A cache in front of the database answers repeat requests in a few ms.'],
    solution: { nodes: [['c', 'client'], ['s', 'server'], ['cache', 'cache'], ['db', 'database']], edges: 'c>s s>cache cache>db' },
  },
  {
    id: 'i4',
    level: 'intermediate',
    title: 'Scale reads with replicas',
    tagline: 'One database can’t serve every read.',
    brief: '60 requests per second, 90% reads spread over 30 different pages, so caching barely helps. The database handles 25 queries per second.',
    concepts: ['Read replicas', 'Replication', 'Read/write split'],
    availableKinds: ['client', 'server', 'cache', 'database', 'replica'],
    defaults: { server: { capacity: 100 }, database: { capacity: 25 }, replica: { capacity: 25 } },
    scenario: { requests: 60, keyspace: 30, writeRatio: 0.1 },
    objectives: [{ label: 'At least 99% of requests succeed', metric: 'successRate', op: '>=', value: 0.99 }],
    hints: ['Simulate: how many of the database’s queries are reads?', 'Reads can go to copies of the database. Writes must still go to the primary.', 'Connect Database → 2 Read Replicas, and the Server to the database and both replicas.'],
    solution: { nodes: [['c', 'client'], ['s', 'server'], ['db', 'database'], ['r1', 'replica'], ['r2', 'replica']], edges: 's>db s>r1 s>r2 db>r1 db>r2 c>s' },
  },
  {
    id: 'a1',
    level: 'advanced',
    title: 'Survive a server failure',
    tagline: 'A server will crash mid-traffic.',
    brief: 'You run 30 requests per second. During the test one server will crash. Load balancers in this data center ship with health checks turned off.',
    concepts: ['Health checks', 'Failover', 'Redundancy'],
    availableKinds: basic,
    defaults: { server: { capacity: 20 }, database: { capacity: 200 }, 'load-balancer': { healthChecks: false } },
    scenario: { requests: 30, keyspace: 10, kill: ['server'] },
    objectives: [{ label: 'At least 99% succeed with a server down', metric: 'successRate', op: '>=', value: 0.99 }],
    hints: ['Kill a server in the Failure Lab and simulate. Which requests fail?', 'How does a load balancer know a server died?', 'Turn on health checks, and make sure the survivors can carry 30 req/s.'],
    solution: { nodes: [['c', 'client'], ['lb', 'load-balancer', { healthChecks: true }], ...S(3), ['db', 'database']], edges: `c>lb ${fan('lb', 3, 'db')}` },
  },
  {
    id: 'a2',
    level: 'advanced',
    title: 'N+1 redundancy',
    tagline: 'Enough spare capacity, and not a server more.',
    brief: '50 requests per second, servers handle 20 each, and one will crash. Finance is watching: don’t over-provision.',
    concepts: ['N+1 redundancy', 'Capacity planning', 'Cost'],
    availableKinds: basic,
    defaults: { server: { capacity: 20 }, database: { capacity: 200 } },
    scenario: { requests: 50, keyspace: 20, kill: ['server'] },
    objectives: [
      { label: 'At least 99% succeed with a server down', metric: 'successRate', op: '>=', value: 0.99 },
      { label: 'Infrastructure cost ≤ 12', metric: 'cost', op: '<=', value: 12 },
    ],
    hints: ['How many servers does 50 req/s need when nothing fails?', 'Now add one more for the one that crashes. That’s N+1.', '4 servers behind a load balancer: 3 survivors × 20 = 60 ≥ 50.'],
    solution: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...S(4), ['db', 'database']], edges: `c>lb ${fan('lb', 4, 'db')}` },
  },
  {
    id: 'a3',
    level: 'advanced',
    title: 'Survive a traffic spike',
    tagline: 'Two bottlenecks at once.',
    brief: '150 requests per second for 10 popular pages. Servers handle 40 each, the database only 30.',
    concepts: ['Load balancing', 'Caching', 'Bottlenecks'],
    availableKinds: basic,
    defaults: { server: { capacity: 40 }, database: { capacity: 30 } },
    scenario: { requests: 150, keyspace: 10 },
    objectives: [
      { label: 'At least 99% of requests succeed', metric: 'successRate', op: '>=', value: 0.99 },
      { label: 'Average latency ≤ 150ms', metric: 'avgLatency', op: '<=', value: 150 },
      { label: 'Database utilization ≤ 100%', metric: 'maxDbUtilization', op: '<=', value: 1 },
    ],
    hints: ['Two things overload. Simulate and see which nodes turn red.', 'Spread the server load and protect the database.', '4 servers behind a load balancer, sharing one cache in front of the database.'],
    solution: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...S(4), ['cache', 'cache'], ['db', 'database']], edges: `c>lb ${fan('lb', 4, 'cache')} cache>db` },
  },
  {
    id: 'a4',
    level: 'advanced',
    title: 'Absorb a write burst',
    tagline: 'Users upload faster than you can save.',
    brief: '100 requests per second and 80% are writes (photo uploads). The database handles 80 operations per second. Users must get a fast response, even if saving finishes later.',
    concepts: ['Message queue', 'Async processing', 'Workers', 'Backlog'],
    availableKinds: all,
    defaults: { server: { capacity: 40 }, database: { capacity: 80 } },
    scenario: { requests: 100, keyspace: 50, writeRatio: 0.8 },
    objectives: [
      { label: 'At least 99% of requests succeed', metric: 'successRate', op: '>=', value: 0.99 },
      { label: 'Average latency ≤ 100ms', metric: 'avgLatency', op: '<=', value: 100 },
      { label: 'Database utilization ≤ 100%', metric: 'maxDbUtilization', op: '<=', value: 1 },
      { label: 'Queue backlog ≤ 60 messages', metric: 'queueDepth', op: '<=', value: 60 },
    ],
    hints: ['Do writes have to finish before the user gets an answer?', 'Put a Message Queue between the servers and the database for writes. Servers still read from the database directly.', 'Servers → Queue → one worker Server → Database. The worker saves at its own pace; the backlog absorbs the rest.'],
    solution: {
      nodes: [['c', 'client'], ['lb', 'load-balancer'], ...S(3), ['q', 'queue'], ['w1', 'server'], ['db', 'database']],
      edges: `c>lb ${fan('lb', 3, 'q')} ${fan('lb', 3, 'db').replace(/lb>s\d /g, '')} q>w1 w1>db`,
    },
  },
  {
    id: 'a5',
    level: 'advanced',
    title: 'Stop the retry storm',
    tagline: 'The database is down. Don’t make it worse.',
    brief: 'The database will crash. Your servers retry every failed call 3 times and wait a full second each time, so users hang for 4 seconds before seeing an error. Make failures fast.',
    concepts: ['Timeouts', 'Retries', 'Circuit breaker', 'Fail fast'],
    availableKinds: basic,
    defaults: { server: { capacity: 100, retries: 3, timeoutMs: 1000 }, database: { capacity: 100 } },
    scenario: { requests: 40, keyspace: 10, kill: ['database'] },
    objectives: [
      { label: 'Average latency ≤ 150ms during the outage', metric: 'avgLatency', op: '<=', value: 150 },
      { label: 'P95 latency ≤ 600ms', metric: 'p95Latency', op: '<=', value: 600 },
    ],
    hints: ['Kill the database and simulate. Where does all the time go?', 'Three settings on the server matter: timeout, retries and the circuit breaker.', 'A circuit breaker plus a short timeout fails fast after a few attempts. So do fewer retries with a short timeout.'],
    solution: { nodes: [['c', 'client'], ['s', 'server', { circuitBreaker: true, timeoutMs: 100 }], ['db', 'database']], edges: 'c>s s>db' },
  },
  {
    id: 's1',
    level: 'senior',
    title: 'Design a URL shortener',
    tagline: 'Read-heavy, hot keys, must stay up.',
    brief: 'Requirements: 200 redirects/s, heavily skewed to 20 viral links. Latency under 120ms, one server may crash, budget of 20 cost units.',
    concepts: ['Read-heavy design', 'Caching', 'Redundancy', 'Cost'],
    availableKinds: basic,
    defaults: { server: { capacity: 40 }, database: { capacity: 30 } },
    scenario: { requests: 200, keyspace: 20, kill: ['server'] },
    objectives: [
      { label: 'At least 99% of redirects succeed', metric: 'successRate', op: '>=', value: 0.99 },
      { label: 'Average latency ≤ 120ms', metric: 'avgLatency', op: '<=', value: 120 },
      { label: 'Infrastructure cost ≤ 20', metric: 'cost', op: '<=', value: 20 },
    ],
    hints: ['Estimate first: how many servers for 200 req/s, plus one spare?', 'The database can’t take 200 reads/s. Most requests are for the same links.', 'Load balancer → 6 servers → shared cache → database.'],
    solution: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...S(6), ['cache', 'cache'], ['db', 'database']], edges: `c>lb ${fan('lb', 6, 'cache')} cache>db` },
  },
  {
    id: 's2',
    level: 'senior',
    title: 'Flash sale on a budget',
    tagline: 'Every cost unit counts.',
    brief: 'A 240 req/s flash sale on 12 products. Servers handle 60 each, the database only 20, one server will crash, and the budget is 15.',
    concepts: ['Capacity planning', 'Cost trade-offs', 'Cache offload'],
    availableKinds: basic,
    defaults: { server: { capacity: 60 }, database: { capacity: 20 } },
    scenario: { requests: 240, keyspace: 12, kill: ['server'] },
    objectives: [
      { label: 'At least 99% of requests succeed', metric: 'successRate', op: '>=', value: 0.99 },
      { label: 'Database utilization ≤ 100%', metric: 'maxDbUtilization', op: '<=', value: 1 },
      { label: 'Infrastructure cost ≤ 15', metric: 'cost', op: '<=', value: 15 },
    ],
    hints: ['Work out the minimum server count with one failure.', 'The database takes 20 queries: only a cache keeps it alive.', 'LB + 5 servers + cache + database costs exactly 15.'],
    solution: { nodes: [['c', 'client'], ['lb', 'load-balancer'], ...S(5), ['cache', 'cache'], ['db', 'database']], edges: `c>lb ${fan('lb', 5, 'cache')} cache>db` },
  },
  {
    id: 's3',
    level: 'senior',
    title: 'Survive a zone outage',
    tagline: 'Two servers vanish at once.',
    brief: 'A whole availability zone goes dark and takes two servers with it. 120 req/s, servers handle 40, budget 14. The load balancers ship with default settings.',
    concepts: ['Availability zones', 'Failure domains', 'Health checks'],
    availableKinds: basic,
    defaults: { server: { capacity: 40 }, database: { capacity: 200 }, 'load-balancer': { healthChecks: false } },
    scenario: { requests: 120, keyspace: 30, kill: ['server', 'server'] },
    objectives: [
      { label: 'At least 99% succeed with two servers down', metric: 'successRate', op: '>=', value: 0.99 },
      { label: 'Infrastructure cost ≤ 14', metric: 'cost', op: '<=', value: 14 },
    ],
    hints: ['Check the load balancer’s default settings. Are they safe?', 'Survivors must carry 120 req/s after losing two servers.', '5 servers (3 × 40 = 120 survive) behind a load balancer with health checks on.'],
    solution: { nodes: [['c', 'client'], ['lb', 'load-balancer', { healthChecks: true }], ...S(5), ['db', 'database']], edges: `c>lb ${fan('lb', 5, 'db')}` },
  },
  {
    id: 's4',
    level: 'senior',
    title: 'Design a chat system',
    tagline: 'Write-heavy, bursty, always on.',
    brief: 'Requirements: 150 req/s, 60% are messages being sent, reads load recent conversations. Servers handle 40, the database 60. One server will crash. Budget 22.',
    concepts: ['Write-heavy design', 'Queues', 'Read replicas', 'Redundancy'],
    availableKinds: all,
    defaults: { server: { capacity: 40 }, database: { capacity: 60 }, replica: { capacity: 40 } },
    scenario: { requests: 150, keyspace: 40, writeRatio: 0.6, kill: ['server'] },
    objectives: [
      { label: 'At least 99% of requests succeed', metric: 'successRate', op: '>=', value: 0.99 },
      { label: 'Average latency ≤ 120ms', metric: 'avgLatency', op: '<=', value: 120 },
      { label: 'Database utilization ≤ 100%', metric: 'maxDbUtilization', op: '<=', value: 1 },
      { label: 'Infrastructure cost ≤ 22', metric: 'cost', op: '<=', value: 22 },
    ],
    hints: ['Split the problem: where do writes go, where do reads go?', 'Queue the sends so a worker writes them at a safe rate; move reads off the primary.', 'LB → 5 servers → (Queue → worker → DB) and (DB + 2 replicas for reads).'],
    solution: {
      nodes: [['c', 'client'], ['lb', 'load-balancer'], ...S(5), ['q', 'queue'], ['w1', 'server'], ['db', 'database'], ['r1', 'replica'], ['r2', 'replica']],
      edges: `c>lb ${fan('lb', 5, 'q')} ${[1, 2, 3, 4, 5].map((i) => `s${i}>db s${i}>r1 s${i}>r2`).join(' ')} q>w1 w1>db db>r1 db>r2`,
    },
  },
  {
    id: 's5',
    level: 'senior',
    title: 'Design a news feed',
    tagline: 'Read-heavy, and the primary will die.',
    brief: 'Requirements: 300 req/s, 95% reads over 50 trending stories. The primary database will fail during the test, and readers must keep scrolling. Writes may fail while it’s down. Budget 18.',
    concepts: ['Read replicas', 'Failover for reads', 'Caching', 'Availability'],
    availableKinds: all,
    defaults: { server: { capacity: 80 }, database: { capacity: 40 }, replica: { capacity: 60 } },
    scenario: { requests: 300, keyspace: 50, writeRatio: 0.05, kill: ['database'] },
    objectives: [
      { label: 'At least 90% succeed with the primary down', metric: 'successRate', op: '>=', value: 0.9 },
      { label: 'Average latency ≤ 150ms', metric: 'avgLatency', op: '<=', value: 150 },
      { label: 'Infrastructure cost ≤ 18', metric: 'cost', op: '<=', value: 18 },
    ],
    hints: ['If the primary is gone, where can reads come from?', 'Replicas keep their copy of the data when the primary dies. Keep the cache in front of them.', 'LB → 4 servers → cache → replica(s), with the database replicating into them.'],
    solution: {
      nodes: [['c', 'client'], ['lb', 'load-balancer'], ...S(4), ['cache', 'cache'], ['db', 'database'], ['r1', 'replica']],
      edges: `c>lb ${fan('lb', 4, 'cache')} cache>r1 db>r1`,
    },
  },
]

export const missionsIn = (level: LevelId) => challenges.filter((c) => c.level === level)

/** A level opens once every mission in the previous level is complete. */
export function levelUnlocked(level: LevelId, completed: string[]) {
  const i = levels.findIndex((l) => l.id === level)
  return i <= 0 || missionsIn(levels[i - 1].id).every((c) => completed.includes(c.id))
}

export const nextMission = (id: string) => challenges[challenges.findIndex((c) => c.id === id) + 1]
