import { challenges, levels, levelUnlocked, missionsIn } from '../data/challenges'
import { technologies } from '../data/technologies'
import { useStore } from '../store/store'
import { accent } from './Canvas'

export function MissionsPage() {
  const completed = useStore((s) => s.completed)
  const current = useStore((s) => s.challengeId)
  const drafts = useStore((s) => s.drafts)
  const assignments = useStore((s) => s.assignments)
  const { startChallenge } = useStore.getState()
  const done = challenges.filter((c) => completed.includes(c.id)).length
  const nextUp = challenges.find((c) => !completed.includes(c.id) && levelUnlocked(c.level, completed))

  return (
    <div className="missions-page">
      <header className="mp-head">
        <div>
          <span className="eyebrow">Career path</span>
          <h1>From first request to senior architect</h1>
          <p className="muted">Each mission gives you requirements. You build from an empty canvas, and the simulator throws real traffic and failures at your design.</p>
        </div>
        <div className="mp-stats glass">
          <b>{done}<small>/{challenges.length}</small></b>
          <span>missions complete</span>
          <div className="progress"><div style={{ width: `${(done / challenges.length) * 100}%` }} /></div>
          {nextUp && <button className="primary sm" onClick={() => startChallenge(nextUp.id)}>Continue: {nextUp.title} →</button>}
        </div>
      </header>

      <div className="track">
        {levels.map((lv, li) => {
          const ms = missionsIn(lv.id)
          const n = ms.filter((m) => completed.includes(m.id)).length
          const open = levelUnlocked(lv.id, completed)
          return (
            <section key={lv.id} className={`level ${open ? '' : 'locked'} ${n === ms.length ? 'complete' : ''}`} style={accent(lv.color)}>
              <div className="level-rail"><span className="level-node">{open ? lv.icon : '🔒'}</span></div>
              <div className="level-body">
                <div className="level-head">
                  <div>
                    <span className="level-tag">Level {li + 1}</span>
                    <h2>{lv.title}</h2>
                    <p className="muted">{lv.subtitle}</p>
                  </div>
                  <div className="level-count">{n}/{ms.length}</div>
                </div>
                <div className="mission-grid">
                  {ms.map((m, i) => {
                    const isDone = completed.includes(m.id)
                    const inProgress = current === m.id || !!drafts[m.id]?.nodes.length
                    return (
                      <button key={m.id} className={`mcard ${isDone ? 'done' : ''}`} disabled={!open} onClick={() => startChallenge(m.id)}>
                        <div className="mcard-top">
                          <span className="mcard-num">{isDone ? '✓' : `${li + 1}.${i + 1}`}</span>
                          {isDone ? <span className="mcard-state good">Completed</span> : assignments.includes(m.id) ? <span className="mcard-state assigned">📌 Assigned</span> : inProgress && <span className="mcard-state">In progress</span>}
                        </div>
                        <h3>{m.title}</h3>
                        <p>{m.tagline}</p>
                        <div className="chips">{m.concepts.map((c) => <span key={c} className="chip">{c}</span>)}</div>
                        <div className="mcard-foot">
                          <span title="Components available">{m.availableKinds.map((k) => technologies[k].icon).join(' ')}</span>
                          <span>📨 {m.scenario.requests}/s</span>
                          {m.scenario.kill && <span className="bad">💥 {m.scenario.kill.length}</span>}
                          <span className="go">{isDone ? 'Replay' : 'Start'} →</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
                {!open && <p className="locked-note">🔒 Complete every {levels[li - 1].title} mission to unlock.</p>}
              </div>
            </section>
          )
        })}
      </div>

      <div className="sandbox-cta glass">
        <div>
          <b>🧪 Free sandbox</b>
          <p className="muted">No requirements. Build anything and break it.</p>
        </div>
        <button onClick={() => startChallenge(null)}>Open sandbox →</button>
      </div>
    </div>
  )
}
