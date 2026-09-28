// Il Mare Immobile. Night over a sea so still it is a mirror. Only your steps
// disturb it. Lanterns rise for ever; black monoliths keep an avenue toward a
// low moon. What you are looking for exists only in the reflection.

import * as THREE from 'three'
import { World } from '../engine/world.js'
import { makeEnv } from '../engine/env.js'
import { makeSkyDome } from '../engine/skydome.js'
import { addDoor } from '../engine/door.js'
import { KeyItem } from '../engine/key.js'
import { makeStoneMaterial } from '../engine/materials.js'
import { noise, fog } from '../lib/glsl.js'
import { WORLDS, KEYS, LINES } from '../story.js'
import { registerAmbience } from '../engine/audio.js'
import { Bursts } from '../engine/bursts.js'

const MOON = new THREE.Vector3(-0.3, 0.2, 1).normalize()
const KEY_AT = new THREE.Vector3(118, 0, 186)
const RINGS = 24

export class Sea extends World {
  constructor(game) {
    super(game, { id: 'sea', ...WORLDS.sea })
    this.surface = 'water'
    this.grade = { exposure: 1.0, haze: 0, saturation: 1.0, contrast: 1.05, bloom: 1.1, grain: 0.018 }
    this.ringHead = 0
    this.revealed = false
  }

  async build() {
    this.env = makeEnv({
      sunDir: MOON.toArray(),
      sunColor: [0.3, 0.37, 0.52],
      ambTop: [0.012, 0.018, 0.04],
      ambHorizon: [0.02, 0.03, 0.06],
      ambGround: [0.01, 0.014, 0.028],
      fogColor: [0.022, 0.034, 0.075],
      fogDensity: 0.0016,
      fogBase: 0,
      fogFalloff: 0.035,
      fogSun: 0.6,
      water: 0.62,
    })
    this.mirror = new THREE.Group()
    this.mirror.scale.y = -1
    this.scene.add(this.mirror)

    this.buildSky()
    this.buildMonoliths()
    this.buildLanterns()
    this.buildDoor()
    this.buildKey()
    this.sparks = new Bursts(this, { count: 700, size: 0.035, drag: 1.2 })
    this.spawn = { x: 0, y: 0, z: 7, yaw: Math.PI }
  }

  buildSky() {
    const rings = Array.from({ length: RINGS }, () => new THREE.Vector4(1e5, 1e5, -100, 0))
    this.skyU = {
      ...this.env.uniforms,
      uTime: { value: 0 },
      uMoonDir: { value: MOON.clone() },
      uMoonR: { value: Math.sin((5.2 * Math.PI) / 180) },
      uRings: { value: rings },
    }
    const body = /* glsl */ `
      uniform float uTime;
      uniform vec3 uMoonDir;
      uniform float uMoonR;
      uniform vec4 uRings[${RINGS}];
      ${noise}
      ${fog}

      vec3 stars(vec3 d) {
        vec3 col = vec3(0.0);
        for (int l = 0; l < 3; l++) {
          float sc = l == 0 ? 150.0 : (l == 1 ? 320.0 : 640.0);
          vec3 p = d * sc;
          vec3 c = floor(p);
          vec3 f = fract(p) - 0.5;
          float h = hash13(c + float(l) * 17.0);
          float th = l == 0 ? 0.992 : (l == 1 ? 0.975 : 0.955);
          if (h > th) {
            vec3 o = hash33(c + 3.1) - 0.5;
            float dd = length(f - o * 0.55);
            float b = smoothstep(0.16, 0.0, dd) * pow((h - th) / (1.0 - th), 1.5);
            float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 6.0) + h * 91.0);
            vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.7), fract(h * 37.0));
            col += tint * b * tw * (l == 0 ? 9.0 : (l == 1 ? 2.6 : 1.0));
          }
        }
        return col;
      }

      vec3 milky(vec3 d) {
        vec3 bn = normalize(vec3(0.62, 0.55, -0.56));
        float band = dot(d, bn);
        float w = 0.16 + 0.05 * vnoise3(d * 3.0);
        float core = exp(-band * band / (w * w));
        float cloud = fbm3(d * 6.0 + 3.0);
        float lanes = smoothstep(0.48, 0.66, fbm3(d * 14.0 - 7.0)) * exp(-band * band / (w * w * 0.25));
        float grainy = pow(vnoise3(d * 140.0), 8.0) * 1.2;
        vec3 c = mix(vec3(0.05, 0.065, 0.11), vec3(0.11, 0.1, 0.1), core);
        return c * core * (0.2 + cloud * 0.7 + grainy) * (1.0 - lanes * 0.85) * 0.42;
      }

      // lit part of the moon only: the dark limb lets the sky glow through
      vec3 moon(vec3 d, out float cover) {
        cover = 0.0;
        float b = dot(d, uMoonDir);
        float r = uMoonR;
        float disc = b * b - (1.0 - r * r);
        vec3 col = vec3(0.0);
        if (disc > 0.0) {
          float t = b - sqrt(disc);
          vec3 n = normalize(d * t - uMoonDir);
          vec3 lightDir = normalize(-uMoonDir * 0.55 + vec3(0.95, 0.3, 0.0));
          float lit = smoothstep(-0.04, 0.2, dot(n, lightDir));
          float maria = smoothstep(0.42, 0.62, fbm3(n * 2.1 + 1.0));
          float craters = fbm3(n * 10.0);
          vec3 alb = mix(vec3(0.96, 0.94, 0.9), vec3(0.5, 0.52, 0.57), maria * 0.85);
          alb *= 0.78 + 0.4 * craters;
          float limb = sqrt(max(dot(n, -d), 0.0));
          col = alb * lit * (0.55 + 0.45 * limb) * 1.25 + alb * 0.012;
          cover = smoothstep(0.0, 0.004, disc);
        }
        return col;
      }

      vec3 night(vec3 d) {
        float y = max(d.y, 0.0);
        vec3 zen = vec3(0.003, 0.005, 0.016);
        vec3 hor = vec3(0.03, 0.046, 0.1);
        float m = max(dot(d, uMoonDir), 0.0);
        vec3 col = mix(hor, zen, pow(y, 0.4));
        col += vec3(0.05, 0.065, 0.1) * pow(m, 10.0) + vec3(0.16, 0.18, 0.22) * pow(m, 160.0);
        float cover;
        col += moon(d, cover);
        vec3 st = stars(d) * (1.0 - cover) * smoothstep(0.0, 0.1, y + 0.015);
        col += st + milky(d) * (1.0 - cover);
        col += hor * 0.8 * exp(-abs(d.y) * 60.0);
        return col;
      }

      vec3 skyColor(vec3 d) {
        if (d.y >= 0.0) return night(d);
        // the still sea, intersected analytically
        float t = cameraPosition.y / max(-d.y, 1e-5);
        vec3 p = cameraPosition + d * t;
        vec3 n = vec3(0.0, 1.0, 0.0);
        for (int i = 0; i < ${RINGS}; i++) {
          vec4 r = uRings[i];
          float age = uTime - r.z;
          if (age < 0.0 || age > 9.0) continue;
          vec2 q = p.xz - r.xy;
          float rr = length(q) + 1e-4;
          float front = age * 0.9;
          float x = rr - front;
          float env = exp(-x * x * 2.2) * exp(-age * 0.5) * r.w / (1.0 + rr * 0.6);
          if (env < 1e-4) continue;
          float dh = env * cos(x * 17.0) * 0.16;
          n.xz -= (q / rr) * dh;
        }
        n = normalize(n);
        vec3 rd = reflect(d, n);
        rd.y = abs(rd.y);
        float c = max(dot(n, -d), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - c, 5.0);
        vec3 col = night(rd) * mix(uWater.y, 1.0, F);
        col += vec3(0.001, 0.002, 0.004);
        // far water melts into the horizon haze
        col = mix(col, night(vec3(d.x, 0.0, d.z)), 1.0 - exp(-t * 0.0009));
        return col;
      }
    `
    this.sky = makeSkyDome({ uniforms: this.skyU, body })
    this.scene.add(this.sky)
  }

  buildMonoliths() {
    const mat = makeStoneMaterial(this.env, {
      color: [0.008, 0.009, 0.012],
      color2: [0.018, 0.018, 0.024],
      rough: 0.34,
      bump: 0.04,
      scale: 0.5,
      spec: 1.1,
    })
    this.obsidian = mat
    const geo = new THREE.BoxGeometry(1, 1, 1)
    geo.translate(0, 0.5, 0)
    const rnd = mulberry(11)
    const items = []
    // processional avenue toward the moon
    for (let i = 0; i < 14; i++) {
      const z = 34 + i * 26
      const h = 7 + i * 1.9 + rnd() * 3
      for (const s of [-1, 1]) {
        const x = s * (15 + i * 0.6) + (rnd() - 0.5) * 1.5
        items.push({ x, z: z + (rnd() - 0.5) * 4, w: 1.6 + rnd() * 0.8, d: 1.6 + rnd() * 0.8, h, yaw: (rnd() - 0.5) * 0.2, lean: (rnd() - 0.5) * 0.04 })
      }
    }
    // scattered, some very tall, some fallen short
    let tries = 0
    while (items.length < 96 && tries++ < 3000) {
      const a = rnd() * Math.PI * 2
      const r = 40 + Math.pow(rnd(), 0.8) * 520
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      if (Math.abs(x) < 24 && z > -10) continue // keep the avenue clear
      if (Math.hypot(x - KEY_AT.x, z - KEY_AT.z) < 22) continue
      if (Math.hypot(x, z) < 30) continue
      if (items.some((o) => Math.hypot(o.x - x, o.z - z) < 12)) continue
      const tall = rnd() < 0.15
      items.push({ x, z, w: 1.2 + rnd() * 2.8, d: 1.2 + rnd() * 2.2, h: tall ? 30 + rnd() * 26 : 4 + rnd() * 16, yaw: rnd() * Math.PI, lean: (rnd() - 0.5) * 0.12 })
    }
    const mesh = new THREE.InstancedMesh(geo, mat, items.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    items.forEach((o, i) => {
      e.set(o.lean, o.yaw, o.lean * 0.5)
      q.setFromEuler(e)
      m.compose(new THREE.Vector3(o.x, 0, o.z), q, new THREE.Vector3(o.w, o.h, o.d))
      mesh.setMatrixAt(i, m)
      this.colliders.push({ type: 'circle', x: o.x, z: o.z, r: Math.max(o.w, o.d) * 0.6 })
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    this.scene.add(mesh)
    this.mirror.add(mesh.clone())
  }

  buildLanterns() {
    const make = (count, ring) => {
      const quad = new THREE.PlaneGeometry(1, 1)
      const geo = new THREE.InstancedBufferGeometry()
      geo.index = quad.index
      geo.setAttribute('position', quad.getAttribute('position'))
      geo.setAttribute('uv', quad.getAttribute('uv'))
      const seed = new Float32Array(count * 4)
      for (let i = 0; i < count * 4; i++) seed[i] = Math.random()
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
      geo.instanceCount = count
      const u = {
        ...this.env.uniforms,
        uTime: { value: 0 },
        uMirrorY: { value: 1 },
        uCenter: { value: ring ? KEY_AT.clone() : new THREE.Vector3() },
        uRing: { value: ring ? 1 : 0 },
      }
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: u,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uMirrorY;
          uniform vec3 uCenter;
          uniform float uRing;
          in vec4 aSeed;
          out vec2 vUv;
          out float vA;
          out vec3 vWorld;
          out float vHot;
          void main() {
            vec3 wp;
            float a;
            if (uRing > 0.5) {
              float ang = aSeed.x * 6.28318 + uTime * 0.03;
              float r = 5.0 + aSeed.y * 9.0;
              wp = uCenter + vec3(cos(ang) * r, 2.2 + aSeed.z * 5.0 + sin(uTime * 0.6 + aSeed.w * 20.0) * 0.35, sin(ang) * r);
              a = 1.0;
            } else {
              float cyc = 150.0;
              float sp = mix(0.28, 0.8, aSeed.z);
              float y = mod(uTime * sp + aSeed.w * cyc, cyc);
              float ang = aSeed.x * 6.28318;
              float r = mix(28.0, 720.0, pow(aSeed.y, 0.75));
              wp = vec3(cos(ang) * r, y + 0.4, sin(ang) * r);
              wp.x += sin(uTime * 0.21 + aSeed.w * 40.0) * 1.2 + y * 0.05;
              wp.z += cos(uTime * 0.17 + aSeed.z * 30.0) * 1.2;
              a = smoothstep(0.0, 8.0, y) * (1.0 - smoothstep(80.0, 150.0, y));
            }
            wp.y *= uMirrorY;
            vec3 toCam = cameraPosition - wp;
            float dist = length(toCam);
            vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
            float s = max(1.0, dist * 0.0024 / 0.55);
            vec2 size = vec2(0.5, 0.68) * s;
            wp += right * position.x * size.x + vec3(0.0, 1.0, 0.0) * position.y * size.y * uMirrorY;
            vUv = uv;
            vA = a / (s * s * 0.6 + 0.4);
            vHot = aSeed.w;
            vWorld = wp;
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          in vec2 vUv;
          in float vA;
          in vec3 vWorld;
          in float vHot;
          out vec4 fragColor;
          ${fog}
          void main() {
            vec2 q = vUv * 2.0 - 1.0;
            // paper body: rounded, brighter near the flame at the bottom
            // a paper lantern: wider at the shoulder, tapering to the base
            float wq = abs(q.x) / (0.78 + 0.22 * smoothstep(-1.0, 0.4, q.y));
            float body = smoothstep(1.0, 0.7, length(vec2(wq, q.y * 0.94)));
            float flame = exp(-dot(q - vec2(0.0, -0.45), q - vec2(0.0, -0.45)) * 7.0);
            float edgeFade = 1.0 - smoothstep(0.6, 1.0, max(abs(q.x), abs(q.y)));
            float halo = exp(-dot(q, q) * 2.2) * 0.3 * edgeFade;
            // paper ribs and a darker cap, only readable up close
            float ribs = 1.0 - 0.25 * smoothstep(0.75, 1.0, abs(sin(q.x * 7.0)));
            float cap = 1.0 - 0.6 * smoothstep(0.62, 0.8, q.y);
            vec3 warm = mix(vec3(1.0, 0.42, 0.14), vec3(1.0, 0.66, 0.32), vHot);
            vec3 col = warm * (body * (0.8 + 1.6 * flame) * ribs * cap + halo) * vA * 3.4;
            vec3 rd;
            float f = fogFrom(vWorld, rd);
            col *= (1.0 - f) * mirrorDim(vWorld);
            fragColor = vec4(col, 1.0);
          }
        `,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.frustumCulled = false
      mesh.renderOrder = 20
      const mm = new THREE.Mesh(geo, mat.clone())
      for (const k of Object.keys(this.env.uniforms)) mm.material.uniforms[k] = this.env.uniforms[k]
      mm.material.uniforms.uTime = u.uTime
      mm.material.uniforms.uMirrorY.value = -1
      mm.frustumCulled = false
      mm.renderOrder = 19
      this.scene.add(mesh, mm)
      return u
    }
    this.lanternU = [make(2600, false), make(38, true)]
  }

  buildDoor() {
    const stone = makeStoneMaterial(this.env, {
      color: [0.012, 0.012, 0.016],
      color2: [0.026, 0.026, 0.032],
      rough: 0.36,
      bump: 0.03,
      scale: 0.45,
      spec: 0.9,
    })
    this.door = addDoor(this, {
      id: 'sea-return', x: 0, y: 0, z: 0, yaw: 0,
      color: WORLDS.sea.color,
      palette: [[0.6, 0.32, 0.14], [0.35, 0.5, 0.75]],
      glyph: KEYS.sea.glyph,
      locked: false, stone,
      size: { sill: 0.02 },
    })
    // its twin under the water, with a warm stand-in in the opening
    const twin = this.door.group.clone()
    twin.remove(twin.children.find((c) => c.material === this.door.surface.material))
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(this.door.w, this.door.h).translate(0, this.door.h / 2, 0), new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...this.env.uniforms },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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
        in vec2 vUv;
        in vec3 vWorld;
        out vec4 fragColor;
        ${fog}
        void main() {
          // a dim memory of the desert: sand at the waterline, sky further down
          vec3 c = mix(vec3(0.5, 0.26, 0.1), vec3(0.3, 0.42, 0.66), smoothstep(0.02, 0.35, vUv.y)) * 0.22;
          c *= 0.85 + 0.3 * fract(sin(dot(floor(vUv * vec2(6.0, 40.0)), vec2(12.9, 78.2))) * 43758.5);
          vec3 rd;
          float f = fogFrom(vWorld, rd);
          fragColor = vec4(c * (1.0 - f) * mirrorDim(vWorld), 1.0);
        }
      `,
    }))
    glow.position.z = -0.01
    twin.add(glow)
    this.mirror.add(twin)
  }

  buildKey() {
    this.key = new KeyItem(this, {
      id: 'crystal', ...KEYS.crystal,
      x: KEY_AT.x, y: 1.7, z: KEY_AT.z,
      hidden: true, beam: 220,
    })
    // the key's reflection is visible from the start; the key itself is not
    this.keyTwin = this.key.group.clone()
    this.keyTwin.visible = true
    this.mirror.add(this.keyTwin)
    this.keyTwinInner = this.keyTwin.children[0]
  }

  groundAt() { return 0 }

  constrain(pos, vel) {
    const d = Math.hypot(pos.x, pos.z)
    if (d > 640) {
      vel.x -= (pos.x / d) * 0.3
      vel.z -= (pos.z / d) * 0.3
    }
    if (d > 700) { pos.x *= 700 / d; pos.z *= 700 / d }
  }

  onStep(x, z, heading, speed) {
    // plankton wakes where the foot lands
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2
      const v = 0.3 + Math.random() * 1.1
      const c = 0.6 + Math.random() * 0.8
      this.sparks.emit(x + Math.cos(a) * 0.1, 0.015, z + Math.sin(a) * 0.1, Math.cos(a) * v, 0, Math.sin(a) * v, 1.2 + Math.random() * 1.6, 0.25 * c, 0.85 * c, 1.1 * c)
    }
    const r = this.skyU.uRings.value[this.ringHead]
    r.set(x, z, this.time, 0.6 + Math.min(1, speed / 9) * 0.6)
    this.ringHead = (this.ringHead + 1) % RINGS
  }

  update(dt, t, game) {
    super.update(dt, t)
    this.skyU.uTime.value = t
    for (const u of this.lanternU) u.uTime.value = t
    this.sparks.update(dt, 0.015)
    // mirror twin follows the key's own motion
    const k = this.key
    this.keyTwinInner.rotation.copy(k.key.rotation)
    this.keyTwinInner.position.copy(k.key.position)
    if (!this.rise) this.keyTwinInner.scale.setScalar(k.baseScale)
    if (!this.revealed && game && game.current === this) {
      const p = game.player.pos
      const d = Math.hypot(p.x - KEY_AT.x, p.z - KEY_AT.z)
      if (d < 7) this.reveal(game)
    }
    if (this.rise) {
      // the reflection becomes real: the key condenses above its own image
      this.rise.t += dt
      const e = Math.min(1, this.rise.t / 2.6)
      const s = 1 - Math.pow(1 - e, 3)
      k.key.scale.setScalar(Math.max(0.001, k.baseScale * s * (1 + Math.sin(e * Math.PI) * 0.15)))
      if (k.beam) k.beam.material.uniforms.uAmp.value = s
      if (k.wide) k.wide.material.uniforms.uAmp.value = s
      if (e >= 1) { this.rise = null; k.hidden = false }
    }
  }

  reveal(game) {
    this.revealed = true
    const k = this.key
    k.group.visible = true
    k.key.scale.setScalar(0.001)
    if (k.beam) k.beam.material.uniforms.uAmp.value = 0
    if (k.wide) k.wide.material.uniforms.uAmp.value = 0
    this.rise = { t: 0 }
    for (let i = 0; i < 6; i++) {
      const r = this.skyU.uRings.value[this.ringHead]
      r.set(KEY_AT.x, KEY_AT.z, this.time + i * 0.35, 2.2)
      this.ringHead = (this.ringHead + 1) % RINGS
    }
    game.hud.say(LINES.sea.rise, 4)
    game.audio.chime()
  }

  onEnter(game) {
    if (!this.hinted) {
      this.hinted = true
      setTimeout(() => game.current === this && game.hud.say(LINES.sea.hint, 6), 5500)
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

// a slow dream of low sines and far bells
registerAmbience('sea', (A, out) => {
  const ctx = A.ctx
  const pad = ctx.createGain()
  pad.gain.value = 0.05
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'; lp.frequency.value = 900
  pad.connect(lp).connect(out)
  lp.connect(A.reverb)
  const notes = [73.42, 110, 146.83, 164.81, 220, 277.18]
  const oscs = notes.map((f, i) => {
    const o = ctx.createOscillator()
    o.type = i < 2 ? 'sine' : 'triangle'
    o.frequency.value = f
    const g = ctx.createGain()
    g.gain.value = 0
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.02 + i * 0.013
    const lg = ctx.createGain()
    lg.gain.value = 0.18 / (1 + i * 0.5)
    lfo.connect(lg).connect(g.gain)
    o.connect(g).connect(pad)
    o.start(); lfo.start()
    return o
  })
  const wash = A.src(A.brown)
  const wf = ctx.createBiquadFilter()
  wf.type = 'lowpass'; wf.frequency.value = 300
  const wg = ctx.createGain(); wg.gain.value = 0.06
  wash.connect(wf).connect(wg).connect(out)
  wash.start()
  let next = 3
  const scale = [587.33, 659.25, 739.99, 880, 987.77, 1174.66]
  return {
    update(dt) {
      next -= dt
      if (next <= 0) {
        next = 4 + Math.random() * 7
        const t = ctx.currentTime
        const f = scale[Math.floor(Math.random() * scale.length)]
        A.bell(f, t, 0.035, 6, out)
      }
    },
    nodes: oscs,
  }
})
