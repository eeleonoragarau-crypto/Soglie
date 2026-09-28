// The air of L'Abisso: a sub drone that beats against itself, filtered cosmic
// noise, a slow open chord, rare crystalline sparkles, and the hole's roar
// growing as you come near. Tiles ping softly as they wake.

import { registerAmbience } from '../../engine/audio.js'
import { BH } from './layout.js'

// filled in when the ambience starts; the world calls voice.ping()
export const voice = { ping: null }

const PING = [1174.66, 1318.51, 1479.98, 1760, 1975.53, 2349.32]
const SPARK = [1318.51, 1760, 1975.53, 2217.46, 2349.32]

registerAmbience('void', (A, out) => {
  const ctx = A.ctx
  const osc = (f, type, g, dest) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = f
    const gn = ctx.createGain()
    gn.gain.value = g
    o.connect(gn).connect(dest)
    o.start()
    return { o, g: gn }
  }

  // sub drone: two near-unison fundamentals beating slowly, a soft fifth above
  const sub = ctx.createGain()
  sub.gain.value = 0.2
  const slp = ctx.createBiquadFilter()
  slp.type = 'lowpass'; slp.frequency.value = 150
  sub.connect(slp).connect(out)
  const drones = [
    osc(36.71, 'sine', 0.55, sub),
    osc(36.93, 'sine', 0.4, sub),
    osc(55.0, 'sine', 0.22, sub),
    osc(73.42, 'triangle', 0.05, sub),
  ]

  // cosmic noise: a dark wash that breathes, and a thin high shimmer
  const wash = A.src(A.brown)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'; bp.frequency.value = 240; bp.Q.value = 0.7
  const wg = ctx.createGain(); wg.gain.value = 0.05
  wash.connect(bp).connect(wg).connect(out)
  const hiss = A.src(A.noise)
  const hp = ctx.createBiquadFilter()
  hp.type = 'bandpass'; hp.frequency.value = 5600; hp.Q.value = 1.6
  const hg = ctx.createGain(); hg.gain.value = 0.004
  hiss.connect(hp).connect(hg).connect(out)
  hg.connect(A.reverb)

  // pad: an open chord, each voice swelling on its own slow tide
  const pad = ctx.createGain(); pad.gain.value = 0.03
  const plp = ctx.createBiquadFilter(); plp.type = 'lowpass'; plp.frequency.value = 640; plp.Q.value = 0.3
  pad.connect(plp).connect(out)
  plp.connect(A.reverb)
  const chord = [110, 164.81, 220, 329.63, 493.88]
  const voices = chord.map((f, i) => {
    const v = osc(f, i < 2 ? 'sine' : 'triangle', 0, pad)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.017 + i * 0.011
    const lg = ctx.createGain(); lg.gain.value = 0.22 / (1 + i * 0.4)
    lfo.connect(lg).connect(v.g.gain)
    lfo.start()
    return [v.o, lfo]
  })

  // the hole: a low roar, only near the end of the path
  const roar = A.src(A.brown)
  const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 80; rl.Q.value = 0.9
  const rg = ctx.createGain(); rg.gain.value = 0
  roar.connect(rl).connect(rg).connect(out)
  const hum = osc(27.5, 'sine', 0, out)

  ;[wash, hiss, roar].forEach((s) => s.start())

  let last = 0
  voice.ping = (i, amp = 1) => {
    const t = ctx.currentTime
    if (t - last < 0.09) return
    last = t
    A.bell(PING[i % PING.length], t, 0.01 * amp, 2.6, out)
  }

  let next = 5
  return {
    update(dt, game, inside) {
      const t = ctx.currentTime
      bp.frequency.setTargetAtTime(200 + 110 * Math.sin(t * 0.043) + 60 * Math.sin(t * 0.11), t, 2)
      next -= dt
      if (next <= 0) {
        next = 8 + Math.random() * 10
        // a few notes falling like light off glass
        const n = 2 + Math.floor(Math.random() * 3)
        let f = SPARK[Math.floor(Math.random() * SPARK.length)]
        for (let k = 0; k < n; k++) {
          A.bell(f, t + k * (0.18 + Math.random() * 0.2), 0.014 / (1 + k * 0.4), 5, out)
          f *= [0.75, 0.8, 0.667, 1.125][Math.floor(Math.random() * 4)]
        }
      }
      if (!inside) return
      const p = game.player.pos
      const d = Math.hypot(p.x - BH.x, p.y - BH.y, p.z - BH.z)
      const k = Math.min(1, Math.max(0, (720 - d) / 300))
      rg.gain.setTargetAtTime(0.015 + 0.2 * k * k, t, 1.2)
      rl.frequency.setTargetAtTime(60 + 70 * k, t, 1.2)
      hum.g.gain.setTargetAtTime(0.08 * k, t, 1.5)
    },
    nodes: [...drones.map((d) => d.o), ...voices.flat(), hum.o],
  }
})
