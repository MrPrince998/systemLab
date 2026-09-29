import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { create } from 'zustand'
import { api, setToken, type MissionProgress, type Progress, type User } from '../api'
import { achievements } from '../data/achievements'
import { challenges, levels, missionsIn } from '../data/challenges'
import { DEFAULT_EDGE_LATENCY, defaultConfig } from '../engine/defaults'
import { Simulator } from '../engine/simulator'
import type { Architecture, Health, Kind, Metrics, NodeConfig, RunOptions, RunResult } from '../engine/types'
import { evaluateChallenge, infraCost, type ObjectiveResult } from '../engine/validation'
import { encodeDesign, type DesignFile } from './share'
import { play } from './sound'

export interface NodeData extends Record<string, unknown> {
  kind: Kind
  state: Health
  config: NodeConfig
}
export type SimNode = Node<NodeData>

export type Tab = 'learn' | 'tutor' | 'lab' | 'challenge'
export type View = 'missions' | 'build' | 'classroom'
export type Modal = 'account' | 'library' | 'achievements' | 'compare' | 'share' | null
export type Tone = 'good' | 'bad' | 'info'
export interface Toast {
  id: number
  text: string
  tone: Tone
}

export type Outcome = 'all' | 'some' | 'none'
export interface Prediction {
  outcome: Outcome
  /** Node id expected to overload first, or 'none'. */
  bottleneck: string
}
export interface PredictionResult {
  prediction: Prediction
  outcome: Outcome
  hot: string[]
  outcomeOk: boolean
  bottleneckOk: boolean
}

export interface LocalDesign {
  id: string
  name: string
  savedAt: number
  design: DesignFile
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Snapshot {
  nodes: SimNode[]
  edges: Edge[]
}

const simulator = new Simulator()

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key)
      return v === null ? fallback : (JSON.parse(v) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable: this preference just won't persist */
    }
  },
}

const idPrefix: Record<Kind, string> = {
  client: 'client',
  server: 'server',
  'load-balancer': 'lb',
  cache: 'cache',
  database: 'db',
  replica: 'replica',
  queue: 'queue',
}

/** Smallest free readable id, e.g. server-2 after server-1. */
const nextId = (kind: Kind, nodes: SimNode[]) => {
  const used = new Set(nodes.map((n) => n.id))
  let i = 1
  while (used.has(`${idPrefix[kind]}-${i}`)) i++
  return `${idPrefix[kind]}-${i}`
}

const mkNode = (id: string, kind: Kind, position: { x: number; y: number }, config?: NodeConfig): SimNode => ({
  id,
  type: 'tech',
  position,
  data: { kind, state: 'healthy', config: { ...defaultConfig[kind], ...config } },
})

const mkEdge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  data: { latency: DEFAULT_EDGE_LATENCY },
})

export function evaluatePrediction(prediction: Prediction, m: Metrics): PredictionResult {
  const outcome: Outcome = m.failed === 0 ? 'all' : m.succeeded === 0 ? 'none' : 'some'
  const hot = Object.entries(m.utilization).filter(([, u]) => u > 1).map(([id]) => id)
  return {
    prediction,
    outcome,
    hot,
    outcomeOk: prediction.outcome === outcome,
    bottleneckOk: prediction.bottleneck === 'none' ? hot.length === 0 : hot.includes(prediction.bottleneck),
  }
}

let toastSeq = 0
let syncTimer: ReturnType<typeof setTimeout> | undefined
let lastCommit = { key: '', at: 0 }

const legacyCompleted = storage.get<string[]>('systemlab.completed', [])
const savedProgress = storage.get<Progress>('systemlab.progress', { completed: legacyCompleted, achievements: [], missions: {} })
const savedStats = storage.get('systemlab.stats', { kills: 0, predictions: 0, correct: 0 })

export interface State {
  nodes: SimNode[]
  edges: Edge[]
  selectedId: string | null
  tab: Tab
  opts: RunOptions
  run: RunResult | null
  playIndex: number
  playing: boolean
  speed: number
  challengeId: string | null
  hintLevel: number
  checkResult: { results: ObjectiveResult[]; passed: boolean } | null
  winKey: number
  /** Bumped when the canvas is replaced wholesale, so the view refits. */
  fitKey: number
  /** The architecture changed since the last run, so its results are out of date. */
  stale: boolean
  completed: string[]
  achievements: string[]
  missionStats: Record<string, MissionProgress>
  stats: { kills: number; predictions: number; correct: number }
  toasts: Toast[]
  help: boolean
  view: View
  modal: Modal
  /** Current walkthrough step, or null when the tour isn't running. */
  tourStep: number | null
  /** Unfinished canvases, keyed by mission id ('sandbox' for free build). */
  drafts: Record<string, Snapshot>
  past: Snapshot[]
  future: Snapshot[]
  dragging: boolean
  predictMode: boolean
  /** Set while the prediction dialog is open; holds the pending run's overrides. */
  predicting: { overrides?: Partial<RunOptions> } | null
  predictionResult: PredictionResult | null
  muted: boolean
  library: LocalDesign[]
  user: User | null
  serverAi: boolean | null
  assignments: string[]
  chat: ChatMessage[]
  chatBusy: boolean

  onNodesChange: (c: NodeChange<SimNode>[]) => void
  onEdgesChange: (c: EdgeChange[]) => void
  onConnect: (c: Connection) => void
  addNode: (kind: Kind, position: { x: number; y: number }) => void
  select: (id: string | null) => void
  setTab: (t: Tab) => void
  setConfig: (id: string, key: string, value: number | boolean) => void
  setState: (id: string, state: Health) => void
  recoverAll: () => void
  duplicate: (id: string) => void
  deleteNode: (id: string) => void
  setOpts: (o: Partial<RunOptions>) => void
  simulate: (overrides?: Partial<RunOptions>) => void
  confirmPrediction: (p: Prediction | null) => void
  setPredictMode: (on: boolean) => void
  killAndSimulate: (id: string) => void
  resetCache: () => void
  setPlay: (playing: boolean) => void
  setSpeed: (speed: number) => void
  setPlayIndex: (i: number) => void
  tick: () => void
  step: () => void
  skipToEnd: () => void
  startChallenge: (id: string | null) => void
  checkChallenge: () => void
  nextHint: () => void
  undo: () => void
  redo: () => void
  toast: (text: string, tone?: Tone) => void
  dismissToast: (id: number) => void
  setView: (v: View) => void
  setModal: (m: Modal) => void
  startTour: () => void
  setTourStep: (i: number | null) => void
  endTour: (finished?: boolean) => void
  award: (id: string) => void
  setMuted: (m: boolean) => void
  exportDesign: () => DesignFile
  importDesign: (d: DesignFile) => void
  saveToLibrary: (name: string) => void
  deleteFromLibrary: (id: string) => void
  shareLink: () => string
  signIn: (user: User, token: string) => void
  signOut: () => void
  refreshAccount: () => Promise<void>
  setAssignments: (ids: string[]) => void
  askTutor: (question: string) => Promise<void>
  clearChat: () => void
  labContext: () => string
  /** Config for a new node: defaults, overridden by the active mission's hardware. */
  configFor: (kind: Kind) => NodeConfig
  setHelp: (open: boolean) => void
  toArchitecture: () => Architecture
}

const baseOpts: RunOptions = { requests: 10, keyspace: 5, extraLatencyMs: 0, dropEveryN: 0, writeRatio: 0 }

export const useStore = create<State>((set, get) => {
  /** Records the canvas before a change so it can be undone. Rapid edits to one field coalesce. */
  const commit = (key = '') => {
    const now = Date.now()
    if (key && key === lastCommit.key && now - lastCommit.at < 800) return
    lastCommit = { key, at: now }
    const { nodes, edges, past } = get()
    set({ past: [...past.slice(-49), { nodes, edges }], future: [] })
  }

  const saveProgress = () => {
    const { completed, achievements: a, missionStats, user } = get()
    const progress: Progress = { completed, achievements: a, missions: missionStats }
    storage.set('systemlab.progress', progress)
    if (!user) return
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      api.pushProgress(progress).then(
        (merged) => set({ completed: merged.completed, achievements: merged.achievements, missionStats: merged.missions }),
        () => {
          /* offline: local progress is kept and synced next time */
        },
      )
    }, 800)
  }

  const bumpStats = (patch: Partial<State['stats']>) => {
    const stats = { ...get().stats, ...patch }
    storage.set('systemlab.stats', stats)
    set({ stats })
    return stats
  }

  const afterRun = (run: RunResult) => {
    const m = run.metrics
    const { nodes, award } = get()
    if (m.total > 0 && m.failed === 0) award('first-run')
    if (m.total >= 20 && m.cacheHitRate >= 0.8) award('cache')
    if (m.total > 0 && m.failed === 0 && nodes.some((n) => n.data.state === 'failed')) award('survivor')
    if (m.failed === 0 && run.events.some((e) => e.type === 'MESSAGE_ENQUEUED') && m.queueDepth > 0) award('queue')
    if (m.fastFails > 0) award('breaker')
    if (m.staleReads > 0) award('stale')
  }

  const run = (overrides?: Partial<RunOptions>, prediction?: Prediction) => {
    const opts = { ...get().opts, ...overrides }
    const result = simulator.run(get().toArchitecture(), opts)
    let predictionResult: PredictionResult | null = null
    if (prediction) {
      predictionResult = evaluatePrediction(prediction, result.metrics)
      const stats = bumpStats({ predictions: get().stats.predictions + 1, correct: get().stats.correct + (predictionResult.outcomeOk && predictionResult.bottleneckOk ? 1 : 0) })
      if (stats.correct >= 5) get().award('prophet')
    }
    set({ opts, run: result, playIndex: 0, playing: true, checkResult: null, stale: false, predicting: null, predictionResult })
    afterRun(result)
  }

  return {
    nodes: [],
    edges: [],
    selectedId: null,
    tab: 'learn',
    opts: baseOpts,
    run: null,
    playIndex: 0,
    playing: false,
    speed: 1,
    challengeId: null,
    hintLevel: 0,
    checkResult: null,
    winKey: 0,
    fitKey: 0,
    stale: false,
    completed: savedProgress.completed ?? [],
    achievements: savedProgress.achievements ?? [],
    missionStats: savedProgress.missions ?? {},
    stats: savedStats,
    toasts: [],
    help: false,
    view: 'build',
    modal: null,
    tourStep: storage.get('systemlab.toured', false) ? null : 0,
    drafts: {},
    past: [],
    future: [],
    dragging: false,
    predictMode: storage.get('systemlab.predict', true),
    predicting: null,
    predictionResult: null,
    muted: storage.get('systemlab.muted', false),
    library: storage.get<LocalDesign[]>('systemlab.library', []),
    user: null,
    serverAi: null,
    assignments: [],
    chat: [],
    chatBusy: false,

    onNodesChange: (changes) => {
      const s = get()
      const dragStart = changes.some((c) => c.type === 'position' && c.dragging) && !s.dragging
      const dragEnd = changes.some((c) => c.type === 'position' && c.dragging === false)
      if (dragStart || changes.some((c) => c.type === 'remove')) commit()
      set((st) => ({
        nodes: applyNodeChanges(changes, st.nodes),
        dragging: dragStart ? true : dragEnd ? false : st.dragging,
        stale: st.stale || (!!st.run && changes.some((c) => c.type === 'remove')),
      }))
    },
    onEdgesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) commit()
      set((s) => ({ edges: applyEdgeChanges(changes, s.edges), stale: s.stale || (!!s.run && changes.some((c) => c.type === 'remove')) }))
    },
    onConnect: (c) => {
      const s = get()
      if (!c.source || !c.target || c.source === c.target) return
      if (s.edges.some((e) => e.source === c.source && e.target === c.target)) return
      commit()
      set({ edges: addEdge(mkEdge(c.source, c.target), s.edges), stale: !!s.run })
    },

    addNode: (kind, position) => {
      commit()
      set((s) => {
        const id = nextId(kind, s.nodes)
        return { nodes: [...s.nodes, mkNode(id, kind, position, get().configFor(kind))], selectedId: id, tab: 'learn', stale: !!s.run }
      })
    },

    select: (id) => set({ selectedId: id, ...(id ? { tab: 'learn' as Tab } : {}) }),
    setTab: (tab) => set({ tab }),

    setConfig: (id, key, value) => {
      commit(`config:${id}:${key}`)
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n)),
        stale: !!s.run,
      }))
    },

    setState: (id, state) => {
      commit()
      set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, state } } : n)), stale: !!s.run }))
      get().toast(state === 'failed' ? `💥 ${id} is down` : `♻️ ${id} recovered`, state === 'failed' ? 'bad' : 'good')
      if (state === 'failed' && bumpStats({ kills: get().stats.kills + 1 }).kills >= 5) get().award('chaos')
    },

    recoverAll: () => {
      commit()
      set((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, state: 'healthy' as Health } })),
        opts: { ...s.opts, extraLatencyMs: 0, dropEveryN: 0 },
        stale: !!s.run,
      }))
      get().toast('♻️ Everything healed', 'good')
    },

    duplicate: (id) => {
      const src = get().nodes.find((n) => n.id === id)
      if (!src) return
      commit()
      set((s) => {
        const newId = nextId(src.data.kind, s.nodes)
        const copy = mkNode(newId, src.data.kind, { x: src.position.x + 30, y: src.position.y + 110 }, src.data.config)
        return { nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...copy, selected: true }], selectedId: newId, stale: !!s.run }
      })
    },

    deleteNode: (id) => {
      commit()
      set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        stale: !!s.run,
      }))
    },

    undo: () => {
      const { past, future, nodes, edges } = get()
      const prev = past.at(-1)
      if (!prev) return
      lastCommit = { key: '', at: 0 }
      set((s) => ({ nodes: prev.nodes, edges: prev.edges, past: past.slice(0, -1), future: [{ nodes, edges }, ...future].slice(0, 50), selectedId: null, stale: !!s.run }))
    },
    redo: () => {
      const { past, future, nodes, edges } = get()
      const next = future[0]
      if (!next) return
      set((s) => ({ nodes: next.nodes, edges: next.edges, future: future.slice(1), past: [...past, { nodes, edges }], selectedId: null, stale: !!s.run }))
    },

    setOpts: (o) => set((s) => ({ opts: { ...s.opts, ...o } })),

    toArchitecture: () => {
      const { nodes, edges } = get()
      return {
        nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, state: n.data.state, config: n.data.config })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, latency: (e.data?.latency as number) ?? DEFAULT_EDGE_LATENCY })),
      }
    },

    simulate: (overrides) => {
      const s = get()
      if (!s.nodes.length) {
        s.toast('Add some components first', 'info')
        return
      }
      // Predict-then-run: guessing first is what makes the result stick. Skipped during the tour.
      if (s.predictMode && s.tourStep === null) {
        set({ predicting: { overrides }, playing: false })
        return
      }
      run(overrides)
    },
    confirmPrediction: (p) => run(get().predicting?.overrides, p ?? undefined),
    setPredictMode: (on) => {
      storage.set('systemlab.predict', on)
      set({ predictMode: on, ...(on ? {} : { predicting: null }) })
    },

    killAndSimulate: (id) => {
      get().setState(id, 'failed')
      get().simulate()
    },

    resetCache: () => {
      simulator.reset()
      set({ run: null, playIndex: 0, playing: false, predictionResult: null })
      get().toast('Caches, queues and results reset', 'info')
    },

    setPlay: (playing) =>
      set((s) => {
        if (!s.run) return s
        const atEnd = s.playIndex >= s.run.events.length
        return { playing, ...(playing && atEnd ? { playIndex: 0 } : {}) }
      }),
    setSpeed: (speed) => set({ speed }),
    setPlayIndex: (playIndex) => set({ playIndex, playing: false }),
    tick: () => {
      const s = get()
      if (!s.run) return set({ playing: false })
      const next = s.playIndex + 1
      if (next >= s.run.events.length) {
        set({ playIndex: s.run.events.length, playing: false })
        play(s.run.metrics.failed === 0 ? 'success' : 'fail', s.muted)
      } else set({ playIndex: next })
    },
    step: () => {
      set({ playing: false })
      get().tick()
    },
    skipToEnd: () => set((s) => ({ playIndex: s.run?.events.length ?? 0, playing: false })),

    startChallenge: (id) => {
      simulator.reset()
      const s = get()
      const drafts = { ...s.drafts, [s.challengeId ?? 'sandbox']: { nodes: s.nodes, edges: s.edges } }
      const draft = drafts[id ?? 'sandbox'] ?? { nodes: [], edges: [] }
      const c = challenges.find((x) => x.id === id)
      set({
        drafts,
        challengeId: c ? c.id : null,
        nodes: draft.nodes,
        edges: draft.edges,
        opts: c ? { ...baseOpts, requests: c.scenario.requests, keyspace: c.scenario.keyspace, writeRatio: c.scenario.writeRatio ?? 0 } : baseOpts,
        tab: c ? 'challenge' : 'learn',
        view: 'build',
        hintLevel: 0,
        checkResult: null,
        run: null,
        playIndex: 0,
        playing: false,
        selectedId: null,
        stale: false,
        predictionResult: null,
        past: [],
        future: [],
        fitKey: s.fitKey + 1,
      })
    },

    checkChallenge: () => {
      const s = get()
      const c = challenges.find((x) => x.id === s.challengeId)
      if (!c) return
      const res = evaluateChallenge(s.toArchitecture(), c)
      const prev = s.missionStats[c.id] ?? { attempts: 0, hints: 0 }
      const stat: MissionProgress = { ...prev, attempts: prev.attempts + 1, hints: Math.max(prev.hints, s.hintLevel) }
      if (res.passed && !stat.completedAt) stat.completedAt = Date.now()
      const completed = res.passed && !s.completed.includes(c.id) ? [...s.completed, c.id] : s.completed
      set({
        checkResult: { results: res.results, passed: res.passed },
        completed,
        missionStats: { ...s.missionStats, [c.id]: stat },
        winKey: res.passed ? s.winKey + 1 : s.winKey,
      })
      saveProgress()
      const met = res.results.filter((r) => r.passed).length
      if (!res.passed) {
        play('fail', s.muted)
        s.toast(`${met} of ${res.results.length} objectives met. Keep experimenting.`, 'bad')
        return
      }
      play('win', s.muted)
      set({ tab: 'challenge' })
      s.toast('🎉 Mission complete!', 'good')
      if (stat.hints === 0) s.award('no-hints')
      if (c.objectives.some((o) => o.metric === 'cost')) s.award('frugal')
      for (const l of levels) if (missionsIn(l.id).every((m) => completed.includes(m.id))) s.award(`level-${l.id}`)
    },

    nextHint: () => {
      const s = get()
      const hintLevel = s.hintLevel + 1
      set({ hintLevel })
      if (s.challengeId) {
        const prev = s.missionStats[s.challengeId] ?? { attempts: 0, hints: 0 }
        set({ missionStats: { ...s.missionStats, [s.challengeId]: { ...prev, hints: Math.max(prev.hints, hintLevel) } } })
        saveProgress()
      }
    },

    toast: (text, tone = 'info') => {
      const id = ++toastSeq
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }))
      setTimeout(() => get().dismissToast(id), 3600)
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    setView: (view) => set({ view, playing: false }),
    setModal: (modal) => set({ modal }),

    startTour: () => {
      get().startChallenge(null)
      simulator.reset()
      set({ nodes: [], edges: [], selectedId: null, run: null, tab: 'learn', help: false, modal: null, tourStep: 0, past: [], future: [] })
    },
    setTourStep: (tourStep) => set({ tourStep }),
    endTour: (finished) => {
      storage.set('systemlab.toured', true)
      set({ tourStep: null })
      if (finished) get().award('orientation')
    },

    award: (id) => {
      const s = get()
      if (s.achievements.includes(id)) return
      const a = achievements.find((x) => x.id === id)
      if (!a) return
      set({ achievements: [...s.achievements, id] })
      saveProgress()
      play('achievement', s.muted)
      s.toast(`${a.icon} Achievement unlocked: ${a.title}`, 'good')
    },
    setMuted: (muted) => {
      storage.set('systemlab.muted', muted)
      set({ muted })
    },

    exportDesign: () => {
      const { nodes, edges, challengeId } = get()
      return {
        v: 1,
        nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, x: Math.round(n.position.x), y: Math.round(n.position.y), config: n.data.config })),
        edges: edges.map((e) => [e.source, e.target] as [string, string]),
        mission: challengeId ?? undefined,
      }
    },
    importDesign: (d) => {
      commit()
      set((s) => ({
        nodes: d.nodes.map((n) => mkNode(n.id, n.kind, { x: n.x, y: n.y }, n.config)),
        edges: d.edges.map(([a, b]) => mkEdge(a, b)),
        selectedId: null,
        run: null,
        playIndex: 0,
        stale: false,
        fitKey: s.fitKey + 1,
      }))
    },
    saveToLibrary: (name) => {
      const design = get().exportDesign()
      const entry: LocalDesign = { id: `${Date.now()}`, name, savedAt: Date.now(), design }
      const library = [entry, ...get().library].slice(0, 50)
      storage.set('systemlab.library', library)
      set({ library })
      if (get().user) api.saveDesign(name, design).catch(() => get().toast('Saved on this device; cloud save failed', 'info'))
      get().toast(`💾 Saved “${name}”`, 'good')
    },
    deleteFromLibrary: (id) => {
      const library = get().library.filter((d) => d.id !== id)
      storage.set('systemlab.library', library)
      set({ library })
    },
    shareLink: () => {
      get().award('shared')
      return `${location.origin}${location.pathname}#d=${encodeDesign(get().exportDesign())}`
    },

    signIn: (user, token) => {
      setToken(token)
      set({ user })
      saveProgress()
      get().refreshAccount()
    },
    signOut: () => {
      api.logout().catch(() => {})
      setToken(null)
      set({ user: null, assignments: [] })
      get().toast('Signed out. Progress stays on this device.', 'info')
    },
    refreshAccount: async () => {
      try {
        const { user } = await api.me()
        set({ user })
        const [merged, classes] = await Promise.all([
          api.pushProgress({ completed: get().completed, achievements: get().achievements, missions: get().missionStats }),
          user.role === 'student' ? api.classes<{ id: number; name: string; teacher: string; assignments: string[] }>() : Promise.resolve([]),
        ])
        set({ completed: merged.completed, achievements: merged.achievements, missionStats: merged.missions, assignments: [...new Set(classes.flatMap((c) => c.assignments))] })
        storage.set('systemlab.progress', merged)
      } catch {
        /* signed out or offline */
      }
    },
    setAssignments: (assignments) => set({ assignments }),

    labContext: () => {
      const s = get()
      const lines: string[] = []
      const c = challenges.find((x) => x.id === s.challengeId)
      if (c) {
        lines.push(`Mission: ${c.title} (${c.level}). ${c.brief}`)
        lines.push(`Scenario: ${c.scenario.requests} req/s, ${c.scenario.keyspace} keys, ${Math.round((c.scenario.writeRatio ?? 0) * 100)}% writes${c.scenario.kill ? `, crashes: ${c.scenario.kill.join(', ')}` : ''}.`)
        lines.push(`Objectives: ${c.objectives.map((o) => o.label).join('; ')}.`)
        if (s.checkResult) lines.push(`Last check: ${s.checkResult.results.map((r) => `${r.label} → ${r.passed ? 'PASS' : 'FAIL'} (got ${Number(r.actual.toFixed(2))})`).join('; ')}.`)
      } else lines.push('Mode: free sandbox.')
      lines.push(`Components (${s.nodes.length}, cost ${infraCost(s.toArchitecture())}):`)
      for (const n of s.nodes) lines.push(`- ${n.id} [${n.data.kind}] ${n.data.state}${Object.keys(n.data.config).length ? ` ${JSON.stringify(n.data.config)}` : ''}`)
      lines.push(`Connections: ${s.edges.map((e) => `${e.source}→${e.target}`).join(', ') || 'none'}`)
      lines.push(`Traffic settings: ${s.opts.requests} req/s, ${s.opts.keyspace} keys, ${Math.round((s.opts.writeRatio ?? 0) * 100)}% writes, +${s.opts.extraLatencyMs}ms/hop, drop every ${s.opts.dropEveryN || 'none'}.`)
      if (s.run) {
        const m = s.run.metrics
        lines.push(`Last simulation${s.stale ? ' (architecture changed since)' : ''}: ${m.succeeded}/${m.total} succeeded, avg ${Math.round(m.avgLatency)}ms, p95 ${Math.round(m.p95Latency)}ms, db queries ${m.dbQueries}, db writes ${m.dbWrites}, replica reads ${m.replicaReads}, cache hit rate ${Math.round(m.cacheHitRate * 100)}%, stale reads ${m.staleReads}, retries ${m.retries}, fast fails ${m.fastFails}, queue backlog ${m.queueDepth}.`)
        if (Object.keys(m.failuresByReason).length) lines.push(`Failures by reason: ${JSON.stringify(m.failuresByReason)}`)
        const util = Object.entries(m.utilization).map(([id, u]) => `${id} ${Math.round(u * 100)}%`)
        if (util.length) lines.push(`Utilization: ${util.join(', ')}`)
      } else lines.push('No simulation run yet.')
      return lines.join('\n')
    },

    askTutor: async (question) => {
      const chat: ChatMessage[] = [...get().chat, { role: 'user', content: question }]
      set({ chat, chatBusy: true })
      try {
        const { reply } = await api.tutor(chat, get().labContext())
        set({ chat: [...chat, { role: 'assistant', content: reply }] })
      } catch (e) {
        set({ chat: [...chat, { role: 'assistant', content: `⚠️ ${(e as Error).message}` }] })
      } finally {
        set({ chatBusy: false })
      }
    },
    clearChat: () => set({ chat: [] }),

    configFor: (kind) => {
      const c = challenges.find((x) => x.id === get().challengeId)
      return { ...defaultConfig[kind], ...c?.defaults?.[kind] }
    },
    setHelp: (help) => set({ help }),
  }
})
