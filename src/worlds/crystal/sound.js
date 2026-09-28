// The air of the glass garden: a slow open pad, a breath of high air,
// glass chimes on an A major pentatonic, and the three resonant crystals
// humming their notes where they stand (and holding them once woken).

import { registerAmbience } from '../../engine/audio.js'

// a struck glass: nearly harmonic partials, long soft decay
export function glass(A, freq, t, amp, dur, dest) {
  const ctx = A.ctx
  const partials = [[1, 1], [2.0, 0.32], [3.01, 0.12], [4.23, 0.05]]
  for (const [r, a] of partials) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq * r
    o.detune.value = (Math.random() - 0.5) * 6
    const g = ctx.createGain()
    const d = dur / (1 + (r - 1) * 0.7)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(amp * a, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + d)
    o.connect(g)
    g.connect(dest)
    g.connect(A.reverb)
    o.start(t)
    o.stop(t + d + 0.1)
  }
}

registerAmbience('crystal', (A, out, world) => {
  const ctx = A.ctx
  // pad: A2 E3 B3 C#4 E4, slowly breathing
  const pad = ctx.createGain()
  pad.gain.value = 0.034
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'; lp.frequency.value = 820; lp.Q.value = 0.3
  pad.connect(lp).connect(out)
  const send = ctx.createGain(); send.gain.value = 0.6
  lp.connect(send).connect(A.reverb)
  const notes = [110, 164.81, 246.94, 277.18, 329.63, 440]
  const nodes = []
  notes.forEach((f, i) => {
    for (const det of [-3, 3]) {
      const o = ctx.createOscillator()
      o.type = i < 2 ? 'sine' : 'triangle'
      o.frequency.value = f
      o.detune.value = det + (Math.random() - 0.5) * 2
      const g = ctx.createGain()
      g.gain.value = 0.1 / (1 + i * 0.35)
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.025 + i * 0.011 + Math.random() * 0.01
      const lg = ctx.createGain()
      lg.gain.value = 0.08 / (1 + i * 0.35)
      lfo.connect(lg).connect(g.gain)
      o.connect(g).connect(pad)
      o.start(); lfo.start()
      nodes.push(o, lfo)
    }
  })
  // high air
  const air = A.src(A.noise)
  const af = ctx.createBiquadFilter()
  af.type = 'bandpass'; af.frequency.value = 5200; af.Q.value = 0.6
  const ag = ctx.createGain(); ag.gain.value = 0.009
  air.connect(af).connect(ag).connect(out)
  air.start()
  const low = A.src(A.brown)
  const lf = ctx.createBiquadFilter()
  lf.type = 'lowpass'; lf.frequency.value = 220
  const lg2 = ctx.createGain(); lg2.gain.value = 0.05
  low.connect(lf).connect(lg2).connect(out)
  low.start()

  // chimes
  const chimeBus = ctx.createGain()
  chimeBus.gain.value = 1
  chimeBus.connect(out)
  const scale = [880, 987.77, 1108.73, 1318.51, 1479.98, 1760, 1975.53, 2217.46]
  let next = 2.5

  // the three resonant crystals: a spatial hum each
  const voices = (world.res || []).map((r) => {
    const pan = A.makePanner(6, 1.4)
    A.setPos(pan, r.x, 6, r.z)
    const g = ctx.createGain()
    g.gain.value = 0
    g.connect(pan).connect(out)
    const hs = ctx.createGain(); hs.gain.value = 0.4
    g.connect(hs).connect(A.reverb)
    const oscs = [[0.5, 0.5], [1, 0.35], [1.002, 0.25], [2, 0.08]].map(([k, a]) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = r.note * k
      const og = ctx.createGain(); og.gain.value = a
      o.connect(og).connect(g)
      o.start()
      return o
    })
    nodes.push(...oscs)
    const callPan = A.makePanner(12, 1.0)
    A.setPos(callPan, r.x, 8, r.z)
    callPan.connect(out)
    return { r, g, pan, callPan, call: 3 + Math.random() * 6 }
  })

  return {
    nodes,
    update(dt, game, inside) {
      const t = ctx.currentTime
      next -= dt
      if (next <= 0) {
        next = 2.2 + Math.random() * 5.5
        const n = Math.random() < 0.3 ? 3 : Math.random() < 0.5 ? 2 : 1
        let f = scale[Math.floor(Math.random() * scale.length)]
        for (let i = 0; i < n; i++) {
          glass(A, f, t + i * (0.18 + Math.random() * 0.2), 0.012 + Math.random() * 0.014, 5 + Math.random() * 3, chimeBus)
          f = scale[Math.floor(Math.random() * scale.length)]
        }
      }
      for (const v of voices) {
        if (!inside) { v.g.gain.setTargetAtTime(0, t, 0.3); continue }
        const p = game.player.pos
        const d = Math.hypot(p.x - v.r.x, p.z - v.r.z)
        // near a sleeping crystal: it hums; awake, it holds its note softly
        const near = Math.max(0, Math.min(1, (14 - d) / 10))
        const want = v.r.awake ? 0.05 + near * 0.05 : near * near * 0.16
        v.g.gain.setTargetAtTime(want, t, 0.4)
        // sleeping ones call from afar now and then, so you can find them
        if (!v.r.awake) {
          v.call -= dt
          if (v.call <= 0) {
            v.call = 9 + Math.random() * 7
            glass(A, v.r.note, t, 0.07, 6, v.callPan)
          }
        }
      }
    },
  }
})
