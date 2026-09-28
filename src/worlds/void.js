// L'Abisso. Deep space, silent and vast. A path of hexagonal glass tiles
// winds through nothing; it exists only under your steps. Far below, a spiral
// galaxy turns. Ahead, a black hole bends the light of everything behind it.
// Follow the stars to the platform that faces it: the key waits there.

import * as THREE from 'three'
import { World } from '../engine/world.js'
import { makeEnv } from '../engine/env.js'
import { addDoor } from '../engine/door.js'
import { KeyItem } from '../engine/key.js'
import { makeStoneMaterial } from '../engine/materials.js'
import { WORLDS, KEYS, LINES } from '../story.js'
import { buildLayout, hexRound, cellKey, BH, KEY_AT } from './void/layout.js'
import { makeCosmicUniforms, makeTargets, bakeNebula, bakeEnv, makeSky, makeGalaxyDisk, makeGalaxyPoints, makeHole } from './void/cosmos.js'
import { makeTiles, makeShards, makeMarkers, makeDust, STEPS } from './void/path.js'
import { voice } from './void/audio.js'

const FALL_Y = -40
const FADE = [0.004, 0.002, 0.01]

export class Void extends World {
  constructor(game) {
    super(game, { id: 'void', ...WORLDS.void })
    this.surface = 'glass'
    this.slopePhysics = false
    this.gravity = 9
    this.jump = 6.5
    this.grade = { exposure: 1.0, haze: 0, saturation: 1.06, contrast: 1.05, bloom: 1.0, grain: 0.02 }
    this.stepHead = 0
    this.safe = null
    this.fall = null
    this.fading = false
    this.hinted = false
  }

  async build(renderer) {
    // the bakes' targets exist first: the env map is every material's reflection
    this.targets = makeTargets()
    const mid = new THREE.Vector3(0, 4, 150)
    const toHole = new THREE.Vector3(BH.x, BH.y, BH.z).sub(mid).normalize()
    this.env = makeEnv({
      sunDir: toHole.toArray(),
      sunColor: [1.0, 0.68, 0.4],
      ambTop: [0.018, 0.011, 0.036],
      ambHorizon: [0.012, 0.009, 0.024],
      ambGround: [0.045, 0.036, 0.048],
      fogColor: [1, 1, 1],
      fogDensity: 0.00002,
      fogBase: 0,
      fogFalloff: 0,
      fogSun: 0,
      skyLUT: this.targets.env.texture,
    })
    this.U = makeCosmicUniforms(this.targets.neb.texture)
    bakeNebula(renderer, this.targets.neb)
    bakeEnv(renderer, this.targets.env, this.U, mid)

    const px = renderer.getPixelRatio()
    this.L = buildLayout()
    this.scene.add(makeSky(this.env, this.U))
    this.scene.add(makeGalaxyDisk(this.env, this.U))
    this.scene.add(makeGalaxyPoints(this.env, this.U, 170000, px))
    this.scene.add(makeHole(this.env, this.U))
    this.tiles = makeTiles(this.env, this.U, this.L.tiles)
    this.scene.add(this.tiles.mesh)
    for (const m of makeShards(this.env, this.U, this.L.shards)) this.scene.add(m)
    this.scene.add(makeMarkers(this.env, this.U, this.L.markers, px))
    this.scene.add(makeDust(this.env, this.U, px))

    const stone = makeStoneMaterial(this.env, {
      color: [0.009, 0.008, 0.013],
      color2: [0.02, 0.017, 0.028],
      rough: 0.28,
      bump: 0.03,
      scale: 0.5,
      spec: 1.2,
    })
    this.door = addDoor(this, {
      id: 'void-return', x: 0, y: 0, z: 0, yaw: 0,
      color: WORLDS.void.color,
      palette: [[0.6, 0.32, 0.14], [0.35, 0.5, 0.75]],
      glyph: KEYS.void.glyph,
      locked: false, stone,
      size: { sill: 0.9 },
    })

    this.key = new KeyItem(this, { id: 'garden', ...KEYS.garden, x: KEY_AT.x, y: KEY_AT.y + 1.7, z: KEY_AT.z, beam: 0 })
    this.key.motes.renderOrder = 12
    this.tiles.u.uKey.value.set(KEY_AT.x, KEY_AT.y + 1.7, KEY_AT.z, 1)

    this.spawn = { x: 0, y: 0, z: 5.5, yaw: Math.PI }
    this.safe = this.tileAt(0, 5.5)
  }

  tileAt(x, z) {
    const [q, r] = hexRound(x, z)
    return this.L.lookup.get(cellKey(q, r)) || null
  }

  groundAt(x, z, y) {
    const t = this.tileAt(x, z)
    if (!t) return null
    if (y !== undefined && y < t.top - 0.6) return null
    return t.top
  }

  constrain(pos) {
    if (pos.y < FALL_Y) this.respawn()
  }

  // the void gives you back, on the last tile that held you, facing on
  respawn() {
    const g = this.game
    const p = g.player
    const t = this.safe || this.L.tiles[0]
    const yaw = Math.atan2(-t.tan.x, -t.tan.z)
    p.place(t.x, t.top, t.z, yaw)
    p.pitch = -0.14
    p.airTime = 0
    this.fall = { t: 0 }
    g.hud.say(LINES.void.fall, 3)
    g.audio.whoosh()
  }

  onStep(x, z, heading, speed) {
    const s = this.tiles.u.uSteps.value[this.stepHead]
    s.set(x, z, this.time, 0.55 + Math.min(1, speed / 9) * 0.5)
    this.stepHead = (this.stepHead + 1) % STEPS
  }

  update(dt, t, game) {
    super.update(dt, t)
    this.U.uTime.value = t
    this.U.uGalRot.value = t * 0.0025
    const ku = this.tiles.u.uKey.value
    ku.w += ((this.key.taken ? 0 : 1) - ku.w) * (1 - Math.exp(-dt * 1.5))
    if (game && game.current === this) this.play(dt, t, game)
  }

  play(dt, t, game) {
    const pl = game.player
    const p = pl.pos
    const st = this.tiles.state
    const under = pl.onGround ? this.tileAt(p.x, p.z) : null
    if (under && Math.abs(under.top - p.y) < 0.05) {
      this.safe = under
      if (!under.visited) under.visited = 1
    }
    let dirty = false
    for (const tile of this.L.tiles) {
      const d = Math.hypot(tile.x - p.x, tile.z - p.z, (tile.top - p.y) * 1.5)
      const target = d < 10 ? 1 : 0
      const prev = tile.lit
      const rate = target > prev ? 3.2 / (1 + d * 0.22) : 0.4
      tile.lit += (target - prev) * (1 - Math.exp(-dt * rate))
      if (Math.abs(tile.lit - prev) > 1e-4 || st[tile.i * 2 + 1] !== tile.visited) {
        st[tile.i * 2] = tile.lit
        st[tile.i * 2 + 1] = tile.visited
        dirty = true
      }
      if (prev < 0.5 && tile.lit >= 0.5 && t - tile.pinged > 8) {
        tile.pinged = t
        voice.ping?.(Math.floor(tile.seed * 97), 0.7 + 0.3 * (1 - d / 10))
      }
    }
    if (dirty) this.tiles.stateAttr.needsUpdate = true

    // a slow fade to black as you fall, and back when the void returns you
    const f = game.post.u.fade.value
    if (this.fall) {
      this.fall.t += dt
      const k = Math.max(0, 1 - this.fall.t / 1.8)
      f.set(FADE[0], FADE[1], FADE[2], k * k)
      this.fading = true
      if (this.fall.t > 1.8) { this.fall = null; f.w = 0; this.fading = false }
    } else if (p.y < -6) {
      const k = Math.min(1, (-6 - p.y) / 30)
      f.set(FADE[0], FADE[1], FADE[2], k * k)
      this.fading = true
    } else if (this.fading) {
      f.w = 0
      this.fading = false
    }
  }

  onEnter(game) {
    if (!this.hinted) {
      this.hinted = true
      setTimeout(() => game.current === this && game.hud.say(LINES.void.hint, 6), 4500)
    }
  }

  onLeave() {
    if (this.fading) {
      this.game.post.u.fade.value.w = 0
      this.fading = false
      this.fall = null
    }
  }
}
