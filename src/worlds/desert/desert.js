// The hub. Endless dunes at golden hour, a ringed planet, five doors.

import * as THREE from 'three'
import { World } from '../../engine/world.js'
import { makeEnv } from '../../engine/env.js'
import { makeAtmosphere, bakeSkyLUT, skyAmbient } from '../../lib/atmosphere.js'
import { Terrain, loadHeights, heightGLSL } from './terrain.js'
import { makeDesertSky } from './sky.js'
import { SUN, WIND, PLACES, RUINS, BOUND } from './layout.js'
import { addDoor } from '../../engine/door.js'
import { KeyItem, beamMaterial } from '../../engine/key.js'
import { makeStoneMaterial, makeGlowMaterial } from '../../engine/materials.js'
import { glyphGeometry } from '../../engine/glyphs.js'
import { WORLDS, KEYS, LINES } from '../../story.js'
import { makeDust } from './dust.js'
import { fog } from '../../lib/glsl.js'
import { Bursts } from '../../engine/bursts.js'

const SUNV = new THREE.Vector3(...SUN)

export class Desert extends World {
  constructor(game) {
    super(game, { id: 'desert', ...WORLDS.desert })
    this.surface = 'sand'
    this.grade = { exposure: 0.74, haze: 0.7, saturation: 1.1, contrast: 1.06, bloom: 0.6 }
    this.prints = []
    this.printHead = 0
  }

  async build(renderer, onProgress = () => {}) {
    const data = await loadHeights((p) => onProgress(p * 0.8))
    const terrain = new Terrain(data)
    terrain.wind = WIND
    terrain.bake(renderer)
    this.terrain = terrain
    onProgress(0.85)

    // atmosphere: dusty, warm, low sun
    const atmo = makeAtmosphere({ mie: 22e-6, shM: 1.3e3, mieAbs: [1, 0.88, 0.7], g: 0.8 })
    const T = atmo.sunTransmittance(...SUN)
    const lut = bakeSkyLUT(atmo, SUN, 256, 128, [0.55, 0.38, 0.24])
    const amb = skyAmbient(atmo, SUN)
    const sunI = 22 / Math.PI
    this.sunColor = T.map((v) => v * sunI * 0.8)

    const objShadow = {
      uHeight: { value: terrain.heightTex },
      uBaked: { value: terrain.baked.texture },
      uObjShadow: { value: null },
      uObjShadowMat: { value: new THREE.Matrix4() },
      uObjShadowOn: { value: 0 },
    }
    this.env = makeEnv({
      sunDir: SUN,
      sunColor: this.sunColor,
      ambTop: amb.zenith.map((v) => v * 3.4),
      ambHorizon: amb.horizon.map((v) => v * 2.0),
      ambGround: [0.5, 0.26, 0.12],
      fogColor: [1, 1, 1],
      fogDensity: 0.00042,
      fogBase: 0,
      fogFalloff: 0.012,
      fogSun: 0.18,
      skyLUT: lut,
      extraUniforms: objShadow,
      shadowGLSL: /* glsl */ `
        precision highp sampler2D;
        uniform sampler2D uHeight;
        uniform sampler2D uBaked;
        uniform sampler2D uObjShadow;
        uniform mat4 uObjShadowMat;
        uniform float uObjShadowOn;
        ${heightGLSL}
        float objShadowAt(vec3 p) {
          if (uObjShadowOn < 0.5) return 1.0;
          vec4 sc = uObjShadowMat * vec4(p, 1.0);
          vec3 c = sc.xyz / sc.w;
          if (any(lessThan(c.xy, vec2(0.0))) || any(greaterThan(c.xy, vec2(1.0)))) return 1.0;
          float s = 0.0;
          for (int k = 0; k < 8; k++) {
            float a = float(k) * 2.39996;
            vec2 o = vec2(cos(a), sin(a)) * sqrt((float(k) + 0.5) / 8.0) * 1.6 / 4096.0;
            s += (c.z - 0.00012 > texture(uObjShadow, c.xy + o).r) ? 0.0 : 1.0;
          }
          return s / 8.0;
        }
        float worldShadow(vec3 p) {
          float h = heightL(p.xz, 0);
          float up = max(p.y - h, 0.0);
          vec2 q = p.xz - uSunDir.xz / uSunDir.y * up;
          float ts = texture(uBaked, bakedUV(q)).b;
          return min(ts, objShadowAt(p + uSunDir * 0.25));
        }
      `,
    })
    this.env.lut = lut
    this.env.atmo = atmo

    const mesh = terrain.buildMesh(this.env)
    this.scene.add(mesh)
    this.sky = makeDesertSky(this.env)
    this.scene.add(this.sky)

    this.dust = makeDust(terrain, this.env, { count: 4200, box: 80 })
    this.wisps = makeDust(terrain, this.env, { count: 520, box: 260, wisps: true })
    this.scene.add(this.dust, this.wisps)

    this.buildDoors()
    this.buildRuins()
    this.buildKeys()
    this.bakeObjectShadows(renderer)
    this.spray = new Bursts(this, { count: 900, size: 0.05, additive: false, drag: 1.1, gravity: 7 })
    onProgress(1)

    const sp = PLACES.spawn
    this.spawn = { x: sp.x, y: terrain.heightAt(sp.x, sp.z), z: sp.z, yaw: Math.atan2(sp.x - PLACES.key1.x, sp.z - PLACES.key1.z) }
  }

  panHeight(name) {
    const p = PLACES[name]
    return this.terrain.heightAt(p.x, p.z)
  }

  buildDoors() {
    const stone = makeStoneMaterial(this.env, {
      color: [0.03, 0.026, 0.024],
      color2: [0.042, 0.035, 0.031],
      rough: 0.4,
      bump: 0.18,
      scale: 0.32,
      spec: 1.0,
      sandLine: 0.8,
    })
    this.stone = stone
    const facing = (from, to) => Math.atan2(PLACES[to].x - PLACES[from].x, PLACES[to].z - PLACES[from].z)
    this.doors = {}
    const defs = [
      ['sea', facing('sea', 'spawn')],
      ['crystal', facing('crystal', 'gate')],
      ['void', facing('void', 'gate')],
      ['garden', facing('garden', 'gate')],
    ]
    for (const [id, yaw] of defs) {
      const p = PLACES[id]
      const w = WORLDS[id]
      this.doors[id] = addDoor(this, {
        id: 'desert-' + id,
        x: p.x, y: this.panHeight(id), z: p.z, yaw,
        color: w.color, palette: w.palette, glyph: KEYS[id].glyph,
        locked: true, keyId: id, stone,
      })
    }
    this.buildGate(stone)
  }

  // La Grande Soglia: the same door, colossal, with four sockets
  buildGate(stone) {
    const y = this.panHeight('gate')
    const gate = addDoor(this, {
      id: 'desert-gate', x: 0, y, z: 0, yaw: 0,
      color: WORLDS.origin.color, palette: WORLDS.origin.palette, glyph: 'gate',
      locked: true, keyId: 'gate', stone,
      size: { w: 13, h: 92, side: 11, top: 20, depth: 7, sill: 6 },
      liveRange: 700,
    })
    this.doors.gate = gate
    // four sockets up the pillars, one per universe
    this.sockets = {}
    const order = ['sea', 'crystal', 'void', 'garden']
    order.forEach((id, i) => {
      const m = makeGlowMaterial(this.env, { color: WORLDS[id].color, intensity: 0.15 })
      const g = new THREE.Mesh(glyphGeometry(KEYS[id].glyph, { size: 2.6, depth: 0.1, bevel: 0.02 }), m)
      const side = i % 2 ? 1 : -1
      g.position.set(side * (13 / 2 + 11 / 2), 22 + Math.floor(i / 2) * 26, 7 / 2 + 0.05)
      gate.group.add(g)
      this.sockets[id] = m
    })
  }

  buildRuins() {
    const sandstone = makeStoneMaterial(this.env, {
      color: [0.3, 0.19, 0.11],
      color2: [0.42, 0.28, 0.16],
      rough: 0.85,
      bump: 0.6,
      scale: 1.1,
      spec: 0.25,
      sandLine: 1.0,
    })
    const dark = this.stone
    const H = (x, z) => this.terrain.heightAt(x, z)
    const rnd = mulberry(4)
    for (const r of RUINS) {
      const g = new THREE.Group()
      g.position.set(r.x, H(r.x, r.z), r.z)
      g.rotation.y = r.yaw
      if (r.kind === 'ring') {
        const R = 13 * r.s
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 1.25 * r.s, 14, 96, Math.PI * 1.55), sandstone)
        ring.rotation.set(0.12, 0, 0.4)
        ring.position.y = R * 0.55
        g.add(ring)
        ring.layers.enable(1)
        // where the ring meets the sand, it blocks
        for (let k = 0; k < 2; k++) {
          const a = k ? -0.35 : Math.PI + 0.9
          const lx = Math.cos(a) * R, ly = Math.sin(a) * R
          if (ly < 0) {
            const wx = r.x + Math.cos(r.yaw) * lx
            const wz = r.z - Math.sin(r.yaw) * lx
            this.colliders.push({ type: 'circle', x: wx, z: wz, r: 1.6 * r.s })
          }
        }
      } else if (r.kind === 'columns') {
        const n = 6
        for (let i = 0; i < n; i++) {
          const broken = rnd() < 0.45
          const h = broken ? 2 + rnd() * 5 : 9 + rnd() * 3
          const lx = (i - (n - 1) / 2) * 6.2 * r.s
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, h, 20, 1), sandstone)
          const wx = r.x + Math.cos(r.yaw) * lx
          const wz = r.z - Math.sin(r.yaw) * lx
          col.position.set(lx, H(wx, wz) - g.position.y + h / 2 - 1.2, 0)
          col.rotation.z = (rnd() - 0.5) * 0.08
          col.layers.enable(1)
          g.add(col)
          if (!broken) {
            const cap = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 2.3), sandstone)
            cap.position.set(lx, col.position.y + h / 2 + 0.3, 0)
            cap.layers.enable(1)
            g.add(cap)
          }
          this.colliders.push({ type: 'circle', x: wx, z: wz, r: 1.0 })
        }
        // a fallen one
        const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 10, 20, 1), sandstone)
        fallen.rotation.set(0, 0, Math.PI / 2 - 0.05)
        fallen.rotation.y = 0.5
        fallen.position.set(2, H(r.x, r.z + 5) - g.position.y + 0.1, 5)
        fallen.layers.enable(1)
        g.add(fallen)
      } else if (r.kind === 'obelisk') {
        const h = 26 * r.s
        const geo = new THREE.CylinderGeometry(0.9 * r.s, 1.6 * r.s, h, 4, 1)
        geo.rotateY(Math.PI / 4)
        const ob = new THREE.Mesh(geo, dark)
        ob.position.y = h / 2 - 3
        ob.rotation.z = 0.14
        ob.layers.enable(1)
        g.add(ob)
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.9 * r.s * 1.414, 2.4 * r.s, 4), dark)
        tip.position.y = h / 2 + 1.2 * r.s
        ob.add(tip)
        this.colliders.push({ type: 'circle', x: r.x, z: r.z, r: 2.2 * r.s })
      }
      this.scene.add(g)
    }
  }

  buildKeys() {
    const k = PLACES.key1
    this.key1 = new KeyItem(this, {
      id: 'sea', ...KEYS.sea,
      x: k.x, y: this.terrain.heightAt(k.x, k.z) + 1.6, z: k.z,
    })
  }

  // one static sun shadow map for every caster in the desert
  bakeObjectShadows(renderer) {
    const size = 4096
    const R = 1000
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true })
    rt.depthTexture = new THREE.DepthTexture(size, size)
    rt.depthTexture.type = THREE.UnsignedIntType
    const cam = new THREE.OrthographicCamera(-R, R, R, -R, 400, 3000)
    cam.position.copy(SUNV).multiplyScalar(1500)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    cam.layers.set(1)
    const prevOverride = this.scene.overrideMaterial
    this.scene.overrideMaterial = new THREE.MeshDepthMaterial()
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(rt)
    renderer.clear()
    renderer.render(this.scene, cam)
    renderer.setRenderTarget(prev)
    this.scene.overrideMaterial = prevOverride
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    const m = bias.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse)
    const u = this.env.extraUniforms
    u.uObjShadow.value = rt.depthTexture
    u.uObjShadowMat.value.copy(m)
    u.uObjShadowOn.value = 1
    const tu = this.terrain.uniforms
    tu.uObjShadow.value = rt.depthTexture
    tu.uObjShadowMat.value.copy(m)
    tu.uObjShadowOn.value = 1
    this.shadowRT = rt
  }

  // an opened door sends a column of light up so you can always find it again
  onDoorOpened(p) {
    const H = p === this.doors.gate ? 900 : 520
    const top = p === this.doors.gate ? 112 : 12.9
    const c = p.color.toArray()
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, H, 16, 1, true).translate(0, H / 2, 0), beamMaterial(this.env, c, H))
    beam.position.set(0, top, 0)
    beam.frustumCulled = false
    p.group.add(beam)
    const wide = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, H * 0.5, 24, 1, true).translate(0, H * 0.25, 0), beamMaterial(this.env, c.map((v) => v * 0.2), H * 0.5))
    wide.position.copy(beam.position)
    wide.frustumCulled = false
    p.group.add(wide)
    this.beacons = this.beacons || []
    this.beacons.push(beam.material.uniforms, wide.material.uniforms)
  }

  groundAt(x, z) {
    return this.terrain.heightAt(x, z)
  }

  normalAt(x, z, out) {
    return this.terrain.normalAt(x, z, out)
  }

  constrain(pos, vel) {
    const d = Math.hypot(pos.x, pos.z)
    this.storm = Math.min(1, Math.max(0, (d - BOUND.soft) / (BOUND.hard - BOUND.soft)))
    if (d > BOUND.soft) {
      const push = this.storm * this.storm * 14
      vel.x -= (pos.x / d) * push * 0.016
      vel.z -= (pos.z / d) * push * 0.016
    }
    if (d > BOUND.hard) {
      pos.x *= BOUND.hard / d
      pos.z *= BOUND.hard / d
    }
  }

  onStep(x, z, heading) {
    const p = this.terrain.uniforms.uPrints.value
    const v = p[this.printHead]
    v.set(x, z, heading, 1)
    this.printHead = (this.printHead + 1) % p.length
  }

  update(dt, t, game) {
    super.update(dt, t)
    this.terrain.uniforms.uTime.value = t
    this.sky.userData.uniforms.uTime.value = t
    this.dust.userData.uniforms.uTime.value = t
    this.wisps.userData.uniforms.uTime.value = t
    const storm = this.storm || 0
    this.dust.userData.uniforms.uStorm.value = storm
    this.wisps.userData.uniforms.uStorm.value = storm
    this.env.uniforms.uFogDensity.value = 0.00042 + storm * storm * 0.03
    this.sky.userData.uniforms.uStorm.value = storm
    this.env.uniforms.uFogColor.value.set(1 + storm * 0.25, 1 - storm * 0.25, 1 - storm * 0.5)
    if (game && game.current === this && storm > 0.3 && !this.stormWarned) {
      this.stormWarned = true
      game.hud.say(LINES.storm, 4)
      setTimeout(() => (this.stormWarned = false), 20000)
    }
    for (const u of this.beacons || []) u.uTime.value = t
    // a door whose key you carry calls you with a thin pulsing thread of light
    if (game) {
      for (const [id, door] of Object.entries(this.doors)) {
        const calling = door.locked && game.inventory.has(door.keyId)
        if (calling && !door.calling) {
          const H = id === 'gate' ? 900 : 420
          const top = id === 'gate' ? 112 : 12.9
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, H, 12, 1, true).translate(0, H / 2, 0), beamMaterial(this.env, door.color.toArray(), H))
          const halo = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, H * 0.5, 16, 1, true).translate(0, H * 0.25, 0), beamMaterial(this.env, door.color.toArray().map((v) => v * 0.3), H * 0.5))
          halo.material.uniforms.uAmp = m.material.uniforms.uAmp
          halo.material.uniforms.uTime = m.material.uniforms.uTime
          m.add(halo)
          m.position.set(0, top, 0)
          m.frustumCulled = false
          halo.frustumCulled = false
          door.group.add(m)
          door.calling = m
        }
        if (door.calling) {
          const u = door.calling.material.uniforms
          u.uTime.value = t
          const target = door.locked ? 0.45 + 0.35 * Math.sin(t * 2.2) : 0
          u.uAmp.value += (target - u.uAmp.value) * (1 - Math.exp(-dt * 2))
          if (!door.locked && u.uAmp.value < 0.01) { door.calling.removeFromParent(); door.calling = null }
        }
      }
    }
    // sand kicked up behind you while you surf a slip face
    if (game && game.current === this) {
      const p = game.player
      if (p.onGround && p.surf > 0.2) {
        const n = Math.floor(p.surf * 10)
        const sc = this.sunColor
        for (let i = 0; i < n; i++) {
          const side = (Math.random() - 0.5) * 0.8
          const cx = Math.cos(p.yaw), sz = -Math.sin(p.yaw)
          this.spray.emit(p.pos.x + cx * side, p.pos.y + 0.05, p.pos.z + sz * side,
            -p.vel.x * 0.25 + (Math.random() - 0.5) * 1.5, 1.2 + Math.random() * 2.2 * p.surf, -p.vel.z * 0.25 + (Math.random() - 0.5) * 1.5,
            0.7 + Math.random() * 0.8, 0.85 * sc[0] * 0.3, 0.55 * sc[1] * 0.3, 0.32 * sc[2] * 0.3)
        }
      }
      this.spray.update(dt)
    }
    // the gate's sockets wake with each universe you open
    if (game) {
      for (const [id, m] of Object.entries(this.sockets)) {
        const want = game.used.has(id) ? 3.2 + Math.sin(t * 1.4 + id.length) * 0.4 : 0.12
        m.uniforms.uIntensity.value += (want - m.uniforms.uIntensity.value) * (1 - Math.exp(-dt * 1.5))
      }
    }
    // footprints fill in slowly
    for (const v of this.terrain.uniforms.uPrints.value) v.w = Math.max(0, v.w - dt * 0.012)
  }
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
