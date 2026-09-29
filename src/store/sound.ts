/** Tiny synthesized sound effects. No audio files, and silent when muted or unsupported. */
type Cue = 'success' | 'fail' | 'win' | 'achievement' | 'click'

const notes: Record<Cue, [number, number][]> = {
  click: [[660, 0.04]],
  success: [[523, 0.08], [784, 0.12]],
  fail: [[330, 0.1], [220, 0.16]],
  win: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]],
  achievement: [[784, 0.08], [1175, 0.2]],
}

let ctx: AudioContext | null = null

export function play(cue: Cue, muted: boolean) {
  if (muted) return
  try {
    ctx ??= new AudioContext()
    let t = ctx.currentTime
    for (const [freq, dur] of notes[cue]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur + 0.02)
      t += dur * 0.9
    }
  } catch {
    /* audio unavailable: stay silent */
  }
}
