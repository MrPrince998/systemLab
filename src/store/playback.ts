import { useEffect } from 'react'
import type { RunResult, SimEvent } from '../engine/types'
import { useStore } from './store'

/** Milliseconds per animation step. Long runs play faster so a spike doesn't take a minute. */
export const tickMs = (total: number, speed: number) => Math.max(8, Math.min(260, 9000 / Math.max(1, total))) / speed

/** Drives the animation clock: advances one simulation event per tick. */
export function usePlaybackTimer() {
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const total = useStore((s) => s.run?.events.length ?? 0)
  const tick = useStore((s) => s.tick)
  useEffect(() => {
    if (!playing) return
    const id = setInterval(tick, tickMs(total, speed))
    return () => clearInterval(id)
  }, [playing, total, speed, tick])
}

export interface Progress {
  events: SimEvent[]
  current: SimEvent | undefined
  load: Record<string, number>
  sent: Record<string, number>
  hits: Record<string, number>
  misses: Record<string, number>
  edgeCounts: Record<string, number>
  enqueued: Record<string, number>
  consumed: Record<string, number>
  done: boolean
}

// Every canvas node reads progress on every tick; compute it once per step.
let cache: { run: RunResult | null; index: number; value: Progress } | null = null

function computeProgress(run: RunResult | null, index: number): Progress {
  if (cache && cache.run === run && cache.index === index) return cache.value
  const bump = (m: Record<string, number>, k: string | undefined) => {
    if (k) m[k] = (m[k] ?? 0) + 1
  }
  const value: Progress = { events: run?.events.slice(0, index) ?? [], current: undefined, load: {}, sent: {}, hits: {}, misses: {}, edgeCounts: {}, enqueued: {}, consumed: {}, done: !!run && index >= run.events.length }
  for (const e of value.events) {
    if (e.type === 'REQUEST_ROUTED') {
      bump(value.load, e.to)
      bump(value.edgeCounts, `${e.from}->${e.to}`)
    } else if (e.type === 'REQUEST_CREATED') bump(value.sent, e.nodeId)
    else if (e.type === 'CACHE_HIT') bump(value.hits, e.nodeId)
    else if (e.type === 'CACHE_MISS') bump(value.misses, e.nodeId)
    else if (e.type === 'MESSAGE_ENQUEUED') bump(value.enqueued, e.nodeId)
    else if (e.type === 'MESSAGE_CONSUMED') bump(value.consumed, e.nodeId)
  }
  value.current = value.events[value.events.length - 1]
  cache = { run, index, value }
  return value
}

/** What the animation has revealed so far (a pure view over the event stream). */
export function useProgress() {
  const run = useStore((s) => s.run)
  const playIndex = useStore((s) => s.playIndex)
  return computeProgress(run, playIndex)
}
