// Base class for every universe. A world owns a scene, an environment
// (light + fog uniforms), its doors, its keys and its colliders.

import * as THREE from 'three'

const _l = new THREE.Vector2()

export class World {
  constructor(game, o) {
    this.game = game
    this.id = o.id
    this.name = o.name
    this.subtitle = o.subtitle || ''
    this.scene = new THREE.Scene()
    this.scene.matrixWorldAutoUpdate = true
    this.portals = []
    this.items = []
    this.colliders = []
    this.gravity = 20
    this.jump = 6.8
    this.spawn = { x: 0, y: 0, z: 0, yaw: 0 }
    this.surface = 'sand'
    this.ambience = null // audio bus, set by the audio system
    this.grade = {} // post overrides while inside
    this.time = 0
    this.visited = false
  }

  // must set this.env before doors/keys are added
  async build() {}

  groundAt() { return 0 }
  normalAt(x, z, out) { return out.set(0, 1, 0) }

  collide(pos, r) {
    for (const c of this.colliders) {
      if (c.enabled && !c.enabled()) continue
      if (c.type === 'circle') {
        const dx = pos.x - c.x, dz = pos.z - c.z
        const rr = c.r + r
        const d2 = dx * dx + dz * dz
        if (d2 < rr * rr && (c.y1 === undefined || (pos.y < c.y1 && pos.y > c.y0 - 2))) {
          const d = Math.sqrt(d2) || 1e-4
          pos.x = c.x + (dx / d) * rr
          pos.z = c.z + (dz / d) * rr
        }
      } else if (c.type === 'box') {
        if (pos.y > c.y1 || pos.y < c.y0) continue
        const dx = pos.x - c.x, dz = pos.z - c.z
        if (Math.abs(dx) > c.hx + c.hz + r + 1 && Math.abs(dz) > c.hx + c.hz + r + 1) continue
        _l.set(c.c * dx - c.s * dz, c.s * dx + c.c * dz)
        const ex = c.hx + r, ez = c.hz + r
        if (Math.abs(_l.x) < ex && Math.abs(_l.y) < ez) {
          const px = ex - Math.abs(_l.x), pz = ez - Math.abs(_l.y)
          if (px < pz) _l.x = Math.sign(_l.x || 1) * ex
          else _l.y = Math.sign(_l.y || 1) * ez
          // back to world
          pos.x = c.x + c.c * _l.x + c.s * _l.y
          pos.z = c.z - c.s * _l.x + c.c * _l.y
        }
      }
    }
  }

  update(dt, t) {
    this.time = t
    for (const p of this.portals) p.update(dt, t)
    for (const k of this.items) k.update(dt, t)
  }

  // called before this world is rendered by any camera (main or a portal eye)
  beforeRender() {}

  onEnter() {}
  onLeave() {}
  onStep() {}
}
