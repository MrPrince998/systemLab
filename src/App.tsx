import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, hasToken } from './api'
import { BottomPanel } from './components/BottomPanel'
import { Canvas } from './components/Canvas'
import { ClassroomPage } from './components/ClassroomPage'
import { MissionsPage } from './components/MissionsPage'
import { AccountModal, AchievementsModal, CompareModal, LibraryModal, PredictDialog } from './components/Modals'
import { RightPanel } from './components/RightPanel'
import { Sidebar } from './components/Sidebar'
import { Tour } from './components/Tour'
import { achievements } from './data/achievements'
import { challenges } from './data/challenges'
import { infraCost } from './engine/validation'
import { usePlaybackTimer } from './store/playback'
import { decodeDesign } from './store/share'
import { useStore } from './store/store'

function Stepper({ label, value, min, max, step = 1, suffix = '', onChange, title }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void; title: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const inc = step > 1 ? step : value >= 20 ? 10 : 1
  return (
    <div className="stepper-input" title={title}>
      <span>{label}</span>
      <button onClick={() => onChange(clamp(value - inc))} aria-label={`Decrease ${label}`}>−</button>
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(clamp(Number(e.target.value) || min))} aria-label={label} />
      {suffix && <em>{suffix}</em>}
      <button onClick={() => onChange(clamp(value + inc))} aria-label={`Increase ${label}`}>+</button>
    </div>
  )
}

function Menu({ label, children, title }: { label: React.ReactNode; children: React.ReactNode; title: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <button className="ghost" onClick={() => setOpen(!open)} aria-expanded={open} title={title}>{label}</button>
      {open && <div className="menu-pop glass" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  )
}

function Toolbar() {
  const opts = useStore((s) => s.opts)
  const playing = useStore((s) => s.playing)
  const hasRun = useStore((s) => !!s.run)
  const done = useStore((s) => s.completed.length)
  const view = useStore((s) => s.view)
  const nodes = useStore((s) => s.nodes)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const predictMode = useStore((s) => s.predictMode)
  const muted = useStore((s) => s.muted)
  const user = useStore((s) => s.user)
  const unlocked = useStore((s) => s.achievements.length)
  const { simulate, setOpts, resetCache, setHelp, setView, undo, redo, setPredictMode, setMuted, setModal } = useStore.getState()
  const cost = useMemo(() => infraCost({ nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, state: n.data.state, config: n.data.config })), edges: [] }), [nodes])
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo">◆</span>
        <span className="brand-text">System Design <b>Lab</b></span>
      </div>
      <nav className="nav" aria-label="Main">
        <button data-tour="nav-missions" className={view === 'missions' ? 'on' : ''} onClick={() => setView('missions')}>🗺 <span>Missions</span></button>
        <button className={view === 'build' ? 'on' : ''} onClick={() => setView('build')}>🛠 <span>Build</span></button>
        {user && <button className={view === 'classroom' ? 'on' : ''} onClick={() => setView('classroom')}>🏫 <span>Class</span></button>}
      </nav>
      {view === 'build' && (
        <>
          <span className="divider" />
          <button data-tour="simulate" className={`primary simulate ${playing ? 'running' : ''}`} onClick={() => simulate()} title="Simulate (Space)">
            {playing ? <><span className="spinner" /> Running…</> : '▶ Simulate'}
          </button>
          <div className="traffic">
            <Stepper label="Req/s" value={opts.requests} min={1} max={500} onChange={(v) => setOpts({ requests: v })} title="How many requests users send in one second" />
            <Stepper label="Pages" value={opts.keyspace} min={1} max={500} onChange={(v) => setOpts({ keyspace: v })} title="How many different things users ask for. Fewer means more cache hits." />
            <Stepper label="Writes" value={Math.round((opts.writeRatio ?? 0) * 100)} min={0} max={100} step={10} suffix="%" onChange={(v) => setOpts({ writeRatio: v / 100 })} title="Share of requests that change data (posts, uploads, payments)" />
          </div>
          <div className="icon-group">
            <button className="ghost icon-btn" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">↶</button>
            <button className="ghost icon-btn" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)" aria-label="Redo">↷</button>
            {hasRun && <button className="ghost icon-btn" onClick={resetCache} title="Clear caches, queues and results" aria-label="Reset simulation state">↺</button>}
          </div>
        </>
      )}
      <div className="spacer" />
      {view === 'build' && <span className="badge" title="Infrastructure cost of your design">💰 {cost}</span>}
      <button className="badge opt" onClick={() => setView('missions')} title="Missions completed">🏆 {done}/{challenges.length}</button>
      <button className="badge opt" onClick={() => setModal('achievements')} title="Achievements">🏅 {unlocked}/{achievements.length}</button>
      {view === 'build' && <button className="ghost" onClick={() => setModal('library')} title="Save, share and export designs">💾 <span className="hide-sm">Designs</span></button>}
      <Menu label="⚙️" title="Settings">
        <button className="menu-item" onClick={() => setPredictMode(!predictMode)}>{predictMode ? '☑' : '☐'} Ask me to predict before each run</button>
        <button className="menu-item" onClick={() => setMuted(!muted)}>{muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
        <button className="menu-item" onClick={() => setModal('achievements')}>🏅 Achievements ({unlocked}/{achievements.length})</button>
        <button className="menu-item" onClick={() => setView('missions')}>🏆 Missions ({done}/{challenges.length})</button>
        <button className="menu-item" onClick={() => setHelp(true)}>⌨️ Shortcuts & help</button>
      </Menu>
      <button className={`account-btn ${user ? 'in' : ''}`} onClick={() => setModal('account')} title={user ? `${user.name} (${user.role})` : 'Sign in'}>
        {user ? <span className="avatar sm">{user.name.slice(0, 1).toUpperCase()}</span> : 'Sign in'}
      </button>
    </header>
  )
}

function Help() {
  const open = useStore((s) => s.help)
  const { setHelp, startTour } = useStore.getState()
  if (!open) return null
  const keys = [
    ['Space', 'Simulate / pause'],
    ['→', 'Step one event'],
    ['⌘/Ctrl Z', 'Undo'],
    ['⌘/Ctrl ⇧ Z', 'Redo'],
    ['K', 'Kill or recover selected node'],
    ['D', 'Duplicate selected node'],
    ['Backspace', 'Delete selected node or connection'],
    ['1 – 4', 'Inspect · Tutor · Failure Lab · Mission'],
    ['Esc', 'Deselect / close'],
    ['?', 'This help'],
  ]
  return (
    <div className="modal-bg" onClick={() => setHelp(false)}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h3>Keyboard shortcuts</h3>
        <dl className="keys">
          {keys.map(([k, v]) => (
            <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
          ))}
        </dl>
        <h3>How to connect components</h3>
        <p className="muted">Drag from the dot on a node’s right edge to the dot on another node’s left edge. Click a connection and press Backspace to remove it. On touch screens, tap a component in the list to add it.</p>
        <div className="row">
          <button className="primary" onClick={() => setHelp(false)}>Got it</button>
          <button className="ghost" onClick={startTour}>▶ Replay the walkthrough</button>
        </div>
        <p className="muted small">Replaying the walkthrough starts from an empty sandbox. Your mission drafts are kept.</p>
      </div>
    </div>
  )
}

function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore.getState().dismissToast
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.tone}`} onClick={() => dismiss(t.id)}>{t.text}</button>
      ))}
    </div>
  )
}

function Confetti() {
  const winKey = useStore((s) => s.winKey)
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 10) * 60,
        dur: 1600 + ((i * 53) % 900),
        color: ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'][i % 5],
        rot: (i * 47) % 360,
      })),
    [],
  )
  if (!winKey) return null
  return (
    <div className="confetti" key={winKey} aria-hidden>
      {pieces.map((p, i) => (
        <i key={i} style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}ms`, animationDuration: `${p.dur}ms`, rotate: `${p.rot}deg` }} />
      ))}
    </div>
  )
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest('input, textarea, select, [contenteditable]')) return
      const s = useStore.getState()
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && s.view === 'build') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (s.view !== 'build' && e.key !== '?' && e.key !== 'Escape') return
      if (s.predicting || s.modal) {
        if (e.key === 'Escape') s.predicting ? s.confirmPrediction(null) : s.setModal(null)
        return
      }
      const sel = s.nodes.find((n) => n.id === s.selectedId)
      switch (e.key) {
        case ' ':
          e.preventDefault()
          if (s.playing) s.setPlay(false)
          else if (s.run && s.playIndex < s.run.events.length) s.setPlay(true)
          else s.simulate()
          break
        case 'ArrowRight':
          if (s.run) s.step()
          break
        case 'k':
        case 'K':
          if (sel && sel.data.kind !== 'client') s.setState(sel.id, sel.data.state === 'failed' ? 'healthy' : 'failed')
          break
        case 'd':
        case 'D':
          if (sel) s.duplicate(sel.id)
          break
        case '1': s.setTab('learn'); break
        case '2': s.setTab('tutor'); break
        case '3': s.setTab('lab'); break
        case '4': s.setTab('challenge'); break
        case '?':
          s.setHelp(!s.help)
          break
        case 'Escape':
          if (s.help) s.setHelp(false)
          else if (s.tourStep !== null) s.endTour()
          else s.select(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Opens a design from a share link (#d=…), and reconnects to the server if it's running. */
function useStartup() {
  useEffect(() => {
    const openShared = () => {
      const token = new URLSearchParams(location.hash.slice(1)).get('d')
      if (!token) return
      const s = useStore.getState()
      const design = decodeDesign(token)
      history.replaceState(null, '', location.pathname + location.search)
      if (!design) return s.toast('That share link is broken or incomplete', 'bad')
      if (design.mission && challenges.some((c) => c.id === design.mission)) s.startChallenge(design.mission)
      else s.setView('build')
      s.importDesign(design)
      s.setTourStep(null)
      s.toast(`🔗 Opened a shared design with ${design.nodes.length} components`, 'good')
    }
    openShared()
    // A link pasted into an already-open tab only changes the hash.
    window.addEventListener('hashchange', openShared)
    api.health().then((h) => useStore.setState({ serverAi: h.ai }), () => useStore.setState({ serverAi: null }))
    if (hasToken()) useStore.getState().refreshAccount()
    return () => window.removeEventListener('hashchange', openShared)
  }, [])
}

export default function App() {
  const view = useStore((s) => s.view)
  usePlaybackTimer()
  useShortcuts()
  useStartup()
  return (
    <ReactFlowProvider>
      <div className={`app ${view}`}>
        <Toolbar />
        {view === 'missions' ? (
          <MissionsPage />
        ) : view === 'classroom' ? (
          <ClassroomPage />
        ) : (
          <>
            <Sidebar />
            <main className="workspace">
              <Canvas />
              <BottomPanel />
            </main>
            <RightPanel />
          </>
        )}
      </div>
      <Toasts />
      <Confetti />
      <Tour />
      <Help />
      <PredictDialog />
      <LibraryModal />
      <AchievementsModal />
      <AccountModal />
      <CompareModal />
    </ReactFlowProvider>
  )
}
