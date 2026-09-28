// Il Giardino di Vetro. Dawn over an endless salt flat where hexagonal
// crystals grow as tall as towers. Three of them remember a chord: wake them
// and the great crystal opens, letting go of the key it has kept inside.

import * as THREE from 'three'
import { World } from '../engine/world.js'
import { makeEnv } from '../engine/env.js'
import { addDoor } from '../engine/door.js'
import { KeyItem } from '../engine/key.js'
import { makeStoneMaterial } from '../engine/materials.js'
import { WORLDS, KEYS, LINES } from '../story.js'
import { SUN, HEART, RES, VALLEY, saltHeight } from './crystal/layout.js'
import { bakeSkyLUT, makeCrystalSky } from './crystal/sky.js'
import { makeGround, NCAST, NSTEP } from './crystal/ground.js'
import { prismGeometry, makeInstanced, makeCrystalMaterial } from './crystal/prisms.js'
import { buildField } from './crystal/field.js'
import { makeMotes, makeShafts, makeGlows, makeShards } from './crystal/air.js'
import { glass } from './crystal/sound.js' // also registers the ambience

const SUN_COLOR = [2.7, 1.85, 1.35]
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

// timeline of the opening, in seconds after the chord
const OPEN = { glow: 1.2, dissolve0: 1.4, dissolve1: 8.5, petals0: 1.8, petals1: 10, descend0: 8.2, descend1: 11.5 }

export class Crystal extends World {
  constructor(game) {
    super(game, { id: 'crystal', ...WORLDS.crystal })
    this.surface = 'crystal'
    this.slopePhysics = false
    this.gravity = 20
    this.jump = 6.8
    this.grade = { exposure: 1.0, bloom: 0.8, saturation: 1.05, contrast: 1.04, grain: 0.03, haze: 0 }
    this.stepHead = 0
    this.woken = 0
    this.opening = null
    this.opened = false
    this.heartGone = false
  }

  async build(renderer) {
    const lut = bakeSkyLUT(renderer, {
      uSunDir: { value: new THREE.Vector3(...SUN) },
      uSunColor: { value: new THREE.Vector3(...SUN_COLOR) },
    })
    this.env = makeEnv({
      sunDir: SUN,
      sunColor: SUN_COLOR,
      ambTop: [0.3, 0.28, 0.46],
      ambHorizon: [0.62, 0.45, 0.5],
      ambGround: [0.5, 0.42, 0.46],
      fogColor: [1, 1, 1],
      fogDensity: 0.0011,
      fogBase: 0,
      fogFalloff: 0.012,
      fogSun: 0,
      skyLUT: lut,
    })
    this.times = []

    // sky
    this.sky = makeCrystalSky(this.env)
    this.scene.add(this.sky)
    this.times.push(this.sky.userData.u)

    // ground
    this.ground = makeGround(this.env, { stepColor: [1.0, 0.5, 0.78] })
    this.groundU = this.ground.userData.u
    this.scene.add(this.ground)
    this.times.push(this.groundU)

    // crystals
    const field = buildField()
    this.field = field
    const geo = prismGeometry()
    const saltLit = new THREE.Vector3(0.5, 0.4, 0.44)
    this.wakeU = [0, 1, 2].map(() => new THREE.Vector4(0, 0.4, 0, 0))
    const wakeCol = RES.map((r) => new THREE.Vector3(...r.tint))
    const shared = {
      uTime: { value: 0 },
      uOpen: { value: 0 },
      uSaltLit: { value: saltLit },
      uWake: { value: this.wakeU },
      uWakeCol: { value: wakeCol },
    }
    this.crystalU = shared
    const mat = makeCrystalMaterial(this.env, shared)
    // (the resonant crystals and the petals live in field.crystals too)
    this.crystals = makeInstanced(geo, mat, field.crystals)
    this.scene.add(this.crystals)

    // the great crystal: see-through, dissolving
    const hc = field.heart
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(hc.q)
    const base = new THREE.Vector3(hc.x, hc.y, hc.z)
    const keyAt = base.clone().addScaledVector(axis, HEART.keyY - hc.y + saltHeight(hc.x, hc.z))
    this.keyHome = keyAt.clone()
    this.heartU = {
      uTime: shared.uTime,
      uOpen: { value: 0 },
      uSaltLit: shared.uSaltLit,
      uWake: shared.uWake,
      uWakeCol: shared.uWakeCol,
      uKeyPos: { value: keyAt.clone() },
      uKeyCol: { value: new THREE.Vector3(...KEYS.void.color.map((v) => v * v * 1.4)) },
      uFront: { value: 1e4 },
      uHeartGlow: { value: 1 },
    }
    this.heartMat = makeCrystalMaterial(this.env, this.heartU, true)
    this.heart = makeInstanced(geo, this.heartMat, [hc])
    this.heart.renderOrder = 30
    this.scene.add(this.heart)
    this.heartTop = hc.H + hc.K * hc.R * hc.taper

    // colliders
    this.colliders.push(...field.colliders)
    this.colliders.push({ type: 'circle', x: hc.x, z: hc.z, r: HEART.R * 0.98, enabled: () => !this.heartGone })

    // ground shadows and light pools
    field.casters.forEach((c, i) => {
      if (i >= NCAST) return
      this.groundU.uCasters.value[i].set(c.x, c.z, c.r, c.h)
      this.groundU.uCastTint.value[i].set(...c.tint.map((v) => 0.35 + v * 0.65))
    })
    this.heartCaster = this.groundU.uCasters.value[0]
    this.heartCasterH = field.casters[0].h
    const pools = this.groundU.uPools.value
    const poolCol = this.groundU.uPoolCol.value
    RES.forEach((r, i) => { pools[i].set(r.x, r.z, 9, 0.3); poolCol[i].set(...r.tint.map((v) => v * v)) })
    pools[3].set(hc.x, hc.z, 14, 0.25)
    poolCol[3].set(...KEYS.void.color)

    // air
    this.motes = makeMotes(this.env)
    this.scene.add(this.motes)
    this.times.push(this.motes.userData.u)
    this.shafts = makeShafts(this.env, this.shaftList())
    this.scene.add(this.shafts)
    this.times.push(this.shafts.userData.u)
    const glows = []
    RES.forEach((r, i) => {
      const main = field.res[i][0]
      glows.push({ x: r.x, y: saltHeight(r.x, r.z) + main.H * 0.5, z: r.z, w: 13, h: 13, kind: 0, slot: i, color: r.tint.map((v) => v * v) })
      glows.push({ x: r.x, y: saltHeight(r.x, r.z), z: r.z, w: 3.2, h: 260, kind: 1, slot: 3 + i, color: r.tint })
    })
    glows.push({ x: keyAt.x, y: keyAt.y, z: keyAt.z, w: 26, h: 26, kind: 0, slot: 6, color: KEYS.void.color.map((v) => v * v) })
    this.glows = makeGlows(this.env, glows)
    this.glowI = this.glows.userData.u.uI.value
    this.scene.add(this.glows)
    this.shards = makeShards(this.env, 720, {
      x: hc.x, y: hc.y, z: hc.z, keyY: 1.8 + saltHeight(hc.x, hc.z),
      R: HEART.R, H: this.heartTop, speed: this.heartTop / (OPEN.dissolve1 - OPEN.dissolve0),
      color: KEYS.void.color,
    })
    this.scene.add(this.shards)
    this.times.push(this.shards.userData.u)

    // resonant state
    this.res = RES.map((r, i) => ({
      ...r, i, awake: false, level: 0, flash: 0,
      touch: (i === 2 ? 2.4 : i === 1 ? 2.2 : 1.7) + 1.3,
    }))

    // return door
    const stone = makeStoneMaterial(this.env, {
      color: [0.026, 0.022, 0.028],
      color2: [0.055, 0.046, 0.056],
      rough: 0.32,
      bump: 0.16,
      scale: 0.9,
      spec: 1.2,
    })
    this.door = addDoor(this, {
      id: 'crystal-return', x: 0, y: 0, z: 0, yaw: 0,
      locked: false, stone,
      color: WORLDS.crystal.color, glyph: KEYS.crystal.glyph,
      palette: [[0.6, 0.32, 0.14], [0.35, 0.5, 0.75]],
    })

    // the key, sealed in the great crystal: visible, not yet yours
    this.key = new KeyItem(this, { id: 'void', ...KEYS.void, x: keyAt.x, y: keyAt.y, z: keyAt.z, hidden: true, beam: 240 })
    this.key.group.visible = true
    this.setBeam(0.12)

    this.spawn = { x: 0, y: 0, z: 5, yaw: Math.PI }
  }

  shaftList() {
    // low dawn light streaming between the crystals toward the eye
    const out = []
    const S = new THREE.Vector3(...SUN)
    const side = new THREE.Vector3(S.z, 0, -S.x).normalize()
    let s = 7
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
    for (let i = 0; i < 18; i++) {
      const lat = (rnd() - 0.5) * 520
      const back = 240 + rnd() * 260
      const o = new THREE.Vector3(VALLEY.x, 0, VALLEY.z).addScaledVector(side, lat).addScaledVector(S, back)
      o.y = 40 + rnd() * 70
      out.push({ x: o.x, y: o.y, z: o.z, w: 6 + rnd() * 22, len: 520 + rnd() * 300, i: 0.4 + rnd() * 0.8 })
    }
    return out
  }

  setBeam(a) {
    const k = this.key
    if (k.beam) k.beam.material.uniforms.uAmp.value = a
    if (k.wide) k.wide.material.uniforms.uAmp.value = a
  }

  groundAt(x, z) { return saltHeight(x, z) }

  normalAt(x, z, out) {
    const e = 0.6
    const hx = saltHeight(x + e, z) - saltHeight(x - e, z)
    const hz = saltHeight(x, z + e) - saltHeight(x, z - e)
    return out.set(-hx, 2 * e, -hz).normalize()
  }

  constrain(pos, vel) {
    const dx = pos.x - VALLEY.x, dz = pos.z - VALLEY.z
    const d = Math.hypot(dx, dz)
    if (d > VALLEY.soft) {
      const k = Math.min(1, (d - VALLEY.soft) / (VALLEY.hard - VALLEY.soft))
      vel.x -= (dx / d) * (0.2 + k * 0.8)
      vel.z -= (dz / d) * (0.2 + k * 0.8)
    }
    if (d > VALLEY.hard) {
      pos.x = VALLEY.x + (dx / d) * VALLEY.hard
      pos.z = VALLEY.z + (dz / d) * VALLEY.hard
    }
  }

  onStep(x, z, heading, speed) {
    const s = this.groundU.uSteps.value[this.stepHead]
    s.set(x, z, this.time, 0.5 + Math.min(1, speed / 9) * 0.5)
    this.stepHead = (this.stepHead + 1) % NSTEP
  }

  update(dt, t, game) {
    super.update(dt, t)
    for (const u of this.times) u.uTime.value = t
    this.crystalU.uTime.value = t
    this.motes.userData.u.uPx.value = (game?.bufferSize?.y || 720) / 720

    // the resonant crystals breathe until woken, then stay lit
    for (const r of this.res) {
      r.level += ((r.awake ? 1 : 0) - r.level) * (1 - Math.exp(-dt * 1.2))
      r.flash *= Math.exp(-dt * 1.6)
      const breath = 0.32 + 0.22 * Math.sin(t * 1.25 + r.i * 2.1) + 0.08 * Math.sin(t * 3.1 + r.i)
      const w = this.wakeU[r.i]
      w.set(r.level, breath * (1 - r.level * 0.5), r.flash, 0)
      this.glowI[r.i] = (0.5 + breath * 1.6) * (1 - r.level) + r.level * 2.2 + r.flash * 2
      this.glowI[3 + r.i] = r.level * (0.9 + 0.2 * Math.sin(t * 2 + r.i)) + r.flash
      this.groundU.uPools.value[r.i].w = 0.4 + breath * 0.9 + r.level * 1.4 + r.flash
    }
    const hg = this.heartU.uHeartGlow.value
    this.glowI[6] = this.heartGone ? 0 : (0.9 + 0.25 * Math.sin(t * 0.9)) * hg

    if (game && game.current === this) {
      const p = game.player.pos
      for (const r of this.res) {
        if (!r.awake && Math.hypot(p.x - r.x, p.z - r.z) < r.touch) this.wake(r, game)
      }
    }
    if (this.opening) this.animateOpening(dt, game)
  }

  wake(r, game) {
    r.awake = true
    r.flash = 1.4
    this.woken++
    const a = game.audio
    if (a.ctx) {
      const now = a.ctx.currentTime
      a.bell(r.note, now, 0.11, 6)
      glass(a, r.note * 2, now + 0.05, 0.05, 5, a.sfx)
    }
    game.hud.say(LINES.crystal.ring(this.woken), 3)
    if (this.woken === 3 && !this.opening) this.opening = { t: -2.2, chord: false, said: false }
  }

  animateOpening(dt, game) {
    const o = this.opening
    o.t += dt
    const t = o.t
    if (t < 0) return
    if (!o.chord) {
      o.chord = true
      const a = game?.audio
      if (a?.ctx) {
        const now = a.ctx.currentTime
        ;[110, 220, 329.63, 440, 554.37, 659.25, 880].forEach((f, i) => a.bell(f, now + i * 0.11, i < 2 ? 0.1 : 0.07, 8))
        a.shimmer(now + 0.4, 4)
      }
      game?.hud.say(LINES.crystal.open, 4)
      for (const r of this.res) r.flash = 1
    }
    this.heartU.uHeartGlow.value = 1 + smooth(0, OPEN.glow, t) * 1.6 - smooth(OPEN.dissolve1 - 1, OPEN.dissolve1 + 1, t) * 1.2
    // dissolving from the top, in light
    const k = smooth(OPEN.dissolve0, OPEN.dissolve1, t)
    const front = this.heartTop + 3 - k * (this.heartTop + 6)
    this.heartU.uFront.value = front
    this.heartCaster.w = Math.max(0, Math.min(this.heartCasterH, front + this.field.heart.y))
    this.shards.visible = t > OPEN.dissolve0 - 0.1
    this.shards.userData.u.uT.value = t - OPEN.dissolve0
    if (t > OPEN.dissolve1 + 0.3 && !this.heartGone) {
      this.heartGone = true
      this.heart.visible = false
    }
    // the petals lean away
    this.crystalU.uOpen.value = ease(smooth(OPEN.petals0, OPEN.petals1, t))
    // the key comes down to you
    const d = ease(smooth(OPEN.descend0, OPEN.descend1, t))
    const g = saltHeight(this.keyHome.x, this.keyHome.z)
    this.key.group.position.y = this.keyHome.y + (g + 1.8 - this.keyHome.y) * d
    this.setBeam(0.12 + 0.88 * smooth(OPEN.dissolve1 - 2, OPEN.descend1, t))
    if (t > OPEN.descend1 && !this.opened) {
      this.opened = true
      this.key.hidden = false
    }
    if (t > OPEN.petals1 + 14) {
      this.opening = null
    }
  }

  onEnter(game) {
    if (!this.hinted) {
      this.hinted = true
      setTimeout(() => game.current === this && game.hud.say(LINES.crystal.hint, 6), 4500)
    }
  }
}
