// Il Giardino Sospeso. Late morning over a meadow of tall grass that breathes
// in the wind. Islands of rock and earth hang in the sky, bobbing, their
// waterfalls unravelling into mist before they reach the ground. Far away one
// waterfall runs the wrong way: from a pond up into the largest island. The
// Seed sleeps there, carried by the water.

import * as THREE from 'three'
import { World } from '../engine/world.js'
import { makeEnv } from '../engine/env.js'
import { addDoor } from '../engine/door.js'
import { KeyItem } from '../engine/key.js'
import { makeStoneMaterial } from '../engine/materials.js'
import { WORLDS, KEYS, LINES } from '../story.js'
import { registerAmbience } from '../engine/audio.js'
import { HF, SUN, DOOR, POND, BOUND, ISLANDS, buildHeights, sampleHeight } from './garden/layout.js'
import { makeGardenUniforms, NISL, NTREE } from './garden/common.js'
import { makeIslands, makeRoots, makeBobUniform, rimRadius } from './garden/islands.js'
import { makePond, makeUpfall, makeSpray, makeFalls } from './garden/water.js'
import { treeList, makeTrees } from './garden/trees.js'
import { makeMountains } from './garden/mountains.js'
import { makeHeightTextures, makeTerrain } from './garden/terrain.js'
import { makeGardenAtmosphere, bakeCloudSky, makeGardenSky } from './garden/sky.js'
import { makeGrass, makeFlowers, makePollen } from './garden/grass.js'

const _f = new THREE.Vector3()
const _t = new THREE.Vector3()
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class Garden extends World {
  constructor(game) {
    super(game, { id: 'garden', ...WORLDS.garden })
    this.surface = 'grass'
    this.slopePhysics = false
    this.grade = { exposure: 0.92, bloom: 0.55, saturation: 1.06, contrast: 1.05, grain: 0.022, haze: 0 }
  }

  async build(renderer) {
    const { data, water } = buildHeights()
    this.heights = data
    this.water = water
    const { heightTex, normTex } = makeHeightTextures(data)

    const { T, lut, amb } = makeGardenAtmosphere()
    const sunI = 22 / Math.PI
    this.env = makeEnv({
      sunDir: SUN,
      sunColor: T.map((v, i) => v * sunI * [0.62, 0.6, 0.54][i]),
      ambTop: amb.zenith.map((v) => v * 1.7),
      ambHorizon: amb.horizon.map((v) => v * 0.75),
      ambGround: [0.2, 0.3, 0.1],
      fogColor: [1, 1, 1],
      fogDensity: 0.00062,
      fogBase: -10,
      fogFalloff: 0.0045,
      fogSun: 0.22,
      skyLUT: lut,
    })
    this.gu = makeGardenUniforms(heightTex, normTex)
    this.gu.uWaterY.value = water
    this.gu.uPond.value.set(POND.x, POND.z, POND.r, 0)

    this.skyRT = bakeCloudSky(renderer, this.env)
    this.sky = makeGardenSky(this.env, this.skyRT)
    this.scene.add(this.sky)

    this.terrain = makeTerrain(this.env, this.gu)
    this.scene.add(this.terrain)
    this.scene.add(makeMountains(this.env))
    this.grass = makeGrass(this.env, this.gu)
    this.scene.add(...this.grass)
    this.scene.add(makeFlowers(this.env, this.gu), makePollen(this.env, this.gu))

    this.bobU = makeBobUniform()
    const isl = makeIslands(this.env, this.gu, ISLANDS, this.bobU)
    this.islands = isl
    this.scene.add(isl.mesh)
    this.roots = makeRoots(this.env, this.gu, ISLANDS, isl.info, this.bobU)
    this.scene.add(this.roots)
    this.buildWater()
    this.buildTrees()

    this.buildDoor()
    this.buildKey()
    const y = this.groundAt(DOOR.x, DOOR.z + 5)
    this.spawn = { x: DOOR.x, y, z: DOOR.z + 5, yaw: DOOR.yaw + Math.PI }
  }

  buildWater() {
    const G = ISLANDS[0]
    this.pond = makePond(this.env, this.gu, POND, this.water)
    this.scene.add(this.pond)
    this.glowU = { value: 1 }
    const y0 = this.water - 0.3
    const y1 = G.y - G.d + 7
    this.upfall = makeUpfall(this.env, this.gu, this.bobU, { x: POND.x, z: POND.z, y0, y1, isl: 0, glow: this.glowU })
    this.scene.add(...this.upfall)
    this.colliders.push({ type: 'circle', x: POND.x, z: POND.z, r: 2.6 })
    // waterfalls off the island rims, and where each one dissolves
    const falls = []
    const emit = [
      { x: POND.x, y: y0, z: POND.z, kind: 0, h: y1 - y0, r: 2.4, size: 0.12, weight: 3 },
      { x: POND.x, y: y0, z: POND.z, kind: 1, h: 22, r: 2.8, size: 3.2, weight: 0.5 },
    ]
    ISLANDS.forEach((I, i) => {
      for (const th of I.fall) {
        const R = rimRadius(I, th)
        const ox = Math.cos(th), oz = Math.sin(th)
        const x = I.x + ox * R, z = I.z + oz * R
        const below = I.y - this.groundAt(x, z)
        const len = Math.min(80, below * 0.62)
        const w = Math.max(2.5, I.r * 0.12)
        falls.push({ x, y: I.y - 0.4, z, ox, oz, w, len, isl: i, seed: i * 3.7 + th })
        const tt = Math.sqrt((2 * len * 0.8) / 9.8)
        emit.push({ x: x + ox * (1.2 + 2.6 * tt), y: I.y - 0.4 - len * 0.72, z: z + oz * (1.2 + 2.6 * tt), kind: 2, h: len * 0.35, r: w * 0.8, isl: i, size: w * 1.6, weight: 0.12 * Math.sqrt(len) })
      }
    })
    this.falls = makeFalls(this.env, this.gu, this.bobU, falls)
    this.scene.add(this.falls)
    this.fallList = falls
    this.spray = makeSpray(this.env, this.gu, this.bobU, emit, 2000)
    this.scene.add(this.spray)
  }

  buildTrees() {
    const trees = treeList(ISLANDS, (x, z) => this.groundAt(x, z))
    const t = makeTrees(this.env, this.gu, this.bobU, trees)
    this.scene.add(t.trunks, t.leaves)
    const ground = trees.filter((q) => q.isl === 23)
    ground.slice(0, NTREE).forEach((q, i) => this.gu.uTreeS.value[i].set(q.x, q.y + q.h * 0.66, q.z, q.h * 0.36))
    for (const q of ground) this.colliders.push({ type: 'circle', x: q.x, z: q.z, r: 0.25 + q.h * 0.03 })
  }

  buildDoor() {
    const stone = makeStoneMaterial(this.env, {
      color: [0.035, 0.04, 0.032],
      color2: [0.075, 0.08, 0.06],
      rough: 0.62,
      bump: 0.3,
      scale: 0.9,
      spec: 0.6,
    })
    const y = this.groundAt(DOOR.x, DOOR.z) - 0.05
    this.door = addDoor(this, {
      id: 'garden-return', x: DOOR.x, y, z: DOOR.z, yaw: DOOR.yaw,
      color: WORLDS.garden.color,
      palette: [[0.6, 0.32, 0.14], [0.35, 0.5, 0.75]],
      glyph: KEYS.garden.glyph,
      locked: false, stone,
    })
  }

  // the Seed rides the rising water, out of reach, singing. Wade into the
  // pond and the water lets it go: it drifts down and comes to your hands.
  buildKey() {
    this.seedHome = new THREE.Vector3(POND.x, this.water + 13, POND.z)
    this.key = new KeyItem(this, {
      id: 'gate', ...KEYS.gate,
      x: this.seedHome.x, y: this.seedHome.y, z: this.seedHome.z,
      beam: 0, radius: 2.6,
    })
    this.seed = { state: 'asleep', t: 0, from: new THREE.Vector3() }
  }

  updateSeed(dt, t, game) {
    const k = this.key
    const S = this.seed
    if (k.taken) { this.glowU.value += (0.8 - this.glowU.value) * (1 - Math.exp(-dt)); return }
    const inside = game && game.current === this
    if (S.state === 'asleep') {
      const b = this.bobU.value[0].y
      k.group.position.set(this.seedHome.x + Math.sin(t * 0.4) * 0.5, this.seedHome.y + b * 0.3 + Math.sin(t * 0.7) * 0.6, this.seedHome.z + Math.cos(t * 0.33) * 0.5)
      this.glowU.value = 1 + 0.15 * Math.sin(t * 1.3)
      if (inside) {
        const p = game.player.pos
        if (Math.hypot(p.x - POND.x, p.z - POND.z) < POND.r - 1.5) {
          S.state = 'descend'
          S.t = 0
          S.from.copy(k.group.position)
          game.hud.say(LINES.garden.release, 5)
          const A = game.audio
          if (A.ctx) [392, 587.33, 783.99].forEach((f, i) => A.bell(f, A.ctx.currentTime + i * 0.4, 0.05, 5))
        }
      }
    } else if (S.state === 'descend') {
      S.t += dt
      const e = ease(Math.min(1, S.t / 5.5))
      // toward a point just in front of the eye
      const cam = game.camera
      cam.getWorldDirection(_f)
      _f.y = 0
      _f.normalize()
      _t.copy(cam.position).addScaledVector(_f, 1.4)
      _t.y -= 0.35
      const sp = (1 - e) * 3.2
      k.group.position.lerpVectors(S.from, _t, e)
      k.group.position.x += Math.cos(S.t * 1.6) * sp
      k.group.position.z += Math.sin(S.t * 1.6) * sp
      this.glowU.value = 1 + 0.9 * Math.sin(Math.min(1, S.t / 5.5) * Math.PI)
      if (S.t > 5.5) S.state = 'offered'
    } else {
      const cam = game.camera
      cam.getWorldDirection(_f)
      _f.y = 0
      _f.normalize()
      _t.copy(cam.position).addScaledVector(_f, 0.9)
      _t.y -= 0.4
      k.group.position.lerp(_t, 1 - Math.exp(-dt * 3))
    }
  }

  groundAt(x, z) {
    return sampleHeight(this.heights, x, z)
  }

  normalAt(x, z, out) {
    const e = HF.s
    const hx = this.groundAt(x + e, z) - this.groundAt(x - e, z)
    const hz = this.groundAt(x, z + e) - this.groundAt(x, z - e)
    return out.set(-hx, 2 * e, -hz).normalize()
  }

  constrain(pos, vel) {
    const d = Math.hypot(pos.x, pos.z)
    if (d > BOUND.soft) {
      const k = (d - BOUND.soft) / (BOUND.hard - BOUND.soft)
      vel.x -= (pos.x / d) * k * 0.5
      vel.z -= (pos.z / d) * k * 0.5
    }
    if (d > BOUND.hard) { pos.x *= BOUND.hard / d; pos.z *= BOUND.hard / d }
  }

  update(dt, t, game) {
    super.update(dt, t)
    this.gu.uTime.value = t
    this.updateSeed(dt, t, game)
    if (game && game.current === this) {
      const p = game.player.pos
      this.surface = Math.hypot(p.x - POND.x, p.z - POND.z) < POND.r && p.y < this.water ? 'water' : 'grass'
    }
    // islands breathe up and down, slowly, each to its own rhythm
    const bob = this.bobU.value
    const sh = this.gu.uIsl.value
    ISLANDS.forEach((I, i) => {
      const dy = Math.sin(t * (0.19 + I.seed * 0.013) + I.seed * 1.7) * I.bob + Math.sin(t * 0.07 + I.seed) * I.bob * 0.4
      bob[i].set(0, dy, 0, 0)
      if (i < NISL) sh[i].set(I.x, I.y + dy, I.z, I.r)
    })
    this.sky.userData.uniforms.uTime.value = t
  }

  onEnter(game) {
    if (!this.hinted) {
      this.hinted = true
      setTimeout(() => game.current === this && game.hud.say(LINES.garden.hint, 6), 5000)
    }
  }
}

// Breeze in the grass that swells with the gusts, birds that chirp in little
// FM phrases from all around, a warm slow pad, and the soft rush of the water
// climbing into the sky, placed where it stands.
registerAmbience('garden', (A, out) => {
  const ctx = A.ctx
  // breeze: two bands of noise, the high one is the hiss of blades
  const n1 = A.src(A.noise)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.5
  const g1 = ctx.createGain(); g1.gain.value = 0.05
  n1.connect(bp).connect(g1).connect(out)
  const n2 = A.src(A.noise)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'; hp.frequency.value = 3200
  const hs = ctx.createBiquadFilter()
  hs.type = 'lowpass'; hs.frequency.value = 9000
  const g2 = ctx.createGain(); g2.gain.value = 0.02
  n2.connect(hp).connect(hs).connect(g2).connect(out)
  const n3 = A.src(A.brown)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'; lp.frequency.value = 220
  const g3 = ctx.createGain(); g3.gain.value = 0.08
  n3.connect(lp).connect(g3).connect(out)

  // pad: a warm open chord, slowly breathing between two voicings
  const pad = ctx.createGain(); pad.gain.value = 0.028
  const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 900; pf.Q.value = 0.3
  pad.connect(pf).connect(out)
  pf.connect(A.reverb)
  const chords = [[174.61, 261.63, 329.63, 440], [196, 293.66, 349.23, 440], [146.83, 220, 329.63, 392], [164.81, 246.94, 329.63, 415.3]]
  const voices = chords[0].map((f, i) => {
    const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 1.003
    const g = ctx.createGain(); g.gain.value = 0.22
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.017
    const lg = ctx.createGain(); lg.gain.value = 0.1
    lfo.connect(lg).connect(g.gain)
    o.connect(g); o2.connect(g); g.connect(pad)
    o.start(); o2.start(); lfo.start()
    return [o, o2]
  })

  // the rising water: pink-ish rush with a slow shimmer, in space
  const wf = A.src(A.noise)
  const wb = ctx.createBiquadFilter(); wb.type = 'bandpass'; wb.frequency.value = 1100; wb.Q.value = 0.35
  const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 4200
  const wg = ctx.createGain(); wg.gain.value = 0
  const wpan = A.makePanner(10, 1.0)
  wf.connect(wb).connect(wl).connect(wg).connect(wpan).connect(out)
  wg.connect(A.reverb)
  A.setPos(wpan, POND.x, 8, POND.z)
  ;[n1, n2, n3, wf].forEach((s) => s.start())

  // a bird: a few FM chirps glissing down or up, from somewhere around you
  function bird(t, game) {
    const p = A.makePanner(6, 1.2)
    const dest = ctx.createGain(); dest.gain.value = 0.5
    p.connect(dest).connect(out)
    dest.connect(A.reverb)
    const c = game.camera.position
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 60
    A.setPos(p, c.x + Math.cos(a) * r, c.y + 4 + Math.random() * 18, c.z + Math.sin(a) * r)
    const base = 2200 + Math.random() * 2400
    const n = 2 + Math.floor(Math.random() * 6)
    const kind = Math.random()
    for (let i = 0; i < n; i++) {
      const t0 = t + i * (0.09 + Math.random() * 0.12)
      const d = 0.05 + Math.random() * 0.1
      const o = ctx.createOscillator()
      const m = ctx.createOscillator()
      const mg = ctx.createGain()
      const g = ctx.createGain()
      const f0 = base * (1 + (Math.random() - 0.5) * 0.3)
      o.frequency.setValueAtTime(f0, t0)
      o.frequency.exponentialRampToValueAtTime(f0 * (kind < 0.5 ? 0.62 : 1.35), t0 + d)
      m.frequency.value = 60 + Math.random() * 180
      mg.gain.value = f0 * 0.12
      m.connect(mg).connect(o.frequency)
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.03 + Math.random() * 0.03, t0 + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
      o.connect(g).connect(p)
      o.start(t0); m.start(t0)
      o.stop(t0 + d + 0.05); m.stop(t0 + d + 0.05)
    }
    setTimeout(() => { p.disconnect(); dest.disconnect() }, 4000)
  }

  let chord = 0, ct = 0, gust = 0.5, gt = 0, bt = 2
  return {
    update(dt, game, inside) {
      const t = ctx.currentTime
      ct += dt
      if (ct > 16) {
        ct = 0
        chord = (chord + 1) % chords.length
        voices.forEach(([o, o2], i) => {
          o.frequency.setTargetAtTime(chords[chord][i], t, 3)
          o2.frequency.setTargetAtTime(chords[chord][i] * 1.003, t, 3)
        })
      }
      gt -= dt
      if (gt <= 0) { gt = 2 + Math.random() * 5; gust = Math.random() }
      g1.gain.setTargetAtTime(0.03 + gust * 0.06, t, 1.4)
      bp.frequency.setTargetAtTime(450 + gust * 700, t, 1.6)
      g2.gain.setTargetAtTime(0.008 + gust * gust * 0.03, t, 1.2)
      bt -= dt
      if (bt <= 0) {
        bt = 1.2 + Math.random() * 5
        if (inside) bird(t + 0.05, game)
      }
      wg.gain.setTargetAtTime(inside ? 0.5 : 0, t, 0.5)
    },
    nodes: voices.flat(),
  }
})
