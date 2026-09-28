// Minimal universe used as a placeholder (and as a fallback if a world fails
// to build): gradient sky, flat ground, the return door and the next key.
import * as THREE from 'three'
import { World } from '../engine/world.js'
import { makeEnv } from '../engine/env.js'
import { makeSkyDome } from '../engine/skydome.js'
import { addDoor } from '../engine/door.js'
import { KeyItem } from '../engine/key.js'
import { makeStoneMaterial } from '../engine/materials.js'
import { fog } from '../lib/glsl.js'
import { WORLDS, KEYS } from '../story.js'

export class StubWorld extends World {
  constructor(game, id, nextKey) {
    super(game, { id, ...WORLDS[id] })
    this.nextKey = nextKey
  }

  async build() {
    const pal = WORLDS[this.id].palette
    this.env = makeEnv({
      sunDir: [0.3, 0.4, 0.8], sunColor: [1.2, 1.1, 1.0],
      ambTop: pal[1], ambHorizon: pal[0], fogColor: pal[0], fogDensity: 0.004, fogFalloff: 0.01,
    })
    const sky = makeSkyDome({
      uniforms: { ...this.env.uniforms, uA: { value: new THREE.Vector3(...pal[0]) }, uB: { value: new THREE.Vector3(...pal[1]) } },
      body: `uniform vec3 uA; uniform vec3 uB; ${fog}
        vec3 skyColor(vec3 d) { return mix(uA, uB, clamp(d.y * 1.5, 0.0, 1.0)); }`,
    })
    this.scene.add(sky)
    const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2), makeStoneMaterial(this.env, { color: pal[0].map((v) => v * 0.6), color2: pal[0], rough: 0.9 }))
    this.scene.add(ground)
    this.door = addDoor(this, {
      id: this.id + '-return', x: 0, y: 0, z: 0, yaw: 0,
      color: WORLDS[this.id].color, palette: [[0.6, 0.32, 0.14], [0.35, 0.5, 0.75]],
      glyph: KEYS[this.id].glyph, locked: false,
    })
    if (this.nextKey) new KeyItem(this, { id: this.nextKey, ...KEYS[this.nextKey], x: 0, y: 1.7, z: 40 })
    this.spawn = { x: 0, y: 0, z: 6, yaw: Math.PI }
  }

  groundAt() { return 0 }
}
