import { useEffect, useMemo, useRef, useState } from 'react'
import { challenges, FIXED_FIELDS, levels, nextMission } from '../data/challenges'
import { kindOrder, technologies, type Technology } from '../data/technologies'
import { reviewArchitecture } from '../engine/review'
import { grade, scoreDesign } from '../engine/score'
import type { Kind } from '../engine/types'
import { useStore, type Tab } from '../store/store'
import { accent } from './Canvas'

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

function Section({ title, items, tone, open }: { title: string; items: string[]; tone: string; open?: boolean }) {
  return (
    <details className={`sec ${tone}`} open={open}>
      <summary>{title}</summary>
      <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </details>
  )
}

function Guide() {
  return (
    <div className="pad">
      <h3>Component guide</h3>
      <p className="muted">Select a node on the canvas to inspect, configure and break it. Each component behaves differently in the simulation.</p>
      <div className="guide">
        {kindOrder.map((k) => {
          const t = technologies[k]
          return (
            <div key={k} className="guide-item" style={accent(t.color)}>
              <span className="palette-icon">{t.icon}</span>
              <div><b>{t.name}</b><p>{t.definition}</p></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Learn() {
  const selectedId = useStore((s) => s.selectedId)
  const node = useStore((s) => s.nodes.find((n) => n.id === selectedId))
  const inMission = useStore((s) => !!s.challengeId)
  const { setConfig, duplicate, deleteNode, setState, setTab } = useStore.getState()
  if (!node) return <Guide />
  const t: Technology = technologies[node.data.kind]
  const failed = node.data.state === 'failed'
  return (
    <div className="pad">
      <div className="hero" style={accent(t.color)}>
        <div className="hero-icon">{t.icon}</div>
        <div>
          <h3>{t.name}</h3>
          <span className="muted small">{node.id}</span> <span className={`pill ${failed ? 'down' : 'up'}`}>{failed ? 'DOWN' : 'UP'}</span>
        </div>
      </div>
      <p className="lead">{t.definition}</p>
      <div className="actions">
        <button onClick={() => duplicate(node.id)} title="Duplicate (D)">⧉ Duplicate</button>
        {node.data.kind !== 'client' && (
          <button className={failed ? 'good' : 'danger'} onClick={() => setState(node.id, failed ? 'healthy' : 'failed')} title="Kill / recover (K)">
            {failed ? '♻️ Recover' : '💥 Kill'}
          </button>
        )}
        <button className="danger" onClick={() => deleteNode(node.id)} title="Delete (Backspace)">🗑 Delete</button>
      </div>

      {t.fields.length > 0 && (
        <div className="card">
          <h4>Configure</h4>
          {t.fields.map((f) => {
            const v = node.data.config[f.key]
            if (inMission && FIXED_FIELDS.includes(f.key)) {
              return (
                <div key={f.key} className="field inline fixed" title="Hardware is fixed by the mission. Change the architecture instead.">
                  <div><b>{f.label}</b><small>🔒 Fixed by this mission’s hardware</small></div>
                  <output>{Number(v)}</output>
                </div>
              )
            }
            return f.type === 'boolean' ? (
              <div key={f.key} className="field inline">
                <div><b>{f.label}</b><small>{f.hint}</small></div>
                <Switch on={v === true} label={f.label} onChange={(on) => setConfig(node.id, f.key, on)} />
              </div>
            ) : (
              <label key={f.key} className="field">
                <div className="field-head"><b>{f.label}</b><output>{Number(v)}</output></div>
                <input type="range" min={f.min} max={f.max} step={f.step} value={Number(v)} onChange={(e) => setConfig(node.id, f.key, Number(e.target.value))} />
                <small>{f.hint}</small>
              </label>
            )
          })}
        </div>
      )}

      <h4>How it works</h4>
      <ol className="steps">{t.howItWorks.map((s) => <li key={s}>{s}</li>)}</ol>

      <h4>Key concepts</h4>
      <div className="chips">{t.concepts.map((c) => <span key={c} className="chip">{c}</span>)}</div>

      <Section title="✅ Strengths" items={t.strengths} tone="good" open />
      <Section title="⚖️ Trade-offs" items={t.tradeoffs} tone="warn" />
      <Section title="💥 Failure modes" items={t.failureModes} tone="bad" />

      <div className="try">
        <b>🧪 Try it</b>
        <p>{t.tryIt}</p>
        <button className="ghost sm" onClick={() => setTab('lab')}>Open Failure Lab →</button>
      </div>
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function ScoreCard() {
  const run = useStore((s) => s.run)
  const stale = useStore((s) => s.stale)
  const nodes = useStore((s) => s.nodes)
  const scores = useMemo(() => (run ? scoreDesign(useStore.getState().toArchitecture(), run.metrics) : null), [run, nodes])
  if (!scores) return <p className="muted small">Run a simulation to get a design score card.</p>
  return (
    <div className={`scorecard ${stale ? 'is-stale' : ''}`}>
      {scores.map((s) => (
        <div key={s.key} className="score-row" title={s.why}>
          <div className="score-head"><span>{s.label}</span><b className={grade(s.value).toLowerCase()}>{grade(s.value)}</b></div>
          <div className="score-bar"><div className={grade(s.value).toLowerCase()} style={{ width: `${s.value}%` }} /></div>
          <small>{s.why}</small>
        </div>
      ))}
      <p className="muted small">These don’t add up to one grade on purpose: improving one usually costs another.</p>
    </div>
  )
}

const starters = ['Why did requests fail in my last run?', 'What is my biggest single point of failure?', 'How would I handle 10× more traffic?']

function AiTutor() {
  const chat = useStore((s) => s.chat)
  const busy = useStore((s) => s.chatBusy)
  const user = useStore((s) => s.user)
  const ai = useStore((s) => s.serverAi)
  const { askTutor, clearChat, setModal } = useStore.getState()
  const [q, setQ] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => endRef.current?.scrollIntoView({ block: 'nearest' }), [chat.length, busy])
  const send = (text: string) => {
    if (!text.trim() || busy) return
    askTutor(text.trim())
    setQ('')
  }
  if (ai === false || ai === null) {
    return <p className="muted small">{ai === null ? 'The AI tutor needs the app server. Start it with `npm run dev`.' : 'The AI tutor is off: the server has no ANTHROPIC_API_KEY set.'}</p>
  }
  if (!user) {
    return (
      <div className="ai-cta">
        <p className="muted small">Sign in to ask the AI tutor questions about your design. It sees your architecture and last simulation.</p>
        <button className="ghost sm" onClick={() => setModal('account')}>Sign in</button>
      </div>
    )
  }
  return (
    <div className="chat">
      {chat.length === 0 && (
        <div className="starters">
          {starters.map((s) => <button key={s} className="chip-btn" onClick={() => send(s)}>{s}</button>)}
        </div>
      )}
      {chat.map((m, i) => (
        <div key={i} className={`msg ${m.role}`}>{m.content}</div>
      ))}
      {busy && <div className="msg assistant typing"><i /><i /><i /></div>}
      <div ref={endRef} />
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(q) }}>
        <input className="input grow" placeholder="Ask about your design…" value={q} maxLength={1000} onChange={(e) => setQ(e.target.value)} disabled={busy} />
        <button className="primary sm" disabled={!q.trim() || busy}>Ask</button>
      </form>
      {chat.length > 0 && <button className="link small" onClick={clearChat}>Clear conversation</button>}
    </div>
  )
}

function Tutor() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const run = useStore((s) => s.run)
  const { killAndSimulate, select } = useStore.getState()
  const items = useMemo(() => reviewArchitecture(useStore.getState().toArchitecture(), run?.metrics), [nodes, edges, run])
  const count = (t: string) => items.filter((i) => i.tone === t).length
  const icon = { warn: '⚠️', info: '💡', good: '✅' }
  return (
    <div className="pad">
      <h3>📊 Design score card</h3>
      <ScoreCard />
      <h3 className="mt">🤖 Ask the AI tutor</h3>
      <AiTutor />
      <h3 className="mt">🧭 Architecture review</h3>
      <p className="muted">Live feedback on what you’ve built. It points out risks and suggests experiments. Deciding the fix is up to you.</p>
      <div className="score">
        <span className="bad">{plural(count('warn'), 'risk')}</span>
        <span className="info">{plural(count('info'), 'idea')}</span>
        <span className="good">{plural(count('good'), 'strength')}</span>
      </div>
      {items.map((i) => (
        <div key={i.title} className={`review ${i.tone}`}>
          <div className="review-title">{icon[i.tone]} {i.title}</div>
          <p>{i.detail}</p>
          {i.kill && nodes.some((n) => n.id === i.kill && n.data.state === 'healthy') && (
            <button className="ghost sm" onClick={() => { select(i.kill!); killAndSimulate(i.kill!) }}>
              🧪 Test it: kill {i.kill} and simulate
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

const chaos: { icon: string; label: string; kind: Kind }[] = [
  { icon: '🖥️', label: 'Server crash', kind: 'server' },
  { icon: '🗄️', label: 'Database outage', kind: 'database' },
  { icon: '⚡', label: 'Cache outage', kind: 'cache' },
  { icon: '⚖️', label: 'LB goes down', kind: 'load-balancer' },
  { icon: '📑', label: 'Replica down', kind: 'replica' },
  { icon: '📬', label: 'Queue down', kind: 'queue' },
]

function Lab() {
  const nodes = useStore((s) => s.nodes)
  const opts = useStore((s) => s.opts)
  const { setState, recoverAll, setOpts, simulate, killAndSimulate } = useStore.getState()
  const killable = nodes.filter((n) => n.data.kind !== 'client')
  const anyBroken = killable.some((n) => n.data.state === 'failed') || opts.extraLatencyMs > 0 || opts.dropEveryN > 0
  return (
    <div className="pad">
      <h3>💥 Failure Lab</h3>
      <p className="muted">Break things on purpose. Predict what will happen first, then watch the simulation.</p>

      <h4>One-click chaos</h4>
      <div className="chaos">
        {chaos.map((c) => {
          const victim = nodes.find((n) => n.data.kind === c.kind && n.data.state === 'healthy')
          return (
            <button key={c.label} disabled={!victim} onClick={() => victim && killAndSimulate(victim.id)} title={victim ? `Kill ${victim.id} and simulate` : `No healthy ${c.kind} to break`}>
              <span>{c.icon}</span>{c.label}
            </button>
          )
        })}
        <button onClick={() => simulate({ requests: Math.min(500, opts.requests * 10) })}><span>📈</span>10× traffic spike</button>
        <button onClick={() => simulate({ extraLatencyMs: 100 })}><span>🐢</span>Slow network</button>
        <button onClick={() => simulate({ dropEveryN: 4 })}><span>📉</span>Flaky network</button>
        <button className="heal" disabled={!anyBroken} onClick={recoverAll}><span>♻️</span>Heal everything</button>
      </div>

      <h4>Component health</h4>
      {killable.length === 0 && <p className="muted small">Nothing to break yet.</p>}
      <div className="health-list">
        {killable.map((n) => {
          const up = n.data.state === 'healthy'
          return (
            <div key={n.id} className={`health ${up ? '' : 'down'}`}>
              <span>{technologies[n.data.kind].icon}</span>
              <span className="grow">{n.id}</span>
              <span className={`pill ${up ? 'up' : 'down'}`}>{up ? 'UP' : 'DOWN'}</span>
              <Switch on={up} label={`${n.id} healthy`} onChange={(on) => setState(n.id, on ? 'healthy' : 'failed')} />
            </div>
          )
        })}
      </div>

      <h4>Network conditions</h4>
      <label className="field">
        <div className="field-head"><b>Extra latency per hop</b><output>{opts.extraLatencyMs}ms</output></div>
        <input type="range" min={0} max={200} step={10} value={opts.extraLatencyMs} onChange={(e) => setOpts({ extraLatencyMs: Number(e.target.value) })} />
      </label>
      <label className="field">
        <div className="field-head"><b>Drop every Nth request</b><output>{opts.dropEveryN === 0 ? 'off' : `1 in ${opts.dropEveryN}`}</output></div>
        <input type="range" min={0} max={10} step={1} value={opts.dropEveryN} onChange={(e) => setOpts({ dropEveryN: Number(e.target.value) })} />
      </label>
    </div>
  )
}

function Mission() {
  const id = useStore((s) => s.challengeId)
  const level = useStore((s) => s.hintLevel)
  const result = useStore((s) => s.checkResult)
  const { checkChallenge, nextHint, startChallenge, setView, setModal } = useStore.getState()
  const c = challenges.find((x) => x.id === id)
  if (!c) {
    return (
      <div className="pad">
        <h3>🧪 Sandbox mode</h3>
        <p className="muted">Build anything you like. Missions give you requirements, from beginner to senior level, and the simulator checks your design.</p>
        <button className="primary" onClick={() => setView('missions')}>🗺 Browse missions</button>
      </div>
    )
  }
  const lv = levels.find((l) => l.id === c.level)!
  const next = nextMission(c.id)
  const specs = Object.entries(c.defaults ?? {}).flatMap(([kind, cfg]) =>
    Object.entries(cfg ?? {}).map(([k, v]) => {
      const t = technologies[kind as Kind]
      const label = t.fields.find((f) => f.key === k)?.label ?? k
      return `${t.icon} ${t.short}: ${typeof v === 'boolean' ? `${label} ${v ? 'on' : 'off'} by default` : `${label.replace(/ \(.*\)/, '')} ${v}`}`
    }),
  )
  return (
    <div className="pad">
      <span className="level-tag" style={accent(lv.color)}>{lv.icon} {lv.title}</span>
      <h3 style={{ marginTop: 6 }}>🎯 {c.title}</h3>
      <p className="lead">{c.brief}</p>

      <h4>Scenario</h4>
      <div className="chips">
        <span className="chip">📨 {c.scenario.requests} req/s</span>
        <span className="chip">🔑 {c.scenario.keyspace} distinct pages</span>
        {c.scenario.kill?.map((k, i) => <span key={i} className="chip bad">💥 a {technologies[k].short.toLowerCase()} crashes</span>)}
      </div>
      {specs.length > 0 && (
        <>
          <h4>Hardware</h4>
          <ul className="specs">{specs.map((s) => <li key={s}>{s}</li>)}</ul>
        </>
      )}

      <h4>Objectives</h4>
      <ul className="objectives">
        {c.objectives.map((o, i) => {
          const r = result?.results[i]
          return (
            <li key={o.label} className={r ? (r.passed ? 'pass' : 'fail') : ''}>
              <span className="check">{r ? (r.passed ? '✓' : '✗') : ''}</span>
              <span className="grow">{o.label}</span>
              {r && <small>{Number(r.actual.toFixed(2))}</small>}
            </li>
          )
        })}
      </ul>
      <button className="primary wide" onClick={checkChallenge}>Check my architecture</button>
      <p className="muted small">Checking replays the scenario above against your design{c.scenario.kill ? ', including the crashes' : ''}.</p>

      {result?.passed && (
        <div className="win">
          <b>🎉 Mission complete!</b>
          <p>Other architectures could also pass. Open the Tutor tab to see the trade-offs you made.</p>
          {next ? <button className="primary" onClick={() => startChallenge(next.id)}>Next: {next.title} →</button> : <button className="primary" onClick={() => setView('missions')}>Back to missions</button>}
        </div>
      )}

      {(result?.passed || level >= c.hints.length) && (
        <button className="ghost wide" onClick={() => setModal('compare')}>⚖️ Compare with a sample solution</button>
      )}

      <h4>Hints</h4>
      {c.hints.slice(0, level).map((h, i) => (
        <div key={i} className="hint"><span>Hint {i + 1}</span>{h}</div>
      ))}
      {level < c.hints.length ? (
        <button className="ghost" onClick={nextHint}>💡 {level === 0 ? 'I’m stuck, give me a hint' : 'A bigger hint'}</button>
      ) : (
        <p className="muted small">That’s every hint.</p>
      )}
    </div>
  )
}

export function RightPanel() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore.getState().setTab
  const tabs: [Tab, string, string][] = [
    ['learn', '🔍', 'Inspect'],
    ['tutor', '🧭', 'Tutor'],
    ['lab', '💥', 'Failure Lab'],
    ['challenge', '🎯', 'Mission'],
  ]
  return (
    <aside className="inspector" data-tour="inspector">
      <div className="tabs" role="tablist">
        {tabs.map(([k, icon, label]) => (
          <button key={k} data-tour={`tab-${k}`} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <span>{icon}</span>{label}
          </button>
        ))}
      </div>
      <div className="tab-body" key={tab}>
        {tab === 'learn' && <Learn />}
        {tab === 'tutor' && <Tutor />}
        {tab === 'lab' && <Lab />}
        {tab === 'challenge' && <Mission />}
      </div>
    </aside>
  )
}
