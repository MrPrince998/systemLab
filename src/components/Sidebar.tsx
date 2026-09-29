import { challenges, levels } from '../data/challenges'
import { kindOrder, technologies } from '../data/technologies'
import { useStore } from '../store/store'
import { accent } from './Canvas'

function MissionAside() {
  const id = useStore((s) => s.challengeId)
  const result = useStore((s) => s.checkResult)
  const { checkChallenge, setTab, setView, startChallenge } = useStore.getState()
  const c = challenges.find((x) => x.id === id)

  if (!c) {
    return (
      <section className="aside-card">
        <h5>Free sandbox</h5>
        <p className="muted small">No goals. Build anything, break it, learn from it.</p>
        <button className="wide" onClick={() => setView('missions')}>🗺 Browse missions</button>
      </section>
    )
  }
  const level = levels.find((l) => l.id === c.level)!
  return (
    <section className="aside-card mission-aside" style={accent(level.color)}>
      <button className="link back" onClick={() => setView('missions')}>← All missions</button>
      <span className="level-tag">{level.icon} {level.title}</span>
      <h4 className="aside-title">{c.title}</h4>
      <ul className="checklist">
        {c.objectives.map((o, i) => {
          const r = result?.results[i]
          return (
            <li key={o.label} className={r ? (r.passed ? 'pass' : 'fail') : ''}>
              <span className="check">{r ? (r.passed ? '✓' : '✗') : ''}</span>
              <span>{o.label}</span>
            </li>
          )
        })}
      </ul>
      <button className="primary wide" onClick={checkChallenge}>Check solution</button>
      <div className="row">
        <button className="ghost sm grow" onClick={() => setTab('challenge')}>Brief & hints</button>
        <button className="ghost sm" onClick={() => startChallenge(null)} title="Leave the mission">Sandbox</button>
      </div>
    </section>
  )
}

export function Sidebar() {
  const challengeId = useStore((s) => s.challengeId)
  const nodeCount = useStore((s) => s.nodes.length)
  const addNode = useStore.getState().addNode
  const challenge = challenges.find((c) => c.id === challengeId)
  const kinds = challenge ? challenge.availableKinds : kindOrder

  return (
    <aside className="sidebar">
      <MissionAside />
      <section data-tour="palette">
        <h5>Components</h5>
        <p className="muted small">{challenge ? 'Available in this mission. Drag onto the canvas.' : 'Drag onto the canvas, or click to add'}</p>
        <div className="palette">
          {kinds.map((k) => {
            const t = technologies[k]
            return (
              <button
                key={k}
                data-tour={`palette-${k}`}
                className="palette-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-kind', k)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => addNode(k, { x: 80 + (nodeCount % 4) * 60, y: 40 + (nodeCount % 5) * 90 })}
                style={accent(t.color)}
                title={`${t.definition} Cost: ${t.cost}.`}
              >
                <span className="palette-icon">{t.icon}</span>
                <span className="grow">
                  <b>{t.name}</b>
                  <small>{t.tagline}</small>
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </aside>
  )
}
