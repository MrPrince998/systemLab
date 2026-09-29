import { useEffect, useMemo, useRef, useState } from 'react'
import { observations } from '../data/explain'
import type { SimEvent } from '../engine/types'
import { useProgress } from '../store/playback'
import { useStore } from '../store/store'

const fmt = (n: number) => `${Math.round(n)}ms`
const outcomeLabel = { all: 'every request succeeds', some: 'some fail', none: 'everything fails' }
const speeds = [0.25, 0.5, 1, 2, 4]

type Filter = 'all' | 'failures' | 'cache' | 'data' | 'queue' | 'routing'
const filters: Record<Filter, (e: SimEvent) => boolean> = {
  all: () => true,
  failures: (e) => ['TIMEOUT', 'OVERLOADED', 'REQUEST_FAILED', 'CACHE_UNAVAILABLE', 'QUEUE_FULL', 'FAST_FAIL', 'CIRCUIT_OPENED', 'RETRY', 'STALE_READ'].includes(e.type),
  cache: (e) => e.type.startsWith('CACHE'),
  data: (e) => ['DATABASE_QUERY', 'DATABASE_WRITE', 'REPLICA_READ', 'REPLICATION', 'STALE_READ'].includes(e.type),
  queue: (e) => e.type.startsWith('MESSAGE') || e.type === 'QUEUE_FULL',
  routing: (e) => ['REQUEST_ROUTED', 'RESPONSE_RETURNED', 'HEALTH_CHECK'].includes(e.type),
}

/** One bar per finished request: height = latency, red = failed. */
function RequestStrip({ events, currentReq }: { events: SimEvent[]; currentReq?: number }) {
  const reqs = useMemo(() => {
    const m = new Map<number, { start: number; end?: number; ok?: boolean }>()
    for (const e of events) {
      if (e.type === 'REQUEST_CREATED') m.set(e.requestId, { start: e.timestamp })
      else if ((e.type === 'REQUEST_SUCCEEDED' || e.type === 'REQUEST_FAILED') && m.has(e.requestId)) {
        const r = m.get(e.requestId)!
        if (r.end === undefined) Object.assign(r, { end: e.timestamp, ok: e.type === 'REQUEST_SUCCEEDED' })
      }
    }
    return [...m.entries()]
  }, [events])
  if (!reqs.length) return null
  const max = Math.max(50, ...reqs.map(([, r]) => (r.end ?? r.start) - r.start))
  return (
    <div className="strip">
      <div className="strip-head">
        <span>Latency per request</span>
        <span className="muted">max {fmt(max)}</span>
      </div>
      <svg viewBox={`0 0 ${reqs.length} 100`} preserveAspectRatio="none" role="img" aria-label="Latency of each request">
        {reqs.map(([id, r], i) => {
          const lat = r.end === undefined ? 0 : r.end - r.start
          const h = Math.max(3, (lat / max) * 100)
          const cls = r.end === undefined ? 'pending' : r.ok ? 'ok' : 'fail'
          return (
            <rect key={id} x={i + 0.12} width={0.76} y={100 - h} height={h} className={`${cls} ${id === currentReq ? 'cur' : ''}`}>
              <title>{`Request #${id}: ${r.end === undefined ? 'in flight' : `${r.ok ? 'OK' : 'FAILED'} in ${fmt(lat)}`}`}</title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}

export function BottomPanel() {
  const run = useStore((s) => s.run)
  const playIndex = useStore((s) => s.playIndex)
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const stale = useStore((s) => s.stale)
  const pr = useStore((s) => s.predictionResult)
  const { setPlay, setSpeed, setPlayIndex, step, skipToEnd, simulate, select } = useStore.getState()
  const { events, done, current } = useProgress()
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => events.map((e, i) => [e, i] as const).filter(([e]) => filters[filter](e)).slice(-400), [events, filter])
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [shown.length])

  const m = run?.metrics
  const total = run?.events.length ?? 0
  const status = !m ? null : m.failed === 0 ? ['Healthy', 'good'] : m.succeeded === 0 ? ['Outage', 'bad'] : ['Degraded', 'warn']
  const tiles: [string, string, string?][] = m
    ? [
        ['Success', `${m.succeeded}/${m.total}`, m.failed ? 'warn' : 'good'],
        ['Avg latency', fmt(m.avgLatency)],
        ['P95 latency', fmt(m.p95Latency)],
        ['DB queries', String(m.dbQueries)],
        ['Cache hit rate', m.cacheHits + m.cacheMisses ? `${Math.round(m.cacheHitRate * 100)}%` : '—'],
        ['Error rate', `${(m.errorRate * 100).toFixed(0)}%`, m.errorRate > 0 ? 'bad' : ''],
        ...(m.writes ? [['Writes', `${m.writes} (${m.dbWrites} saved)`] as [string, string]] : []),
        ...(m.replicaReads ? [['Replica reads', String(m.replicaReads)] as [string, string]] : []),
        ...(m.staleReads ? [['Stale reads', String(m.staleReads), 'warn'] as [string, string, string]] : []),
        ...(m.messagesConsumed || m.queueDepth ? [['Queue backlog', String(m.queueDepth), m.queueDepth ? 'warn' : 'good'] as [string, string, string]] : []),
        ...(m.retries ? [['Retries', String(m.retries), 'warn'] as [string, string, string]] : []),
        ...(m.fastFails ? [['Fast fails', String(m.fastFails)] as [string, string]] : []),
      ]
    : []

  return (
    <section data-tour="dock" className={`dock ${open ? '' : 'closed'} ${stale ? 'is-stale' : ''}`}>
      <div className="player">
        <button className="icon-btn" onClick={() => (run ? setPlay(!playing) : simulate())} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '⏸' : '▶'}
        </button>
        <button className="icon-btn" onClick={step} disabled={!run || done} title="Step one event (→)" aria-label="Step">⏭</button>
        <button className="icon-btn" onClick={skipToEnd} disabled={!run || done} title="Jump to results" aria-label="Skip to end">⏩</button>
        <input
          className="scrub"
          type="range"
          min={0}
          max={total}
          value={playIndex}
          disabled={!run}
          onChange={(e) => setPlayIndex(Number(e.target.value))}
          aria-label="Timeline"
          style={{ ['--p' as string]: `${total ? (playIndex / total) * 100 : 0}%` }}
        />
        <span className="muted small nowrap">{run ? `${playIndex}/${total} events` : 'no run yet'}</span>
        <div className="speeds" role="group" aria-label="Playback speed">
          {speeds.map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
        {stale ? (
          <button className="status stale" onClick={() => simulate()} title="You changed the architecture after this run">↻ Out of date, re-run</button>
        ) : (
          status && done && <span className={`status ${status[1]}`}>● {status[0]}</span>
        )}
        <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse panel' : 'Expand panel'}>{open ? '▾' : '▴'}</button>
      </div>

      {open && (
        <div className="dock-body">
          <div className="log-col">
            <div className="log-head">
              <b>Event timeline</b>
              <div className="filters">
                {(Object.keys(filters) as Filter[]).map((f) => (
                  <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>
                ))}
              </div>
            </div>
            <div className="log" ref={logRef} aria-live="off">
              {!run && <p className="muted pad">Press <kbd>Space</kbd> or ▶ Simulate to send traffic. Every step the simulator takes appears here.</p>}
              {shown.map(([e, i]) => (
                <button key={i} className={`ev ${e.type} ${i === playIndex - 1 ? 'cur' : ''}`} onClick={() => { setPlayIndex(i + 1); select(e.nodeId ?? e.to ?? null) }}>
                  <span className="t">{Math.round(e.timestamp)}ms</span>
                  <span className="r">#{e.requestId || '·'}</span>
                  <span className="k">{e.type.replace(/_/g, ' ')}</span>
                  <span className="d">{e.detail}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="insights">
            {m && done ? (
              <>
                <div className="tiles">
                  {tiles.map(([k, v, tone]) => (
                    <div key={k} className={`tile ${tone ?? ''}`}><span>{k}</span><b>{v}</b></div>
                  ))}
                </div>
                {pr && (
                  <div className={`prediction ${pr.outcomeOk && pr.bottleneckOk ? 'good' : 'bad'}`}>
                    <b>🔮 Your prediction</b>
                    <span>{pr.outcomeOk ? '✓' : '✗'} Outcome: you said “{outcomeLabel[pr.prediction.outcome]}”, it was “{outcomeLabel[pr.outcome]}”.</span>
                    <span>{pr.bottleneckOk ? '✓' : '✗'} Bottleneck: you said {pr.prediction.bottleneck === 'none' ? 'none' : pr.prediction.bottleneck}, actual {pr.hot.length ? pr.hot.join(', ') : 'none'}.</span>
                    {!(pr.outcomeOk && pr.bottleneckOk) && <span className="muted">What did you not expect? The timeline shows exactly where it went differently.</span>}
                  </div>
                )}
                <RequestStrip events={events} currentReq={current?.requestId} />
                <ul className="obs">{observations(m).map((o) => <li key={o}>{o}</li>)}</ul>
              </>
            ) : m ? (
              <>
                <RequestStrip events={events} currentReq={current?.requestId} />
                <p className="muted small">Watching the requests flow… Results appear when the run finishes, or press ⏩.</p>
              </>
            ) : (
              <div className="insight-empty">
                <b>What will happen?</b>
                <p className="muted">Before you simulate, predict it: which path will requests take, and which component will struggle first?</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
