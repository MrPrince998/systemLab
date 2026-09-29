import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type StudentClass, type TeacherClass } from '../api'
import { challenges, levels } from '../data/challenges'
import { useStore } from '../store/store'

/** A student is "stuck" on a mission after several failed checks or every hint without completing it. */
const stuckOn = (p: TeacherClass['students'][number]['progress'], ids: string[]) =>
  ids.filter((id) => !p.completed.includes(id) && ((p.missions[id]?.attempts ?? 0) >= 3 || (p.missions[id]?.hints ?? 0) >= 3))

function TeacherView() {
  const [classes, setClasses] = useState<TeacherClass[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const toast = useStore.getState().toast

  const load = useCallback(() => api.classes<TeacherClass>().then(setClasses, (e) => setError(e.message)), [])
  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    try {
      const c = await api.createClass(name.trim())
      setName('')
      toast(`Class created. Join code: ${c.code}`, 'good')
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create class')
    }
  }
  const toggle = async (c: TeacherClass, id: string) => {
    const next = c.assignments.includes(id) ? c.assignments.filter((x) => x !== id) : [...c.assignments, id]
    setClasses((cs) => cs?.map((x) => (x.id === c.id ? { ...x, assignments: next } : x)) ?? null)
    await api.assign(c.id, next).catch(() => toast('Could not save assignments', 'bad'))
  }

  return (
    <>
      <div className="class-create glass">
        <input className="input grow" placeholder="New class name, e.g. “CS 301 · Fall”" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} />
        <button className="primary" disabled={!name.trim()} onClick={create}>Create class</button>
      </div>
      {error && <p className="error">{error}</p>}
      {classes === null && <p className="muted">Loading…</p>}
      {classes?.length === 0 && <p className="muted">No classes yet. Create one, then share its join code with your students.</p>}
      {classes?.map((c) => {
        const assigned = challenges.filter((m) => c.assignments.includes(m.id))
        const columns = assigned.length ? assigned : challenges
        return (
          <section key={c.id} className="class-card glass">
            <div className="class-head">
              <div>
                <h2>{c.name}</h2>
                <p className="muted">{c.students.length} student{c.students.length === 1 ? '' : 's'} · join code <code className="code">{c.code}</code></p>
              </div>
              <button className="ghost" onClick={() => setEditing(editing === c.id ? null : c.id)}>{editing === c.id ? 'Done' : `📋 Assign missions (${c.assignments.length})`}</button>
            </div>

            {editing === c.id && (
              <div className="assign">
                {levels.map((l) => (
                  <div key={l.id}>
                    <h5>{l.icon} {l.title}</h5>
                    {challenges.filter((m) => m.level === l.id).map((m) => (
                      <label key={m.id} className="check-row">
                        <input type="checkbox" checked={c.assignments.includes(m.id)} onChange={() => toggle(c, m.id)} />
                        {m.title}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {c.students.length === 0 ? (
              <p className="muted small">Students join from their account’s “My classes” page with code <b>{c.code}</b>.</p>
            ) : (
              <div className="grid-wrap">
                <table className="progress-grid">
                  <thead>
                    <tr>
                      <th>Student</th>
                      {columns.map((m) => <th key={m.id} title={m.title}>{m.id.toUpperCase()}</th>)}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.students.map((s) => {
                      const stuck = stuckOn(s.progress, columns.map((m) => m.id))
                      const done = columns.filter((m) => s.progress.completed.includes(m.id)).length
                      return (
                        <tr key={s.id}>
                          <td><b>{s.name}</b><small>{s.email}</small></td>
                          {columns.map((m) => {
                            const p = s.progress.missions[m.id]
                            const complete = s.progress.completed.includes(m.id)
                            const cls = complete ? 'done' : stuck.includes(m.id) ? 'stuck' : p ? 'started' : ''
                            return (
                              <td key={m.id} className={`cell ${cls}`} title={`${m.title}: ${complete ? 'completed' : p ? `${p.attempts} checks, ${p.hints} hints` : 'not started'}`}>
                                {complete ? '✓' : stuck.includes(m.id) ? '!' : p ? '…' : ''}
                              </td>
                            )
                          })}
                          <td>{stuck.length ? <span className="pill down">Stuck on {stuck.length}</span> : <span className="muted small">{done}/{columns.length}</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small legend"><span className="cell done">✓</span> complete <span className="cell started">…</span> started <span className="cell stuck">!</span> stuck (3+ failed checks or all hints)</p>
          </section>
        )
      })}
    </>
  )
}

function StudentView() {
  const [classes, setClasses] = useState<StudentClass[] | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const completed = useStore((s) => s.completed)
  const { startChallenge, setAssignments, toast } = useStore.getState()

  const load = useCallback(
    () =>
      api.classes<StudentClass>().then((cs) => {
        setClasses(cs)
        setAssignments([...new Set(cs.flatMap((c) => c.assignments))])
      }, (e) => setError(e.message)),
    [setAssignments],
  )
  useEffect(() => {
    load()
  }, [load])

  const join = async () => {
    setError('')
    try {
      const c = await api.joinClass(code.trim())
      setCode('')
      toast(`Joined ${c.name}`, 'good')
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not join')
    }
  }

  return (
    <>
      <div className="class-create glass">
        <input className="input grow mono" placeholder="Class code from your teacher" value={code} maxLength={12} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && code.trim() && join()} />
        <button className="primary" disabled={!code.trim()} onClick={join}>Join class</button>
      </div>
      {error && <p className="error">{error}</p>}
      {classes?.length === 0 && <p className="muted">You haven’t joined a class yet.</p>}
      {classes?.map((c) => (
        <section key={c.id} className="class-card glass">
          <h2>{c.name}</h2>
          <p className="muted">Teacher: {c.teacher}</p>
          {c.assignments.length === 0 ? <p className="muted small">No missions assigned yet.</p> : (
            <div className="assigned-list">
              {challenges.filter((m) => c.assignments.includes(m.id)).map((m) => (
                <button key={m.id} className={`assigned ${completed.includes(m.id) ? 'done' : ''}`} onClick={() => startChallenge(m.id)}>
                  <span>{completed.includes(m.id) ? '✓' : '📌'}</span>
                  <b>{m.title}</b>
                  <small>{levels.find((l) => l.id === m.level)?.title}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  )
}

export function ClassroomPage() {
  const user = useStore((s) => s.user)
  const setModal = useStore.getState().setModal
  return (
    <div className="missions-page classroom">
      <header className="mp-head">
        <div>
          <span className="eyebrow">Classroom</span>
          <h1>{user?.role === 'teacher' ? 'Teacher dashboard' : 'My classes'}</h1>
          <p className="muted">{user?.role === 'teacher' ? 'Create classes, assign missions, and see at a glance who’s progressing and who’s stuck.' : 'Join your class to see the missions your teacher assigned.'}</p>
        </div>
      </header>
      <div className="track">
        {!user ? (
          <div className="class-card glass">
            <h2>Sign in to use classrooms</h2>
            <p className="muted">Classrooms need an account so teachers can see your progress. Accounts are stored on this app’s server.</p>
            <button className="primary" onClick={() => setModal('account')}>Sign in or create an account</button>
          </div>
        ) : user.role === 'teacher' ? <TeacherView /> : <StudentView />}
      </div>
    </div>
  )
}
