// A key: a sigil-bowed key of light floating in a column of light.

import * as THREE from 'three'
import { glyphGeometry } from './glyphs.js'
import { fog } from '../lib/glsl.js'

const keyVertex = /* glsl */ `
  out vec3 vN;
  out vec3 vWorld;
  out vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

export function makeKeyMaterial(env, color) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...env.uniforms, uColor: { value: new THREE.Color(...color) }, uTime: { value: 0 }, uBright: { value: 1 } },
    defines: { ...env.defines },
    vertexShader: keyVertex,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uBright;
      in vec3 vN;
      in vec3 vWorld;
      in vec3 vLocal;
      out vec4 fragColor;
      ${fog}
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float f = pow(1.0 - abs(dot(N, V)), 2.0);
        float band = 0.5 + 0.5 * sin(vLocal.y * 14.0 - uTime * 3.0);
        vec3 col = uColor * uColor * (0.55 + 1.9 * f + band * 0.45) + vec3(1.0, 0.95, 0.9) * f * f * 0.7;
        col *= uBright;
        col = applyFog(col, vWorld);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
}

export function beamMaterial(env, color, height) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...env.uniforms, uColor: { value: new THREE.Color(...color) }, uTime: { value: 0 }, uH: { value: height }, uAmp: { value: 1 } },
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      out vec3 vWorld;
      out vec3 vLocal;
      out vec3 vN;
      void main() {
        vLocal = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uH;
      uniform float uAmp;
      in vec3 vWorld;
      in vec3 vLocal;
      in vec3 vN;
      out vec4 fragColor;
      ${fog}
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float edge = pow(abs(dot(normalize(vN), V)), 1.6);
        float y = vLocal.y / uH;
        float fade = (1.0 - smoothstep(0.02, 1.0, y)) * smoothstep(0.0, 0.01, y);
        float flow = 0.75 + 0.25 * sin(vLocal.y * 0.35 - uTime * 2.2);
        vec3 rd;
        float fa = fogFrom(vWorld, rd);
        // stand inside the light and it thins out instead of blinding you
        float nearCam = smoothstep(3.0, 40.0, length(cameraPosition.xz - vWorld.xz));
        vec3 col = uColor * edge * fade * flow * uAmp * 0.55 * (1.0 - fa * 0.85) * mirrorDim(vWorld) * mix(0.12, 1.0, nearCam);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
}

export class KeyItem {
  constructor(world, o) {
    this.world = world
    this.id = o.id
    this.name = o.name
    this.glyph = o.glyph
    this.color = o.color
    this.taken = false
    this.hidden = !!o.hidden // revealed by a puzzle
    this.base = new THREE.Vector3(o.x, o.y, o.z)
    this.float = o.float ?? 1.6
    this.radius = o.radius ?? 2.4
    this.group = new THREE.Group()
    this.group.position.copy(this.base)
    const env = world.env

    const km = makeKeyMaterial(env, o.color)
    this.material = km
    const key = new THREE.Group()
    const bow = new THREE.Mesh(glyphGeometry(o.glyph, { size: 0.22, depth: 0.05, bevel: 0.012 }), km)
    bow.geometry.center()
    bow.position.y = 0.42
    key.add(bow)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.022, 10, 64), km)
    ring.position.y = 0.42
    key.add(ring)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.92, 12), km)
    shaft.position.y = -0.3
    key.add(shaft)
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.16 - i * 0.03, 0.05, 0.04), km)
      t.position.set(0.09 - i * 0.012, -0.66 + i * 0.1, 0)
      key.add(t)
    }
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 24), km)
    collar.rotation.x = Math.PI / 2
    collar.position.y = 0.1
    key.add(collar)
    this.baseScale = o.scale ?? 1.5
    key.scale.setScalar(this.baseScale)
    this.key = key
    this.group.add(key)

    // column of light
    const bh = o.beam ?? 260
    if (bh > 0) {
      const bm = beamMaterial(env, o.color, bh)
      const beamGeo = new THREE.CylinderGeometry(0.55, 0.55, bh, 24, 1, true)
      beamGeo.translate(0, bh / 2, 0)
      this.beam = new THREE.Mesh(beamGeo, bm)
      this.beam.position.y = -this.float
      this.beam.frustumCulled = false
      this.group.add(this.beam)
      const wide = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, bh * 0.4, 32, 1, true).translate(0, bh * 0.2, 0), beamMaterial(env, o.color.map((c) => c * 0.25), bh * 0.4))
      wide.position.y = -this.float
      this.wide = wide
      this.group.add(wide)
    }

    // motes
    const n = 90
    const pos = new Float32Array(n * 3)
    const seed = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      seed[i] = Math.random()
      pos[i * 3] = 0
    }
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    pg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    this.motes = new THREE.Points(pg, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uColor: { value: new THREE.Color(...o.color) }, uTime: { value: 0 }, uPx: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        in float aSeed;
        uniform float uTime;
        uniform float uPx;
        out float vA;
        void main() {
          float t = uTime * (0.25 + aSeed * 0.3) + aSeed * 40.0;
          float r = 0.5 + fract(aSeed * 7.31) * 1.6;
          float y = fract(t * 0.12 + aSeed) * 4.0 - 1.8;
          vec3 p = vec3(cos(t) * r, y, sin(t) * r);
          vA = sin(fract(t * 0.12 + aSeed) * 3.14159);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(9.0, uPx * (1.5 + 2.0 * fract(aSeed * 13.7)) * 7.0 / max(-mv.z, 0.5));
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        in float vA;
        out vec4 fragColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          fragColor = vec4(uColor * a * 2.2, 1.0);
        }
      `,
    }))
    this.motes.frustumCulled = false
    this.group.add(this.motes)

    this.group.visible = !this.hidden
    world.scene.add(this.group)
    world.items.push(this)
  }

  update(dt, t) {
    if (this.taken) return
    this.key.rotation.y = t * 0.9
    this.key.position.y = Math.sin(t * 1.3) * 0.12
    this.material.uniforms.uTime.value = t
    this.motes.material.uniforms.uTime.value = t
    if (this.beam) this.beam.material.uniforms.uTime.value = t
    if (this.wide) this.wide.material.uniforms.uTime.value = t
  }

  reveal() {
    this.hidden = false
    this.group.visible = true
  }
}
