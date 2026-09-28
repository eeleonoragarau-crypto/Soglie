// L'Origine. Beyond the Great Gate: a pearl-white calm over a mirror of light.
// Black monoliths stand in a circle, every one of them open at once on its
// universe. The Seed you carried is planted, and a tree of light grows.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { World } from '../engine/world.js'
import { makeEnv } from '../engine/env.js'
import { makeSkyDome } from '../engine/skydome.js'
import { addDoor } from '../engine/door.js'
import { makeStoneMaterial } from '../engine/materials.js'
import { noise, fog } from '../lib/glsl.js'
import { WORLDS, KEYS, LINES } from '../story.js'
import { registerAmbience } from '../engine/audio.js'

export const GATE_SIZE = { w: 13, h: 92, side: 11, top: 20, depth: 7, sill: 0.02 }
const RINGS = 16
const SUN = new THREE.Vector3(-0.25, 0.62, -0.74).normalize()

export class Origin extends World {
  constructor(game) {
    super(game, { id: 'origin', ...WORLDS.origin })
    this.surface = 'water'
    this.slopePhysics = false
    this.grade = { exposure: 1.0, bloom: 0.55, bloomThreshold: 1.9, saturation: 1.05, contrast: 1.12, grain: 0.02 }
    this.views = {}
    this.ringHead = 0
    this.seq = null
    this.maxPortals = 4
  }

  async build() {
    this.env = makeEnv({
      sunDir: SUN.toArray(),
      sunColor: [1.7, 1.5, 1.22],
      ambTop: [1.1, 1.14, 1.25],
      ambHorizon: [1.5, 1.4, 1.26],
      ambGround: [0.5, 0.47, 0.44],
      fogColor: [1.5, 1.39, 1.23],
      fogDensity: 0.0011,
      fogFalloff: 0.02,
      fogSun: 0.25,
      water: 0.66,
    })
    this.mirror = new THREE.Group()
    this.mirror.scale.y = -1
    this.scene.add(this.mirror)
    this.buildSky()
    this.buildDoors()
    this.buildTree()
    this.buildMotes()
    this.spawn = { x: 0, y: 0, z: 42, yaw: 0 }
  }

  buildSky() {
    this.skyU = {
      ...this.env.uniforms,
      uTime: { value: 0 },
      uRings: { value: Array.from({ length: RINGS }, () => new THREE.Vector4(1e5, 1e5, -100, 0)) },
      uBloom: { value: 0 },
    }
    const body = /* glsl */ `
      uniform float uTime;
      uniform vec4 uRings[${RINGS}];
      uniform float uBloom;
      ${noise}
      ${fog}
      vec3 pearl(vec3 d) {
        float y = max(d.y, 0.0);
        vec3 hor = vec3(1.62, 1.5, 1.32);
        vec3 zen = vec3(0.86, 0.96, 1.2);
        vec3 col = mix(hor, zen, pow(y, 0.55));
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.9, 0.72) * (pow(s, 8.0) * 0.35 + pow(s, 90.0) * 1.2) + vec3(1.2, 1.1, 0.95) * smoothstep(0.9993, 0.9997, s) * 8.0;
        // high veils of light
        vec2 p = d.xz / (d.y + 0.25);
        float v = fbm2(p * 1.4 + vec2(uTime * 0.01, 0.0));
        col = mix(col, col * 1.12 + vec3(0.05, 0.04, 0.02), smoothstep(0.5, 0.85, v) * smoothstep(0.0, 0.3, y) * 0.6);
        col *= 1.0 + uBloom * 0.25;
        return col;
      }
      vec3 skyColor(vec3 d) {
        if (d.y >= 0.0) return pearl(d);
        float t = cameraPosition.y / max(-d.y, 1e-5);
        vec3 p = cameraPosition + d * t;
        vec3 n = vec3(0.0, 1.0, 0.0);
        for (int i = 0; i < ${RINGS}; i++) {
          vec4 r = uRings[i];
          float age = uTime - r.z;
          if (age < 0.0 || age > 10.0) continue;
          vec2 q = p.xz - r.xy;
          float rr = length(q) + 1e-4;
          float x = rr - age * 1.1;
          float env = exp(-x * x * 1.6) * exp(-age * 0.4) * r.w / (1.0 + rr * 0.3);
          if (env < 1e-4) continue;
          n.xz -= (q / rr) * env * cos(x * 12.0) * 0.12;
        }
        n = normalize(n);
        vec3 rd = reflect(d, n);
        rd.y = abs(rd.y);
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, -d), 0.0), 5.0);
        vec3 col = pearl(rd) * mix(uWater.y, 1.0, F) + vec3(0.2, 0.19, 0.18) * (1.0 - uWater.y) * (1.0 - F);
        return mix(col, pearl(vec3(d.x, 0.0, d.z)), 1.0 - exp(-t * 0.004));
      }
    `
    this.sky = makeSkyDome({ uniforms: this.skyU, body })
    this.scene.add(this.sky)
  }

  twin(portal, palette) {
    const t = portal.group.clone()
    t.remove(t.children.find((c) => c.material === portal.surface.material))
    const [a, b] = palette.map((c) => new THREE.Vector3(...c))
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(portal.w, portal.h).translate(0, portal.h / 2, 0), new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...this.env.uniforms, uA: { value: a }, uB: { value: b } },
      vertexShader: /* glsl */ `
        out vec2 vUv;
        out vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uA;
        uniform vec3 uB;
        in vec2 vUv;
        in vec3 vWorld;
        out vec4 fragColor;
        ${fog}
        void main() {
          vec3 c = mix(uA, uB, vUv.y) * 0.7 + 0.05;
          fragColor = vec4(applyFog(c, vWorld), 1.0);
        }
      `,
    }))
    glow.position.z = -0.01
    t.add(glow)
    this.mirror.add(t)
  }

  buildDoors() {
    const stone = makeStoneMaterial(this.env, {
      color: [0.014, 0.013, 0.013],
      color2: [0.03, 0.028, 0.027],
      rough: 0.32,
      bump: 0.05,
      scale: 0.5,
      spec: 1.0,
    })
    this.door = addDoor(this, {
      id: 'origin-return', x: 0, y: 0, z: 50, yaw: Math.PI,
      color: WORLDS.origin.color, palette: [[0.6, 0.32, 0.14], [0.35, 0.5, 0.75]],
      glyph: 'gate', locked: false, stone, size: GATE_SIZE, liveRange: 900,
    })
    this.twin(this.door, [[0.6, 0.32, 0.14], [0.35, 0.5, 0.75]])
    const ids = ['sea', 'crystal', 'void', 'garden']
    const angles = [112, 150, 210, 248].map((a) => (a * Math.PI) / 180)
    ids.forEach((id, i) => {
      const a = angles[i]
      const R = 22
      const p = addDoor(this, {
        id: 'origin-' + id, x: Math.sin(a) * R, y: 0, z: Math.cos(a) * R, yaw: a + Math.PI,
        color: WORLDS[id].color, palette: WORLDS[id].palette, glyph: KEYS[id].glyph,
        locked: false, stone, size: { sill: 0.02 }, liveRange: 220,
      })
      this.views[id] = p
      this.twin(p, WORLDS[id].palette)
    })
  }

  // a tree of light: tapered tubes whose vertices carry the order they grow in
  buildTree() {
    const rnd = mulberry(23)
    const segs = []
    const up = new THREE.Vector3(0, 1, 0)
    let maxG = 0
    const branch = (p, dir, len, r, depth, g) => {
      const steps = 5
      let a = p.clone()
      let d = dir.clone()
      const rEnd = r * 0.66
      for (let i = 0; i < steps; i++) {
        const b = a.clone().addScaledVector(d, len / steps)
        const r0 = r + (rEnd - r) * (i / steps)
        const r1 = r + (rEnd - r) * ((i + 1) / steps)
        const g0 = g + (len * i) / steps
        const g1 = g + (len * (i + 1)) / steps
        segs.push({ a, b, r0, r1, g0, g1, depth })
        maxG = Math.max(maxG, g1)
        d = d.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.22, 0.05, (rnd() - 0.5) * 0.22)).normalize()
        a = b
      }
      if (depth >= 6) {
        this.tips.push({ p: a, g: g + len })
        return
      }
      const kids = depth < 2 ? 3 : 2 + (rnd() < 0.4 ? 1 : 0)
      for (let k = 0; k < kids; k++) {
        const ang = (k / kids) * Math.PI * 2 + rnd() * 1.2
        const tilt = 0.45 + rnd() * 0.45
        const side = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang))
        const nd = d.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt)).add(up.clone().multiplyScalar(0.25)).normalize()
        branch(a, nd, len * (0.7 + rnd() * 0.12), rEnd, depth + 1, g + len)
      }
    }
    this.tips = []
    branch(new THREE.Vector3(0, -0.5, 0), up, 9.5, 0.95, 0, 0)

    const geos = []
    const tmpUp = new THREE.Vector3(0, 1, 0)
    for (const s of segs) {
      const L = s.a.distanceTo(s.b)
      const g = new THREE.CylinderGeometry(s.r1, s.r0, L, s.depth < 3 ? 9 : 6, 1, true)
      const grow = new Float32Array(g.attributes.position.count)
      for (let i = 0; i < grow.length; i++) {
        const y = g.attributes.position.getY(i) / L + 0.5
        grow[i] = (s.g0 + (s.g1 - s.g0) * y) / maxG
      }
      g.setAttribute('aGrow', new THREE.BufferAttribute(grow, 1))
      const q = new THREE.Quaternion().setFromUnitVectors(tmpUp, s.b.clone().sub(s.a).normalize())
      g.applyQuaternion(q)
      const mid = s.a.clone().add(s.b).multiplyScalar(0.5)
      g.translate(mid.x, mid.y, mid.z)
      geos.push(g)
    }
    const geo = mergeGeometries(geos)
    this.treeU = { ...this.env.uniforms, uGrow: { value: 0 }, uTime: { value: 0 } }
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.treeU,
      defines: { ...this.env.defines },
      vertexShader: /* glsl */ `
        in float aGrow;
        out float vGrow;
        out vec3 vWorld;
        out vec3 vN;
        void main() {
          vGrow = aGrow;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uGrow;
        uniform float uTime;
        in float vGrow;
        in vec3 vWorld;
        in vec3 vN;
        out vec4 fragColor;
        ${fog}
        void main() {
          if (vGrow > uGrow) discard;
          vec3 V = normalize(cameraPosition - vWorld);
          float f = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
          float flow = 0.5 + 0.5 * sin(vGrow * 60.0 - uTime * 2.5);
          vec3 col = vec3(1.0, 0.5, 0.14) * (0.75 + 1.4 * f + 0.45 * flow);
          col += vec3(1.0, 0.8, 0.5) * exp(-(uGrow - vGrow) * 40.0) * 6.0;
          fragColor = vec4(applyFog(col, vWorld), 1.0);
        }
      `,
    })
    this.tree = new THREE.Mesh(geo, mat)
    this.tree.frustumCulled = false
    this.scene.add(this.tree)
    this.mirror.add(this.tree.clone())

    // blossoms at every tip
    const n = this.tips.length * 6
    const pos = new Float32Array(n * 3)
    const gr = new Float32Array(n)
    const sd = new Float32Array(n)
    let k = 0
    for (const t of this.tips) {
      for (let j = 0; j < 6; j++) {
        pos[k * 3] = t.p.x + (rnd() - 0.5) * 1.6
        pos[k * 3 + 1] = t.p.y + (rnd() - 0.5) * 1.2
        pos[k * 3 + 2] = t.p.z + (rnd() - 0.5) * 1.6
        gr[k] = Math.min(1, t.g / maxG + 0.02 + rnd() * 0.04)
        sd[k] = rnd()
        k++
      }
    }
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    pg.setAttribute('aGrow', new THREE.BufferAttribute(gr, 1))
    pg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
    const pm = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.treeU,
      defines: { ...this.env.defines },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uGrow;
        uniform float uTime;
        in float aGrow;
        in float aSeed;
        out float vA;
        out vec3 vWorld;
        void main() {
          vec3 p = position + vec3(sin(uTime * 0.7 + aSeed * 30.0), sin(uTime * 0.5 + aSeed * 11.0), cos(uTime * 0.6 + aSeed * 17.0)) * 0.15;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vWorld = w.xyz;
          vA = smoothstep(aGrow, aGrow + 0.05, uGrow);
          vec4 mv = viewMatrix * w;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (3.0 + aSeed * 5.0) * 26.0 / max(-mv.z, 1.0) * vA;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        in float vA;
        in vec3 vWorld;
        out vec4 fragColor;
        ${fog}
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          vec3 rd;
          float f = fogFrom(vWorld, rd);
          fragColor = vec4(vec3(1.0, 0.62, 0.26) * a * 3.2 * (1.0 - f) * mirrorDim(vWorld), 1.0);
        }
      `,
    })
    this.blossoms = new THREE.Points(pg, pm)
    this.blossoms.frustumCulled = false
    this.scene.add(this.blossoms)
    this.mirror.add(this.blossoms.clone())

    // the seed, flown from your hand to the centre
    this.seed = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 2) }))
    this.seed.visible = false
    this.scene.add(this.seed)
    this.colliders.push({ type: 'circle', x: 0, z: 0, r: 1.6 })
  }

  buildMotes() {
    const n = 1400
    const pos = new Float32Array(n * 3)
    const sd = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * 120
      pos[i * 3] = Math.cos(a) * r
      pos[i * 3 + 1] = Math.random() * 40
      pos[i * 3 + 2] = Math.sin(a) * r
      sd[i] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
    const m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...this.env.uniforms, uTime: this.treeU.uTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        in float aSeed;
        out float vA;
        out vec3 vWorld;
        void main() {
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.2 + aSeed * 0.3), 40.0);
          p.x += sin(uTime * 0.3 + aSeed * 50.0) * 2.0;
          vWorld = p;
          vA = smoothstep(0.0, 4.0, p.y) * (1.0 - smoothstep(30.0, 40.0, p.y));
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.5 + aSeed * 3.0) * 30.0 / max(-mv.z, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        in float vA;
        in vec3 vWorld;
        out vec4 fragColor;
        ${fog}
        void main() {
          float d = length(gl_PointCoord - 0.5);
          vec3 rd;
          float f = fogFrom(vWorld, rd);
          fragColor = vec4(vec3(1.0, 0.85, 0.6) * smoothstep(0.5, 0.0, d) * vA * 0.9 * (1.0 - f), 1.0);
        }
      `,
    })
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    this.scene.add(pts)
  }

  groundAt() { return 0 }

  constrain(pos, vel) {
    const d = Math.hypot(pos.x, pos.z)
    if (d > 200) { vel.x -= (pos.x / d) * 0.3; vel.z -= (pos.z / d) * 0.3 }
    if (d > 240) { pos.x *= 240 / d; pos.z *= 240 / d }
  }

  onStep(x, z, heading, speed) {
    this.ring(x, z, 0.5 + Math.min(1, speed / 9) * 0.5)
  }

  ring(x, z, amp, delay = 0) {
    this.skyU.uRings.value[this.ringHead].set(x, z, this.time + delay, amp)
    this.ringHead = (this.ringHead + 1) % RINGS
  }

  onEnter(game) {
    if (this.seq) return
    this.seq = { t: 0, stage: 0 }
  }

  update(dt, t, game) {
    super.update(dt, t)
    this.skyU.uTime.value = t
    this.treeU.uTime.value = t
    const s = this.seq
    if (!s || !game || game.current !== this) return
    s.t += dt
    if (s.stage === 0 && s.t > 2.2) {
      s.stage = 1
      s.from = game.camera.position.clone().add(new THREE.Vector3(0, -0.5, -0.8).applyQuaternion(game.camera.quaternion))
      this.seed.position.copy(s.from)
      this.seed.visible = true
      s.f = 0
    }
    if (s.stage === 1) {
      s.f += dt / 4.5
      const k = Math.min(1, s.f)
      const e = k * k * (3 - 2 * k)
      const to = new THREE.Vector3(0, 0.2, 0)
      this.seed.position.lerpVectors(s.from, to, e)
      this.seed.position.y += Math.sin(e * Math.PI) * 6
      if (k >= 1) {
        s.stage = 2
        s.g = 0
        this.seed.visible = false
        for (let i = 0; i < 5; i++) this.ring(0, 0, 2.4, i * 0.4)
        game.audio.growth?.()
      }
    }
    if (s.stage === 2) {
      s.g += dt / 18
      const g = Math.min(1, s.g)
      this.treeU.uGrow.value = 1 - Math.pow(1 - g, 1.6)
      this.skyU.uBloom.value = g
      if (g >= 1) { s.stage = 3; s.e = 0 }
    }
    if (s.stage === 3) {
      s.e += dt
      if (!s.said) {
        s.said = true
        LINES.origin.end.forEach((l, i) => setTimeout(() => game.hud.say(l, 5.5), 600 + i * 6000))
        setTimeout(() => game.hud.credits?.(), 13500)
      }
    }
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

// warm, open, resolved: the only major chord in the game
registerAmbience('origin', (A, out) => {
  const ctx = A.ctx
  const pad = ctx.createGain()
  pad.gain.value = 0.045
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'; lp.frequency.value = 1400
  pad.connect(lp).connect(out)
  lp.connect(A.reverb)
  ;[146.83, 220, 293.66, 369.99, 440, 659.25].forEach((f, i) => {
    for (const det of [1, 1.003]) {
      const o = ctx.createOscillator()
      o.type = i < 3 ? 'triangle' : 'sine'
      o.frequency.value = f * det
      const g = ctx.createGain()
      g.gain.value = 0.14 / (1 + i * 0.4)
      o.connect(g).connect(pad)
      o.start()
    }
  })
  let next = 2
  const notes = [587.33, 739.99, 880, 1108.73, 1174.66, 1479.98]
  return {
    update(dt) {
      next -= dt
      if (next <= 0) {
        next = 2.5 + Math.random() * 4
        A.bell(notes[Math.floor(Math.random() * notes.length)], ctx.currentTime, 0.03, 5, out)
      }
    },
  }
})
