// Everything you hear is synthesised: wind, sand under your feet, the boom
// of a sliding dune, keys that sing from where they lie, each universe's air.

export class AudioEngine {
  constructor(game) {
    this.game = game
    this.ctx = null
    this.muted = false
    this.ambiences = {}
    this.keyVoices = new Map()
    this.doorVoices = new Map()
    this.world = null
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC({ latencyHint: 'interactive' })
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.9
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 3
    comp.attack.value = 0.01
    comp.release.value = 0.3
    this.master.connect(comp).connect(ctx.destination)
    this.sfx = ctx.createGain()
    this.sfx.connect(this.master)
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this.impulse(3.8, 2.6)
    this.wet = ctx.createGain()
    this.wet.gain.value = 0.55
    this.reverb.connect(this.wet).connect(this.master)
    this.noise = this.noiseBuffer(4)
    this.brown = this.noiseBuffer(4, true)
    if (this.world) this.setWorld(this.world)
  }

  noiseBuffer(secs, brown = false) {
    const ctx = this.ctx
    const b = ctx.createBuffer(2, ctx.sampleRate * secs, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c)
      let last = 0
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 } else d[i] = w
      }
    }
    return b
  }

  impulse(secs, decay) {
    const ctx = this.ctx
    const len = ctx.sampleRate * secs
    const b = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
    return b
  }

  src(buf = this.noise, loop = true) {
    const s = this.ctx.createBufferSource()
    s.buffer = buf
    s.loop = loop
    if (loop) s.loopStart = Math.random() * 2
    return s
  }

  toggleMute() {
    this.muted = !this.muted
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.1)
  }

  duck(on) {
    if (!this.master || this.muted) return
    this.master.gain.setTargetAtTime(on ? 0.25 : 0.9, this.ctx.currentTime, 0.3)
  }

  // ------------------------------------------------------------ worlds
  setWorld(world) {
    this.world = world
    if (!this.ctx) return
    for (const [id, a] of Object.entries(this.ambiences)) {
      a.gain.gain.setTargetAtTime(id === world.id ? 1 : 0, this.ctx.currentTime, 0.8)
    }
    this.ensureAmbience(world)
  }

  ensureAmbience(world) {
    if (this.ambiences[world.id] || !this.ctx) return this.ambiences[world.id]
    const make = AMBIENCES[world.id] || AMBIENCES.default
    const gain = this.ctx.createGain()
    gain.gain.value = world === this.world ? 1 : 0
    gain.connect(this.master)
    const leak = this.ctx.createGain()
    leak.gain.value = 0
    const pan = this.makePanner(12, 1.2)
    leak.connect(pan).connect(this.master)
    const bus = this.ctx.createGain()
    bus.connect(gain)
    bus.connect(leak)
    const a = { gain, leak, pan, bus, ...make(this, bus, world) }
    this.ambiences[world.id] = a
    return a
  }

  makePanner(ref = 8, roll = 1) {
    const p = this.ctx.createPanner()
    p.panningModel = 'HRTF'
    p.distanceModel = 'inverse'
    p.refDistance = ref
    p.rolloffFactor = roll
    p.maxDistance = 10000
    return p
  }

  setPos(node, x, y, z) {
    if (node.positionX) {
      const t = this.ctx.currentTime
      node.positionX.setTargetAtTime(x, t, 0.05)
      node.positionY.setTargetAtTime(y, t, 0.05)
      node.positionZ.setTargetAtTime(z, t, 0.05)
    } else node.setPosition(x, y, z)
  }

  update(dt, game) {
    if (!this.ctx) return
    const ctx = this.ctx
    const cam = game.camera
    const L = ctx.listener
    const f = { x: 0, y: 0, z: -1 }
    const e = cam.matrixWorld.elements
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10]
    if (L.positionX) {
      const t = ctx.currentTime
      L.positionX.setTargetAtTime(cam.position.x, t, 0.02)
      L.positionY.setTargetAtTime(cam.position.y, t, 0.02)
      L.positionZ.setTargetAtTime(cam.position.z, t, 0.02)
      L.forwardX.setTargetAtTime(f.x, t, 0.02)
      L.forwardY.setTargetAtTime(f.y, t, 0.02)
      L.forwardZ.setTargetAtTime(f.z, t, 0.02)
      L.upX.setTargetAtTime(e[4], t, 0.02)
      L.upY.setTargetAtTime(e[5], t, 0.02)
      L.upZ.setTargetAtTime(e[6], t, 0.02)
    } else {
      L.setPosition(cam.position.x, cam.position.y, cam.position.z)
      L.setOrientation(f.x, f.y, f.z, e[4], e[5], e[6])
    }
    const w = game.current
    const amb = this.ensureAmbience(w)
    amb.update?.(dt, game, true)

    // doors leak the air of the universe behind them
    const leaking = new Set()
    for (const p of w.portals) {
      if (!p.dest || (p.locked && !p.unlocking)) continue
      const other = this.ensureAmbience(p.dest.world)
      if (!other) continue
      const d = p.distanceTo(cam.position)
      const front = p.inFront(cam.position)
      const k = front ? Math.max(0, 1 - d / 60) * (p.open ?? 1) : 0
      const g = p.group.position
      this.setPos(other.pan, g.x, g.y + 2, g.z)
      other.leak.gain.setTargetAtTime(k * 0.9, ctx.currentTime, 0.2)
      if (k > 0) {
        other.update?.(dt, game, false)
        leaking.add(p.dest.world.id)
      }
    }
    for (const [id, a] of Object.entries(this.ambiences)) {
      if (!leaking.has(id)) a.leak.gain.setTargetAtTime(0, ctx.currentTime, 0.3)
    }

    // singing keys
    const live = new Set()
    for (const it of w.items) {
      if (it.taken || it.hidden) continue
      live.add(it)
      let v = this.keyVoices.get(it)
      if (!v) { v = this.keyVoice(it); this.keyVoices.set(it, v) }
      const p = it.group.position
      this.setPos(v.pan, p.x, p.y, p.z)
    }
    for (const [it, v] of this.keyVoices) {
      if (!live.has(it)) {
        v.out.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
        setTimeout(() => v.stop(), 2500)
        this.keyVoices.delete(it)
      }
    }
  }

  // a chord of pure partials with slow beating, placed in space
  keyVoice(item) {
    const ctx = this.ctx
    const out = ctx.createGain()
    out.gain.value = 0
    out.gain.setTargetAtTime(0.5, ctx.currentTime, 1.5)
    const pan = this.makePanner(9, 1.1)
    out.connect(pan).connect(this.master)
    const send = ctx.createGain()
    send.gain.value = 0.35
    out.connect(send).connect(this.reverb)
    const base = { sea: 293.66, crystal: 349.23, void: 220, garden: 392, gate: 261.63 }[item.id] || 261.63
    const ratios = [1, 1.5, 2, 2.5, 3.01]
    const oscs = []
    ratios.forEach((r, i) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = base * r * (1 + (i ? (Math.random() - 0.5) * 0.004 : 0))
      const g = ctx.createGain()
      g.gain.value = 0.16 / (i + 1)
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.07 + Math.random() * 0.2
      const lg = ctx.createGain()
      lg.gain.value = 0.08 / (i + 1)
      lfo.connect(lg).connect(g.gain)
      o.connect(g).connect(out)
      o.start()
      lfo.start()
      oscs.push(o, lfo)
    })
    return { out, pan, stop: () => oscs.forEach((o) => { try { o.stop() } catch {} }) }
  }

  // ------------------------------------------------------------ one-shots
  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
  }

  step(surface, speed = 4, run = false) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const v = Math.min(1, 0.45 + speed / 16)
    const s = this.src(this.noise, false)
    s.playbackRate.value = 0.8 + Math.random() * 0.4
    const off = Math.random() * 3
    const g = ctx.createGain()
    const f = ctx.createBiquadFilter()
    if (surface === 'water') {
      f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 900; f.Q.value = 1.4
      this.env(g, t, 0.01, 0.35 * v, 0.28)
      // droplets
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator()
        const og = ctx.createGain()
        const tt = t + 0.04 + Math.random() * 0.2
        o.frequency.setValueAtTime(900 + Math.random() * 1400, tt)
        o.frequency.exponentialRampToValueAtTime(2400 + Math.random() * 900, tt + 0.05)
        this.env(og, tt, 0.003, 0.03 * v, 0.06)
        o.connect(og).connect(this.sfx)
        og.connect(this.reverb)
        o.start(tt); o.stop(tt + 0.1)
      }
    } else if (surface === 'glass' || surface === 'crystal') {
      f.type = 'highpass'; f.frequency.value = 2500
      this.env(g, t, 0.002, 0.08 * v, 0.06)
      const o = ctx.createOscillator()
      const og = ctx.createGain()
      const notes = surface === 'glass' ? [880, 987.8, 1174.7, 1318.5, 1568] : [1046.5, 1174.7, 1396.9, 1568, 1760]
      o.frequency.value = notes[Math.floor(Math.random() * notes.length)]
      o.type = 'sine'
      this.env(og, t, 0.004, 0.05 * v, 0.9)
      o.connect(og).connect(this.sfx)
      og.connect(this.reverb)
      o.start(t); o.stop(t + 1)
    } else if (surface === 'grass') {
      f.type = 'highpass'; f.frequency.value = 1800 + Math.random() * 1000
      this.env(g, t, 0.02, 0.12 * v, 0.2)
    } else {
      // sand: soft crunch + a low compression thump
      f.type = 'lowpass'; f.frequency.value = 1400 + Math.random() * 900; f.Q.value = 0.7
      this.env(g, t, 0.012, 0.42 * v * (run ? 1.1 : 1), 0.16 + Math.random() * 0.06)
      const th = ctx.createOscillator()
      const tg = ctx.createGain()
      th.frequency.setValueAtTime(90, t)
      th.frequency.exponentialRampToValueAtTime(45, t + 0.12)
      this.env(tg, t, 0.005, 0.12 * v, 0.14)
      th.connect(tg).connect(this.sfx)
      th.start(t); th.stop(t + 0.2)
    }
    s.connect(f).connect(g).connect(this.sfx)
    s.start(t, off, 0.5)
  }

  land(surface, v) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const k = Math.min(1, v / 12)
    const s = this.src(this.noise, false)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'; f.frequency.value = surface === 'water' ? 2200 : 900
    const g = ctx.createGain()
    this.env(g, t, 0.01, 0.6 * k + 0.1, 0.35)
    s.connect(f).connect(g).connect(this.sfx)
    s.start(t, Math.random() * 3, 0.6)
    const o = ctx.createOscillator()
    const og = ctx.createGain()
    o.frequency.setValueAtTime(70, t)
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25)
    this.env(og, t, 0.005, 0.35 * k, 0.3)
    o.connect(og).connect(this.sfx)
    o.start(t); o.stop(t + 0.4)
  }

  bell(freq, t, amp = 0.2, dur = 3.5, dest = this.sfx) {
    const ctx = this.ctx
    const partials = [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12], [0.5, 0.3]]
    for (const [r, a] of partials) {
      const o = ctx.createOscillator()
      o.frequency.value = freq * r
      const g = ctx.createGain()
      this.env(g, t, 0.004, amp * a, dur / (r > 1 ? r * 0.6 : 1))
      o.connect(g)
      g.connect(dest)
      g.connect(this.reverb)
      o.start(t)
      o.stop(t + dur + 0.2)
    }
  }

  chime() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const notes = [587.33, 739.99, 880, 1174.66, 1479.98]
    notes.forEach((n, i) => this.bell(n, t + i * 0.13, 0.09, 4.5))
    this.shimmer(t, 2.5)
  }

  shimmer(t, dur) {
    const ctx = this.ctx
    const s = this.src(this.noise, false)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'; f.Q.value = 6
    f.frequency.setValueAtTime(3000, t)
    f.frequency.exponentialRampToValueAtTime(9000, t + dur)
    const g = ctx.createGain()
    this.env(g, t, dur * 0.4, 0.08, dur * 0.6)
    s.connect(f).connect(g)
    g.connect(this.reverb)
    g.connect(this.sfx)
    s.start(t, 0, dur + 0.2)
  }

  unlock() {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    // rising filtered noise swell
    const s = this.src(this.brown, false)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'; f.Q.value = 4
    f.frequency.setValueAtTime(120, t)
    f.frequency.exponentialRampToValueAtTime(2400, t + 3.2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5, t + 3.0)
    g.gain.exponentialRampToValueAtTime(0.001, t + 5.5)
    s.connect(f).connect(g).connect(this.sfx)
    g.connect(this.reverb)
    s.start(t, 0, 6)
    // deep bloom when the veil breaks
    const o = ctx.createOscillator()
    const og = ctx.createGain()
    o.frequency.setValueAtTime(55, t + 2.8)
    o.frequency.exponentialRampToValueAtTime(41, t + 6)
    og.gain.setValueAtTime(0, t + 2.8)
    og.gain.linearRampToValueAtTime(0.5, t + 3.0)
    og.gain.exponentialRampToValueAtTime(0.001, t + 7)
    o.connect(og).connect(this.sfx)
    og.connect(this.reverb)
    o.start(t + 2.7); o.stop(t + 7.2)
    ;[220, 277.18, 329.63, 440, 554.37].forEach((n, i) => this.bell(n, t + 2.9 + i * 0.06, 0.06, 6))
    this.shimmer(t + 2.6, 3)
  }

  // the tree of light: a slow ascending arpeggio over the whole growth
  growth() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const scale = [146.83, 220, 293.66, 369.99, 440, 554.37, 587.33, 739.99, 880, 1108.73, 1174.66, 1479.98]
    for (let i = 0; i < 28; i++) {
      const f = scale[Math.min(scale.length - 1, Math.floor(i * 0.45))] * (i % 3 === 2 ? 2 : 1)
      this.bell(f, t + i * 0.62 + Math.random() * 0.1, 0.05, 6)
    }
    this.shimmer(t + 14, 5)
  }

  denied() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.bell(110, t, 0.12, 2.5)
    this.bell(116.5, t + 0.02, 0.08, 2.5)
  }

  whoosh() {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const s = this.src(this.noise, false)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'; f.Q.value = 1.2
    f.frequency.setValueAtTime(300, t)
    f.frequency.exponentialRampToValueAtTime(4000, t + 0.35)
    f.frequency.exponentialRampToValueAtTime(200, t + 1.2)
    const g = ctx.createGain()
    this.env(g, t, 0.15, 0.3, 1.1)
    s.connect(f).connect(g).connect(this.sfx)
    g.connect(this.reverb)
    s.start(t, 0, 1.5)
  }
}

// ---------------------------------------------------------------- ambiences
// each returns { update(dt, game, inside) } and connects into `out`
const AMBIENCES = {
  default: () => ({}),

  desert(A, out) {
    const ctx = A.ctx
    // broad wind body
    const n1 = A.src(A.noise)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6
    const g1 = ctx.createGain(); g1.gain.value = 0.12
    n1.connect(bp).connect(g1).connect(out)
    // low rumble
    const n2 = A.src(A.brown)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'; lp.frequency.value = 160
    const g2 = ctx.createGain(); g2.gain.value = 0.25
    n2.connect(lp).connect(g2).connect(out)
    // whistle over the crests
    const n3 = A.src(A.noise)
    const hp = ctx.createBiquadFilter()
    hp.type = 'bandpass'; hp.frequency.value = 1400; hp.Q.value = 9
    const g3 = ctx.createGain(); g3.gain.value = 0
    n3.connect(hp).connect(g3).connect(out)
    g3.connect(A.reverb)
    // booming dune: a sliding avalanche sings near 95 Hz
    const boom = ctx.createGain(); boom.gain.value = 0
    const bf = ctx.createBiquadFilter()
    bf.type = 'lowpass'; bf.frequency.value = 420
    boom.connect(bf).connect(out)
    const bo = [95, 190, 285.5, 97.5].map((f, i) => {
      const o = ctx.createOscillator()
      o.type = i === 3 ? 'triangle' : 'sawtooth'
      o.frequency.value = f
      const g = ctx.createGain(); g.gain.value = [0.3, 0.12, 0.05, 0.22][i]
      o.connect(g).connect(boom)
      o.start()
      return o
    })
    const bn = A.src(A.brown)
    const bng = ctx.createGain(); bng.gain.value = 0.6
    bn.connect(bng).connect(boom)
    // pad: a slow, open chord under everything
    const pad = ctx.createGain(); pad.gain.value = 0.035
    const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 520; pf.Q.value = 0.4
    pad.connect(pf).connect(out)
    pf.connect(A.reverb)
    const chords = [[146.83, 220, 329.63, 440], [130.81, 196, 293.66, 392], [110, 164.81, 246.94, 329.63], [123.47, 185, 277.18, 369.99]]
    const voices = chords[0].map((f) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.004
      const g = ctx.createGain(); g.gain.value = 0.25
      o.connect(g); o2.connect(g); g.connect(pad)
      o.start(); o2.start()
      return [o, o2]
    })
    ;[n1, n2, n3, bn].forEach((s) => s.start())
    let chord = 0, ct = 0, gust = 0, gt = 0
    return {
      update(dt, game, inside) {
        const t = ctx.currentTime
        ct += dt
        if (ct > 14) {
          ct = 0
          chord = (chord + 1) % chords.length
          voices.forEach(([o, o2], i) => {
            o.frequency.setTargetAtTime(chords[chord][i], t, 2.5)
            o2.frequency.setTargetAtTime(chords[chord][i] * 1.004, t, 2.5)
          })
        }
        gt -= dt
        if (gt <= 0) { gt = 3 + Math.random() * 6; gust = Math.random() }
        if (!inside) return
        const p = game.player
        const w = game.worlds.desert
        const storm = w.storm || 0
        const crest = Math.max(0, Math.min(1, (p.pos.y - 10) / 30))
        const sp = Math.min(1, p.speedH / 14)
        g1.gain.setTargetAtTime(0.07 + gust * 0.08 + sp * 0.08 + storm * 0.4, t, 1.2)
        bp.frequency.setTargetAtTime(380 + gust * 500 + sp * 400 + storm * 600, t, 1.5)
        g2.gain.setTargetAtTime(0.16 + storm * 0.5, t, 1)
        g3.gain.setTargetAtTime(crest * 0.05 * (0.4 + gust) + storm * 0.06, t, 1.5)
        hp.frequency.setTargetAtTime(1100 + crest * 900 + gust * 300, t, 2)
        boom.gain.setTargetAtTime(p.surf * 0.22, t, 0.25)
        bo[0].frequency.setTargetAtTime(92 + p.surf * 6, t, 0.4)
      },
    }
  },
}

export function registerAmbience(id, fn) {
  AMBIENCES[id] = fn
}
