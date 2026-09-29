import { Background, Handle, Position, ReactFlow, ReactFlowProvider, getNodesBounds, getViewportForBounds, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { toPng } from 'html-to-image'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, type SavedDesign } from '../api'
import { achievements } from '../data/achievements'
import { buildGraph, challenges } from '../data/challenges'
import { technologies } from '../data/technologies'
import { grade, scoreDesign } from '../engine/score'
import type { Architecture, Kind } from '../engine/types'
import { evaluateChallenge, infraCost } from '../engine/validation'
import { parseDesign } from '../store/share'
import { useStore, type Outcome } from '../store/store'
import { accent } from './Canvas'

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal glass ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost round" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const download = (href: string, name: string) => {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
}

// ---------- predict-then-run ----------

export function PredictDialog() {
  const predicting = useStore((s) => s.predicting)
  const nodes = useStore((s) => s.nodes)
  const stats = useStore((s) => s.stats)
  const { confirmPrediction, setPredictMode } = useStore.getState()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [bottleneck, setBottleneck] = useState('none')
  if (!predicting) return null
  const candidates = nodes.filter((n) => typeof n.data.config.capacity === 'number' && n.data.state === 'healthy')
  const choices: [Outcome, string, string][] = [
    ['all', '✅', 'Every request succeeds'],
    ['some', '⚠️', 'Some requests fail'],
    ['none', '❌', 'Everything fails'],
  ]
  const go = (withPrediction: boolean) => {
    confirmPrediction(withPrediction && outcome ? { outcome, bottleneck } : null)
    setOutcome(null)
    setBottleneck('none')
  }
  return (
    <Dialog title="🔮 Predict first" onClose={() => go(false)}>
      <p className="muted">Commit to a guess before you watch. Comparing your guess with what actually happens is how the lesson sticks.</p>
      <h4>What will happen?</h4>
      <div className="choice-grid">
        {choices.map(([k, icon, label]) => (
          <button key={k} className={`choice ${outcome === k ? 'on' : ''}`} onClick={() => setOutcome(k)}><span>{icon}</span>{label}</button>
        ))}
      </div>
      <h4>Which component will be pushed past its capacity first?</h4>
      <select className="select" value={bottleneck} onChange={(e) => setBottleneck(e.target.value)}>
        <option value="none">None, everything has enough capacity</option>
        {candidates.map((n) => <option key={n.id} value={n.id}>{technologies[n.data.kind].icon} {n.id}</option>)}
      </select>
      <div className="row">
        <button className="primary" disabled={!outcome} onClick={() => go(true)}>Lock in & simulate</button>
        <button className="ghost" onClick={() => go(false)}>Just run it</button>
        <div className="spacer" />
        <button className="link" onClick={() => { setPredictMode(false); go(false) }}>Don’t ask again</button>
      </div>
      {stats.predictions > 0 && <p className="muted small">Your record: {stats.correct} of {stats.predictions} predictions fully correct.</p>}
    </Dialog>
  )
}

// ---------- design library, sharing and export ----------

export function LibraryModal() {
  const open = useStore((s) => s.modal === 'library')
  const library = useStore((s) => s.library)
  const user = useStore((s) => s.user)
  const nodeCount = useStore((s) => s.nodes.length)
  const { setModal, saveToLibrary, deleteFromLibrary, importDesign, shareLink, exportDesign, toast } = useStore.getState()
  const [name, setName] = useState('')
  const [cloud, setCloud] = useState<SavedDesign[] | null>(null)
  const [link, setLink] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !user) return
    api.designs().then(setCloud, () => setCloud([]))
  }, [open, user])
  if (!open) return null
  const close = () => {
    setModal(null)
    setLink('')
  }

  const exportPng = async () => {
    const el = document.querySelector<HTMLElement>('.react-flow__viewport')
    const nodes = useStore.getState().nodes
    if (!el || !nodes.length) return toast('Nothing to export yet', 'info')
    const [w, h] = [1600, 1000]
    const vp = getViewportForBounds(getNodesBounds(nodes), w, h, 0.2, 2, 0.12)
    try {
      const url = await toPng(el, { backgroundColor: '#070b16', width: w, height: h, style: { width: `${w}px`, height: `${h}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` } })
      download(url, 'architecture.png')
    } catch {
      toast('PNG export failed in this browser', 'bad')
    }
  }
  const exportJson = () => download(`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(exportDesign(), null, 2))}`, 'architecture.json')
  const importJson = async (file: File) => {
    try {
      const d = parseDesign(JSON.parse(await file.text()))
      if (!d) throw new Error()
      importDesign(d)
      toast(`Imported ${d.nodes.length} components`, 'good')
      close()
    } catch {
      toast('That file isn’t a System Design Lab design', 'bad')
    }
  }
  const copyLink = async () => {
    const url = shareLink()
    setLink(url)
    try {
      await navigator.clipboard.writeText(url)
      toast('🔗 Link copied', 'good')
    } catch {
      /* clipboard blocked: the link is shown for manual copy */
    }
  }

  return (
    <Dialog title="💾 Designs" onClose={close} wide>
      <div className="lib-grid">
        <section>
          <h4>Save this design</h4>
          <div className="row">
            <input className="input grow" placeholder="Name, e.g. “Chat v2 with replicas”" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && nodeCount && (saveToLibrary(name.trim()), setName(''))} />
            <button className="primary" disabled={!name.trim() || !nodeCount} onClick={() => { saveToLibrary(name.trim()); setName('') }}>Save</button>
          </div>
          <p className="muted small">{user ? 'Saved on this device and to your account.' : 'Saved on this device. Sign in to keep designs in your account.'}</p>

          <h4>Share & export</h4>
          <div className="export-grid">
            <button onClick={copyLink} disabled={!nodeCount}>🔗 Copy share link</button>
            <button onClick={exportPng} disabled={!nodeCount}>🖼 Export PNG</button>
            <button onClick={exportJson} disabled={!nodeCount}>{'{ }'} Export JSON</button>
            <button onClick={() => fileRef.current?.click()}>📂 Import JSON</button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          {link && <input className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Share link" />}
          <p className="muted small">The link contains the whole design, so anyone can open it without an account.</p>
        </section>

        <section>
          <h4>On this device</h4>
          {library.length === 0 && <p className="muted small">No saved designs yet.</p>}
          <ul className="lib-list">
            {library.map((d) => (
              <li key={d.id}>
                <div className="grow">
                  <b>{d.name}</b>
                  <small>{d.design.nodes.length} components · {new Date(d.savedAt).toLocaleString()}</small>
                </div>
                <button className="sm" onClick={() => { importDesign(d.design); close() }}>Open</button>
                <button className="sm ghost danger" onClick={() => deleteFromLibrary(d.id)} aria-label={`Delete ${d.name}`}>🗑</button>
              </li>
            ))}
          </ul>
          {user && (
            <>
              <h4>In your account</h4>
              {cloud === null ? <p className="muted small">Loading…</p> : cloud.length === 0 ? <p className="muted small">Nothing saved to your account yet.</p> : (
                <ul className="lib-list">
                  {cloud.map((d) => {
                    const design = parseDesign(d.design)
                    return (
                      <li key={d.id}>
                        <div className="grow"><b>{d.name}</b><small>{new Date(d.updated_at).toLocaleString()}</small></div>
                        <button className="sm" disabled={!design} onClick={() => { if (design) { importDesign(design); close() } }}>Open</button>
                        <button className="sm ghost danger" onClick={() => api.deleteDesign(d.id).then(() => setCloud(cloud.filter((x) => x.id !== d.id)))} aria-label={`Delete ${d.name}`}>🗑</button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </Dialog>
  )
}

// ---------- achievements ----------

export function AchievementsModal() {
  const open = useStore((s) => s.modal === 'achievements')
  const unlocked = useStore((s) => s.achievements)
  const stats = useStore((s) => s.stats)
  const setModal = useStore.getState().setModal
  if (!open) return null
  return (
    <Dialog title={`🏅 Achievements ${unlocked.length}/${achievements.length}`} onClose={() => setModal(null)} wide>
      <div className="progress"><div style={{ width: `${(unlocked.length / achievements.length) * 100}%` }} /></div>
      <div className="ach-grid">
        {achievements.map((a) => {
          const got = unlocked.includes(a.id)
          return (
            <div key={a.id} className={`ach ${got ? 'got' : ''}`}>
              <span className="ach-icon">{got ? a.icon : '🔒'}</span>
              <div><b>{a.title}</b><p>{a.description}</p></div>
            </div>
          )
        })}
      </div>
      <p className="muted small">Predictions: {stats.correct} of {stats.predictions} fully correct · Components killed: {stats.kills}</p>
    </Dialog>
  )
}

// ---------- account ----------

export function AccountModal() {
  const open = useStore((s) => s.modal === 'account')
  const user = useStore((s) => s.user)
  const { setModal, signIn, signOut, setView, completed, achievements: a, missionStats } = useStore.getState()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'student' as 'student' | 'teacher' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open) return null

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const res = mode === 'login'
        ? await api.login({ email: form.email, password: form.password })
        : await api.signup({ ...form, progress: { completed, achievements: a, missions: missionStats } })
      signIn(res.user, res.token)
      setModal(null)
      useStore.getState().toast(`👋 Signed in as ${res.user.name}`, 'good')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (user) {
    return (
      <Dialog title="Your account" onClose={() => setModal(null)}>
        <div className="account-card">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <div><b>{user.name}</b><p className="muted small">{user.email} · {user.role}</p></div>
        </div>
        <p className="muted small">Your missions, hints and achievements sync to this account on every device.</p>
        <div className="row">
          <button className="primary" onClick={() => { setModal(null); setView('classroom') }}>{user.role === 'teacher' ? '🏫 Open teacher dashboard' : '🏫 My classes'}</button>
          <button className="ghost" onClick={() => { signOut(); setModal(null) }}>Sign out</button>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog title={mode === 'login' ? 'Sign in' : 'Create an account'} onClose={() => setModal(null)}>
      <div className="seg">
        <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
        <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Create account</button>
      </div>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        {mode === 'signup' && (
          <label>Name<input className="input" required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
        )}
        <label>Email<input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></label>
        <label>Password<input className="input" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {mode === 'signup' && (
          <div className="seg">
            <button type="button" className={form.role === 'student' ? 'on' : ''} onClick={() => setForm({ ...form, role: 'student' })}>🎓 I’m a student</button>
            <button type="button" className={form.role === 'teacher' ? 'on' : ''} onClick={() => setForm({ ...form, role: 'teacher' })}>🏫 I’m a teacher</button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="muted small">{mode === 'signup' ? 'Progress you’ve made on this device is carried into the new account.' : 'Accounts sync progress across devices and let you join a class.'}</p>
    </Dialog>
  )
}

// ---------- compare with sample solution ----------

function MiniNode({ data }: NodeProps<Node<{ kind: Kind; label: string }>>) {
  const t = technologies[data.kind]
  return (
    <div className="mini-node" style={accent(t.color)}>
      {data.kind !== 'client' && <Handle type="target" position={Position.Left} />}
      <span>{t.icon}</span>
      <b>{data.label}</b>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
const miniTypes = { mini: MiniNode }

/** Layered left-to-right layout: column = longest path from a client. */
function layout(arch: Architecture) {
  const depth = new Map<string, number>(arch.nodes.filter((n) => n.kind === 'client').map((n) => [n.id, 0]))
  for (let i = 0; i < arch.nodes.length; i++) {
    for (const e of arch.edges) {
      const d = depth.get(e.source)
      if (d !== undefined && (depth.get(e.target) ?? -1) < d + 1 && d + 1 < 12) depth.set(e.target, d + 1)
    }
  }
  const cols = new Map<number, string[]>()
  for (const n of arch.nodes) {
    const d = depth.get(n.id) ?? 0
    cols.set(d, [...(cols.get(d) ?? []), n.id])
  }
  const pos = new Map<string, { x: number; y: number }>()
  for (const [d, ids] of cols) ids.forEach((id, i) => pos.set(id, { x: d * 190, y: (i - (ids.length - 1) / 2) * 70 }))
  return {
    nodes: arch.nodes.map((n) => ({ id: n.id, type: 'mini', position: pos.get(n.id)!, data: { kind: n.kind, label: n.id }, draggable: false })),
    edges: arch.edges.map((e): Edge => ({ id: e.id, source: e.source, target: e.target, style: { stroke: '#64748b' } })),
  }
}

function Diagram({ arch }: { arch: Architecture }) {
  const g = useMemo(() => layout(arch), [arch])
  return (
    <div className="mini-canvas">
      <ReactFlowProvider>
        <ReactFlow nodes={g.nodes} edges={g.edges} nodeTypes={miniTypes} fitView fitViewOptions={{ padding: 0.15 }} nodesConnectable={false} elementsSelectable={false} panOnDrag zoomOnScroll={false} colorMode="dark" proOptions={{ hideAttribution: true }}>
          <Background gap={20} color="#1f2a40" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}

export function CompareModal() {
  const open = useStore((s) => s.modal === 'compare')
  const id = useStore((s) => s.challengeId)
  const setModal = useStore.getState().setModal
  const c = challenges.find((x) => x.id === id)
  const data = useMemo(() => {
    if (!open || !c) return null
    const mine = useStore.getState().toArchitecture()
    const sample = buildGraph(c, c.solution)
    const evalOf = (a: Architecture) => {
      const r = evaluateChallenge(a, c)
      return { ...r, cost: infraCost(a), scores: scoreDesign(a, r.metrics) }
    }
    return { mine, sample, a: evalOf(mine), b: evalOf(sample) }
  }, [open, c])
  if (!open || !c || !data) return null
  const fmt = (n: number) => Number(n.toFixed(2))
  return (
    <Dialog title={`Compare: ${c.title}`} onClose={() => setModal(null)} wide>
      <p className="muted">One sample solution next to yours, both run through the same mission scenario. The sample isn’t “the” answer. Look at where the trade-offs differ.</p>
      <div className="compare">
        <div>
          <h4>Your design {data.a.passed ? '✅' : '❌'}</h4>
          {data.mine.nodes.length ? <Diagram arch={data.mine} /> : <div className="mini-canvas empty-mini">Empty canvas</div>}
        </div>
        <div>
          <h4>Sample solution ✅</h4>
          <Diagram arch={data.sample} />
        </div>
      </div>
      <table className="cmp-table">
        <thead><tr><th>Measure</th><th>You</th><th>Sample</th></tr></thead>
        <tbody>
          {c.objectives.map((o, i) => (
            <tr key={o.label}>
              <td>{o.label}</td>
              <td className={data.a.results[i].passed ? 'pass' : 'fail'}>{fmt(data.a.results[i].actual)}</td>
              <td className="pass">{fmt(data.b.results[i].actual)}</td>
            </tr>
          ))}
          <tr><td>Components</td><td>{data.mine.nodes.length}</td><td>{data.sample.nodes.length}</td></tr>
          <tr><td>Infrastructure cost</td><td>{data.a.cost}</td><td>{data.b.cost}</td></tr>
          {data.a.scores.map((s, i) => (
            <tr key={s.key}><td>{s.label}</td><td>{grade(s.value)} ({s.value})</td><td>{grade(data.b.scores[i].value)} ({data.b.scores[i].value})</td></tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  )
}

