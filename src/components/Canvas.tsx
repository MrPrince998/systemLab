import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react'
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type DragEvent } from 'react'
import { technologies } from '../data/technologies'
import type { EventType, Kind } from '../engine/types'
import { tickMs, useProgress } from '../store/playback'
import { useStore, type SimNode } from '../store/store'

export const accent = (color: string) => ({ '--accent': color }) as CSSProperties

const badges: Partial<Record<EventType, [string, string]>> = {
  CACHE_HIT: ['HIT', 'good'],
  CACHE_MISS: ['MISS', 'warn'],
  CACHE_STORE: ['STORED', 'info'],
  CACHE_UNAVAILABLE: ['BYPASSED', 'warn'],
  DATABASE_QUERY: ['QUERY', 'info'],
  TIMEOUT: ['TIMEOUT', 'bad'],
  OVERLOADED: ['OVERLOADED', 'bad'],
  REQUEST_SUCCEEDED: ['✓ 200 OK', 'good'],
  REQUEST_FAILED: ['✗ FAILED', 'bad'],
  DATABASE_WRITE: ['WRITE', 'info'],
  REPLICA_READ: ['READ', 'info'],
  STALE_READ: ['STALE', 'warn'],
  CACHE_INVALIDATE: ['INVALIDATE', 'warn'],
  MESSAGE_ENQUEUED: ['QUEUED', 'info'],
  MESSAGE_CONSUMED: ['JOB DONE', 'good'],
  QUEUE_FULL: ['QUEUE FULL', 'bad'],
  RETRY: ['RETRY', 'warn'],
  CIRCUIT_OPENED: ['CIRCUIT OPEN', 'bad'],
  FAST_FAIL: ['FAST FAIL', 'warn'],
}

function TechNode({ id, data, selected }: NodeProps<SimNode>) {
  const tech = technologies[data.kind]
  const playIndex = useStore((s) => s.playIndex)
  const { current, load, sent, hits, misses, enqueued, consumed, done } = useProgress()
  const backlog = useStore((s) => s.run?.metrics.backlog[id])
  const failed = data.state === 'failed'
  const capacity = typeof data.config.capacity === 'number' ? data.config.capacity : null
  const l = load[id] ?? 0
  const here = current && (current.nodeId === id || current.to === id) ? current : undefined
  const badge = here?.nodeId === id ? badges[here.type] : undefined

  let body = null
  if (capacity !== null) {
    const pct = l / capacity
    const tags: string[] = []
    if (data.kind === 'server') {
      if (Number(data.config.retries) > 0) tags.push(`↻ ${data.config.retries} retries`)
      if (data.config.circuitBreaker === true) tags.push('⚡ breaker')
      if (Number(data.config.timeoutMs) < 1000) tags.push(`⏱ ${data.config.timeoutMs}ms`)
    }
    if (data.kind === 'replica') tags.push(`lag ${data.config.lagMs}ms`)
    body = (
      <>
        <div className="meter" title={`${l} of ${capacity} requests this second`}>
          <div className="meter-track">
            <div className={`meter-fill ${pct > 1 ? 'over' : pct > 0.8 ? 'hot' : ''}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
          </div>
          <span>{l}<small>/{capacity}</small></span>
        </div>
        {tags.length > 0 && <div className="node-tags">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
      </>
    )
  } else if (data.kind === 'queue') {
    const max = Number(data.config.maxDepth) || 100
    const depth = done && backlog !== undefined ? backlog : Math.max(0, (enqueued[id] ?? 0) - (consumed[id] ?? 0))
    body = (
      <div className="meter" title={`${depth} messages waiting (max ${max})`}>
        <div className="meter-track"><div className={`meter-fill queue ${depth >= max ? 'over' : depth > max * 0.7 ? 'hot' : ''}`} style={{ width: `${Math.min(100, (depth / max) * 100)}%` }} /></div>
        <span>{depth}<small> waiting</small></span>
      </div>
    )
  } else if (data.kind === 'client') {
    body = <div className="node-stat"><b>{sent[id] ?? 0}</b> requests sent</div>
  } else if (data.kind === 'load-balancer') {
    const hc = data.config.healthChecks === true
    body = (
      <div className="node-stat">
        <span className={`tag ${hc ? 'on' : 'off'}`}>{hc ? '♥ health checks' : '♡ no health checks'}</span>
        <span><b>{l}</b> routed</span>
      </div>
    )
  } else if (data.kind === 'cache') {
    const h = hits[id] ?? 0
    const m = misses[id] ?? 0
    body = (
      <div className="cache-row">
        <span className="hit">{h} hit</span>
        <div className="ratio"><div style={{ width: h + m ? `${(h / (h + m)) * 100}%` : '0%' }} /></div>
        <span className="miss">{m} miss</span>
      </div>
    )
  }

  const cls = ['node', selected && 'selected', failed && 'failed', here && 'active', badge?.[1] === 'bad' && 'bad'].filter(Boolean).join(' ')
  return (
    <div className={cls} style={accent(tech.color)}>
      {badge && <div key={playIndex} className={`node-badge ${badge[1]}`}>{badge[0]}</div>}
      {data.kind !== 'client' && <Handle type="target" position={Position.Left} />}
      <div className="node-top">
        <div className="node-icon">{tech.icon}</div>
        <div className="node-titles">
          <div className="node-name">{tech.short}</div>
          <div className="node-id">{id}</div>
        </div>
        <span className={`pill ${failed ? 'down' : 'up'}`}>{failed ? 'DOWN' : 'UP'}</span>
      </div>
      {body}
      {data.kind !== 'replica' && <Handle type="source" position={Position.Right} />}
    </div>
  )
}

type FlowEdgeData = { pulse?: { key: number; back: boolean; ms: number }; count?: number }

/** A request (blue) or response (green) travelling along the edge. */
function Packet({ d, back, ms }: { d: string; back: boolean; ms: number }) {
  const pathRef = useRef<SVGPathElement>(null)
  const dotRef = useRef<SVGGElement>(null)
  useLayoutEffect(() => {
    const path = pathRef.current
    const dot = dotRef.current
    if (!path || !dot) return
    const len = path.getTotalLength()
    const start = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const pt = path.getPointAtLength((back ? 1 - t : t) * len)
      dot.setAttribute('transform', `translate(${pt.x},${pt.y})`)
      if (t < 1) raf = requestAnimationFrame(frame)
    }
    frame(start)
    return () => cancelAnimationFrame(raf)
  }, [d, back, ms])
  const color = back ? 'var(--good)' : 'var(--blue)'
  return (
    <>
      <path ref={pathRef} d={d} fill="none" stroke="none" />
      <g ref={dotRef} className="packet">
        <circle r={10} style={{ fill: color, opacity: 0.25 }} />
        <circle r={5} style={{ fill: color }} />
      </g>
    </>
  )
}

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const [d, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={d} markerEnd={markerEnd} style={style} interactionWidth={24} />
      {data?.pulse && <Packet key={data.pulse.key} d={d} back={data.pulse.back} ms={data.pulse.ms} />}
      {!!data?.count && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }} title="Requests over this connection">
            {data.count}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { tech: TechNode }
const edgeTypes = { flow: FlowEdge }

export function Canvas() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const playIndex = useStore((s) => s.playIndex)
  const speed = useStore((s) => s.speed)
  const total = useStore((s) => s.run?.events.length ?? 0)
  const fitKey = useStore((s) => s.fitKey)
  const touring = useStore((s) => s.tourStep !== null)
  const inMission = useStore((s) => !!s.challengeId)
  const { onNodesChange, onEdgesChange, onConnect, addNode, select, startTour } = useStore.getState()
  const { screenToFlowPosition, fitView } = useReactFlow()

  // Fit only when a saved canvas loads (mount or mission switch). Fitting as the
  // first node is dropped would jump the view under the student's cursor.
  useEffect(() => {
    if (!useStore.getState().nodes.length) return
    const id = requestAnimationFrame(() => fitView({ padding: 0.2, maxZoom: 1, duration: 400 }))
    return () => cancelAnimationFrame(id)
  }, [fitKey, fitView])
  const { current, edgeCounts } = useProgress()

  const nodeState = useMemo(() => new Map(nodes.map((n) => [n.id, n.data.state])), [nodes])
  const shownEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => {
        const fwd = current?.type === 'REQUEST_ROUTED' && current.from === e.source && current.to === e.target
        const back = current?.type === 'RESPONSE_RETURNED' && current.from === e.target && current.to === e.source
        const broken = nodeState.get(e.target) === 'failed'
        const color = fwd ? '#38bdf8' : back ? '#34d399' : broken ? '#f87171' : e.selected ? '#e2e8f0' : '#475569'
        return {
          ...e,
          type: 'flow',
          data: {
            ...e.data,
            count: edgeCounts[`${e.source}->${e.target}`],
            pulse: fwd || back ? { key: playIndex, back, ms: tickMs(total, speed) * 0.95 } : undefined,
          },
          style: { stroke: color, strokeWidth: fwd || back || e.selected ? 2.5 : 1.75, strokeDasharray: broken ? '6 5' : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        }
      }),
    [edges, current, nodeState, edgeCounts, playIndex, total, speed],
  )

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault()
    const kind = ev.dataTransfer.getData('application/x-kind') as Kind
    if (kind) addNode(kind, screenToFlowPosition({ x: ev.clientX - 90, y: ev.clientY - 36 }))
  }

  return (
    <div className="canvas" data-tour="canvas" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={nodes}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
        deleteKeyCode={['Backspace', 'Delete']}
        panActivationKeyCode={null}
        connectionLineStyle={{ stroke: '#38bdf8', strokeWidth: 2.5 }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#1f2a40" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {nodes.length === 0 && !touring && (
        <div className="empty">
          <div className="empty-card glass">
            <div className="empty-art">👤 <span>→</span> 🖥️ <span>→</span> 🗄️</div>
            <h2>{inMission ? 'Start from an empty canvas' : 'Build your first system'}</h2>
            <p>Drag components from the left onto this canvas. Connect them by dragging from a node’s <b>right dot</b> to another node’s <b>left dot</b>.</p>
            {!inMission && <button className="ghost" onClick={startTour}>▶ Replay the walkthrough</button>}
          </div>
        </div>
      )}
    </div>
  )
}
