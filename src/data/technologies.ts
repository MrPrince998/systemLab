import type { Kind } from '../engine/types'

export interface ConfigField {
  key: string
  label: string
  type: 'number' | 'boolean'
  min?: number
  max?: number
  step?: number
  hint: string
}

export interface Technology {
  kind: Kind
  name: string
  /** Label that fits on a canvas node. */
  short: string
  tagline: string
  /** Relative infrastructure cost, used by budget objectives. */
  cost: number
  icon: string
  color: string
  definition: string
  howItWorks: string[]
  concepts: string[]
  strengths: string[]
  tradeoffs: string[]
  failureModes: string[]
  tryIt: string
  fields: ConfigField[]
}

export const technologies: Record<Kind, Technology> = {
  client: {
    kind: 'client',
    name: 'Client',
    cost: 0,
    short: 'Client',
    tagline: 'Sends requests',
    icon: '👤',
    color: '#38bdf8',
    definition: 'The user’s browser or app. It starts every request in your system.',
    howItWorks: ['User does something (opens a page)', 'Client sends an HTTP request', 'Waits for the response', 'Shows the result'],
    concepts: ['Request', 'Response', 'HTTP', 'Latency'],
    strengths: ['Runs on the user’s device, so it costs you nothing to scale'],
    tradeoffs: ['You don’t control it: it can be slow, offline or malicious'],
    failureModes: ['Network drops the request', 'User gives up waiting (timeout)'],
    tryIt: 'Connect the client to a server and press Simulate. Watch the request go out and the response come back.',
    fields: [],
  },
  server: {
    kind: 'server',
    name: 'Application Server',
    cost: 2,
    short: 'Server',
    tagline: 'Runs business logic',
    icon: '🖥️',
    color: '#a78bfa',
    definition: 'Receives requests and runs your business logic, calling other systems (cache, database) to get data.',
    howItWorks: ['Receive request', 'Run business logic', 'Ask downstream (cache / database) for data', 'Build and return the response'],
    concepts: ['Capacity', 'Stateless', 'Timeouts', 'Retries', 'Circuit breaker'],
    strengths: ['Easy to add more copies when stateless'],
    tradeoffs: ['Each server has a fixed capacity', 'More servers need a load balancer in front'],
    failureModes: ['Overload: too many requests, so it rejects them', 'Crash: requests time out', 'Retry storm: retries pile more load on a struggling dependency'],
    tryIt: 'Set Traffic to 40 requests with a single server (capacity 20). Half the requests fail. Now add servers behind a load balancer.',
    fields: [
      { key: 'capacity', label: 'Capacity (req/s)', type: 'number', min: 1, max: 500, step: 5, hint: 'Requests it can handle in one second before rejecting.' },
      { key: 'processingMs', label: 'Processing (ms)', type: 'number', min: 1, max: 500, step: 5, hint: 'Time spent running business logic.' },
      { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', min: 50, max: 3000, step: 50, hint: 'How long it waits for a downstream answer before giving up.' },
      { key: 'retries', label: 'Retries', type: 'number', min: 0, max: 5, step: 1, hint: 'Extra attempts after a failed downstream call. Each retry adds load.' },
      { key: 'circuitBreaker', label: 'Circuit breaker', type: 'boolean', hint: 'After 5 failures in a row, fail fast for a while instead of waiting on a broken dependency.' },
    ],
  },
  'load-balancer': {
    kind: 'load-balancer',
    name: 'Load Balancer',
    cost: 1,
    short: 'Load Balancer',
    tagline: 'Spreads traffic',
    icon: '⚖️',
    color: '#34d399',
    definition: 'Spreads incoming requests across several servers so none is overwhelmed, and avoids servers that are down.',
    howItWorks: ['Receive request', 'Pick a backend (round-robin)', 'Skip backends that failed health checks', 'Forward the request'],
    concepts: ['Round-robin', 'Health checks', 'Failover', 'Horizontal scaling'],
    strengths: ['Scales out the server tier', 'Hides server failures from users'],
    tradeoffs: ['Is itself a single point of failure unless duplicated', 'Adds a network hop'],
    failureModes: ['Health checks off: keeps routing to dead servers', 'All backends down: nothing to route to'],
    tryIt: 'Kill a server in the Failure Lab, then toggle Health checks off and on. Compare the failed requests.',
    fields: [
      { key: 'healthChecks', label: 'Health checks', type: 'boolean', hint: 'Probe backends and stop routing to dead ones.' },
    ],
  },
  cache: {
    kind: 'cache',
    name: 'Cache',
    cost: 1,
    short: 'Cache',
    tagline: 'Remembers answers',
    icon: '⚡',
    color: '#fbbf24',
    definition: 'Keeps recently used data in fast storage so repeated requests skip the slow database.',
    howItWorks: ['Look up the key', 'HIT: return the stored value', 'MISS: ask the database', 'Store the answer for next time'],
    concepts: ['Cache hit', 'Cache miss', 'TTL', 'Eviction', 'Invalidation'],
    strengths: ['Much lower latency', 'Far fewer database queries'],
    tradeoffs: ['Data can be stale until the TTL expires', 'Invalidation is hard', 'Extra infrastructure'],
    failureModes: ['Cache down: every request hits the database', 'Cold cache: all misses at first', 'Stampede when popular entries expire together'],
    tryIt: 'Place a cache between server and database. Simulate twice: the first run misses, the second hits and the database goes quiet.',
    fields: [
      { key: 'ttlMs', label: 'TTL (ms)', type: 'number', min: 100, max: 60000, step: 500, hint: 'How long an entry stays fresh.' },
    ],
  },
  database: {
    kind: 'database',
    name: 'Database',
    cost: 3,
    short: 'Database',
    tagline: 'Stores the truth',
    icon: '🗄️',
    color: '#f472b6',
    definition: 'Durable storage for your data. It is the source of truth, and usually the slowest part of a request.',
    howItWorks: ['Receive query', 'Find the data', 'Return rows', 'Get slower as load rises'],
    concepts: ['Query', 'Capacity', 'Contention', 'Replication', 'Bottleneck'],
    strengths: ['Durable', 'Consistent source of truth'],
    tradeoffs: ['Hard to scale', 'Latency grows under load'],
    failureModes: ['Overload: queries rejected', 'Down: everything that needs data fails'],
    tryIt: 'Send 40 requests to a database with capacity 15. Watch it reject queries, then relieve it with a cache or read replicas.',
    fields: [
      { key: 'capacity', label: 'Capacity (queries/s)', type: 'number', min: 1, max: 500, step: 5, hint: 'Queries per second before rejecting.' },
      { key: 'queryMs', label: 'Query time (ms)', type: 'number', min: 1, max: 500, step: 5, hint: 'Base time for one query.' },
    ],
  },
  replica: {
    kind: 'replica',
    name: 'Read Replica',
    cost: 2,
    short: 'Replica',
    tagline: 'Copies data for reads',
    icon: '📑',
    color: '#fb923c',
    definition: 'A read-only copy of the database. The primary copies every write to it, so reads can be spread across more machines.',
    howItWorks: ['Primary database writes the change', 'Change is copied to each replica after a lag', 'Servers send reads to replicas', 'Writes still go to the primary only'],
    concepts: ['Replication', 'Replication lag', 'Read scaling', 'Eventual consistency'],
    strengths: ['Adds read capacity', 'Reads survive a primary outage'],
    tradeoffs: ['Replication lag: reads can return old data', 'Can’t take writes', 'More machines to pay for'],
    failureModes: ['Stale reads right after a write', 'No primary connected: it has no data'],
    tryIt: 'Connect Database → Replica, and Server → both. Set write ratio to 20% and the replica lag to 2000ms, then look for STALE READ events.',
    fields: [
      { key: 'capacity', label: 'Capacity (reads/s)', type: 'number', min: 1, max: 500, step: 5, hint: 'Reads per second before rejecting.' },
      { key: 'queryMs', label: 'Query time (ms)', type: 'number', min: 1, max: 500, step: 5, hint: 'Base time for one read.' },
      { key: 'lagMs', label: 'Replication lag (ms)', type: 'number', min: 0, max: 5000, step: 50, hint: 'How far behind the primary this copy is.' },
    ],
  },
  queue: {
    kind: 'queue',
    name: 'Message Queue',
    cost: 1,
    short: 'Queue',
    tagline: 'Absorbs bursts of work',
    icon: '📬',
    color: '#22d3ee',
    definition: 'Accepts work instantly and holds it until workers are free. Users get a fast answer, and slow work happens in the background.',
    howItWorks: ['Server puts a message on the queue', 'Queue answers immediately (202 Accepted)', 'Workers pull messages when they have capacity', 'Unfinished work waits as a backlog'],
    concepts: ['Asynchronous processing', 'Backlog', 'Producers & consumers', 'Back-pressure'],
    strengths: ['Absorbs traffic spikes', 'Fast responses for slow jobs', 'Work survives worker crashes'],
    tradeoffs: ['Work finishes later, not immediately', 'Results are eventually consistent', 'Backlog can grow without limit'],
    failureModes: ['Full queue rejects new work', 'Too few workers: backlog keeps growing'],
    tryIt: 'Server → Queue → one Server as a worker → Database. Set writes to 100% and send 40 requests. Responses are instant, but watch the backlog.',
    fields: [
      { key: 'maxDepth', label: 'Max depth (messages)', type: 'number', min: 1, max: 1000, step: 10, hint: 'Messages it can hold before rejecting new work.' },
    ],
  },
}

export const kindOrder: Kind[] = ['client', 'server', 'load-balancer', 'cache', 'database', 'replica', 'queue']
