import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { technologies } from '../data/technologies'
import type { Kind } from '../engine/types'
import { useStore, type State } from '../store/store'

type Placement = 'right' | 'left' | 'bottom' | 'top' | 'inset' | 'center'

interface Step {
  title: string
  body: string
  /** data-tour anchor to spotlight. */
  target?: string
  placement: Placement
  /** Dim the rest of the screen. Off for steps where the student works on the canvas. */
  dim?: boolean
  /** Waits for the student to do this; the tour advances by itself when it becomes true. */
  done?: (s: State) => boolean
  /** Performs the step for students who get stuck. */
  auto?: () => void
  /** Animated ghost showing the gesture: CSS selectors to move from and to. */
  demo?: { from: string; to: string; label?: string }
  enter?: () => void
}

const kindOf = (s: State, id: string) => s.nodes.find((n) => n.id === id)?.data.kind
const has = (s: State, kind: Kind) => s.nodes.some((n) => n.data.kind === kind)
const linked = (s: State, a: Kind, b: Kind) => s.edges.some((e) => kindOf(s, e.source) === a && kindOf(s, e.target) === b)
const first = (kind: Kind) => useStore.getState().nodes.find((n) => n.data.kind === kind)?.id

const place = (kind: Kind, x: number) => () => {
  const s = useStore.getState()
  if (!has(s, kind)) s.addNode(kind, { x, y: 160 })
}
const connect = (a: Kind, b: Kind) => () => {
  const src = first(a)
  const dst = first(b)
  if (src && dst) useStore.getState().onConnect({ source: src, target: dst, sourceHandle: null, targetHandle: null })
}
const handle = (kind: Kind, side: 'source' | 'target') => `.react-flow__node[data-id^="${kind === 'database' ? 'db' : kind}-"] .react-flow__handle.${side}`
const tab = (t: State['tab']) => () => useStore.getState().setTab(t)

const drag = (kind: Kind, why: string, x: number): Step => ({
  title: `Drag ${/^[AEIOU]/.test(technologies[kind].name) ? 'an' : 'a'} ${technologies[kind].name} onto the canvas`,
  body: why,
  target: `palette-${kind}`,
  placement: 'right',
  dim: false,
  done: (s) => has(s, kind),
  auto: place(kind, x),
  demo: { from: `[data-tour="palette-${kind}"]`, to: '[data-tour="canvas"]', label: `${technologies[kind].icon} ${technologies[kind].short}` },
})

export const steps: Step[] = [
  {
    title: 'Welcome to System Design Lab 👋',
    body: 'You’ll learn system design by building real architectures, sending traffic through them, and breaking them. This 2-minute walkthrough shows you every part of the lab. You’ll build your first system as you go.',
    placement: 'center',
  },
  {
    title: 'This is your component library',
    body: 'Every block here behaves like the real technology. Servers get overloaded, caches hit and miss, databases slow down under load, and load balancers route around failures.',
    target: 'palette',
    placement: 'right',
  },
  drag('client', 'A Client is the user’s browser or app. It starts every request. Press and hold it, then drop it anywhere on the dark canvas.', 40),
  drag('server', 'An Application Server receives requests and runs your business logic. Drop it to the right of the client.', 330),
  drag('database', 'The Database is where data lives, and usually the slowest part of a request. Drop it to the right of the server.', 620),
  {
    title: 'Connect Client → Server',
    body: 'Connections are the paths requests travel. Drag from the dot on the Client’s right edge to the dot on the Server’s left edge.',
    target: 'canvas',
    placement: 'inset',
    dim: false,
    done: (s) => linked(s, 'client', 'server'),
    auto: connect('client', 'server'),
    demo: { from: handle('client', 'source'), to: handle('server', 'target') },
  },
  {
    title: 'Connect Server → Database',
    body: 'Now give the server access to data: drag from the Server’s right dot to the Database’s left dot.',
    target: 'canvas',
    placement: 'inset',
    dim: false,
    done: (s) => linked(s, 'server', 'database'),
    auto: connect('server', 'database'),
    demo: { from: handle('server', 'source'), to: handle('database', 'target') },
  },
  {
    title: 'Click the Server',
    body: 'Select any component to learn about it and configure it. Click the Server box on the canvas.',
    target: 'canvas',
    placement: 'inset',
    dim: false,
    done: (s) => kindOf(s, s.selectedId ?? '') === 'server',
    auto: () => {
      const id = first('server')
      if (id) useStore.getState().select(id)
    },
  },
  {
    title: 'This is the Inspector',
    body: 'It explains what the selected component is, how it works, its trade-offs and how it fails, and lets you configure it. Everything here is also used by the simulator.',
    target: 'inspector',
    placement: 'left',
    enter: tab('learn'),
  },
  {
    title: 'Run your system',
    body: 'Press Simulate (or the Space key) to send 10 requests through what you just built.',
    target: 'simulate',
    placement: 'bottom',
    done: (s) => !!s.run,
    auto: () => useStore.getState().simulate(),
  },
  {
    title: 'Watch it work',
    body: 'Blue dots are requests and green dots are responses. The timeline lists every step the simulator took. When the run ends you get latency, errors and database load, plus notes on what happened.',
    target: 'dock',
    placement: 'top',
  },
  {
    title: 'The Failure Lab',
    body: 'Real systems break. Kill components, slow the network or spike traffic, then watch how your design reacts. Try crashing your only server later.',
    target: 'tab-lab',
    placement: 'left',
    enter: tab('lab'),
  },
  {
    title: 'Your Tutor',
    body: 'The Tutor reviews your design as you build: single points of failure, bottlenecks, missing pieces. It suggests experiments that prove each point.',
    target: 'tab-tutor',
    placement: 'left',
    enter: tab('tutor'),
  },
  {
    title: 'Missions: Beginner to Senior',
    body: 'Missions give you requirements like traffic, failures and budget, and the simulator checks your design. They go from your first request up to senior-level design scenarios.',
    target: 'nav-missions',
    placement: 'bottom',
  },
]

/** Polls an element's position so the spotlight follows layout changes. */
function useRect(selector?: string) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    let prev = ''
    const read = () => {
      const r = selector ? document.querySelector(selector)?.getBoundingClientRect() : undefined
      const key = r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` : ''
      if (key !== prev) {
        prev = key
        setRect(r ?? null)
      }
    }
    read()
    const id = setInterval(read, 150)
    return () => clearInterval(id)
  }, [selector])
  return rect
}

function Ghost({ from, to, label }: { from: string; to: string; label?: string }) {
  const a = useRect(from)
  const b = useRect(to)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!a || !b || !el) return
    const [fx, fy] = [a.x + a.width / 2, a.y + a.height / 2]
    const [tx, ty] = [b.x + b.width / 2, b.y + b.height / 2]
    const at = (x: number, y: number, scale: number, opacity: number, offset?: number) => ({ transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity, offset })
    const anim = el.animate(
      [at(fx, fy, 1, 0, 0), at(fx, fy, 0.92, 1, 0.12), at(fx, fy, 0.92, 1, 0.22), at(tx, ty, 0.92, 1, 0.72), at(tx, ty, 1, 1, 0.82), at(tx, ty, 1, 0, 1)],
      { duration: 2600, iterations: Infinity, easing: 'ease-in-out' },
    )
    return () => anim.cancel()
  }, [a, b])
  if (!a || !b) return null
  return (
    <div ref={ref} className="tour-ghost" aria-hidden>
      {label ? <span className="ghost-chip">{label}</span> : <span className="ghost-dot" />}
      <span className="ghost-hand">👆</span>
    </div>
  )
}

export function Tour() {
  const index = useStore((s) => s.tourStep)
  const step = index === null ? undefined : steps[index]
  const satisfied = useStore((s) => !!step?.done?.(s))
  const rect = useRect(step?.target ? `[data-tour="${step.target}"]` : undefined)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(220)
  const { setTourStep, endTour, setView } = useStore.getState()

  useEffect(() => {
    step?.enter?.()
  }, [step])

  // Action steps advance themselves shortly after the student completes them.
  useEffect(() => {
    if (index === null || !satisfied) return
    const id = setTimeout(() => setTourStep(index + 1), 900)
    return () => clearTimeout(id)
  }, [satisfied, index, setTourStep])

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight)
  })

  if (index === null || !step) return null
  const last = index === steps.length - 1
  const next = () => (last ? endTour(true) : setTourStep(index + 1))
  const pad = 6
  const W = 340

  let pos: CSSProperties = {}
  if (step.placement === 'center' || !rect) {
    pos = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  } else {
    const m = 16
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = rect.left
    let y = rect.top
    if (step.placement === 'right') x = rect.right + m
    if (step.placement === 'left') x = rect.left - W - m
    if (step.placement === 'bottom') y = rect.bottom + m
    if (step.placement === 'top') y = rect.top - cardH - m
    // Canvas steps sit in the bottom-left corner, away from where nodes usually are.
    if (step.placement === 'inset') [x, y] = [rect.left + m, rect.bottom - cardH - m]
    pos = { left: Math.min(Math.max(12, x), vw - W - 12), top: Math.min(Math.max(12, y), vh - cardH - 12) }
  }

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      {step.placement === 'center' && <div className="tour-backdrop" />}
      {rect && step.placement !== 'center' && (
        <div
          className={`spotlight ${step.dim === false ? 'ring-only' : ''} ${satisfied ? 'ok' : ''}`}
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      )}
      {step.demo && !satisfied && <Ghost key={`ghost-${index}`} {...step.demo} />}

      <div ref={cardRef} className={`tour-card glass ${step.placement === 'center' ? 'big' : ''}`} style={{ ...pos, width: step.placement === 'center' ? 480 : W }} key={`card-${index}`}>
        <div className="tour-meta">
          <div className="tour-dots">
            {steps.map((_, i) => <i key={i} className={i < index ? 'past' : i === index ? 'now' : ''} />)}
          </div>
          <span>{index + 1} / {steps.length}</span>
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="link" onClick={() => endTour()}>Skip tour</button>
          <div className="spacer" />
          {index > 0 && !step.done && <button className="ghost sm" onClick={() => setTourStep(index - 1)}>Back</button>}
          {step.done ? (
            satisfied ? (
              <span className="tour-ok">✓ Nice!</span>
            ) : (
              <>
                <span className="tour-wait"><i /> Your turn</span>
                {step.auto && <button className="ghost sm" onClick={step.auto}>Do it for me</button>}
              </>
            )
          ) : last ? (
            <>
              <button className="ghost sm" onClick={() => endTour(true)}>Keep building</button>
              <button className="primary sm" onClick={() => { endTour(true); setView('missions') }}>See missions →</button>
            </>
          ) : (
            <button className="primary sm" onClick={next}>{index === 0 ? 'Start the tour →' : 'Next →'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
