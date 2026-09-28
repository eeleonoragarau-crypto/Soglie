// Small CPU particle pool for footstep effects: sparks on water, sand spray.
// One draw call, a fixed ring buffer, no allocations per frame.

import * as THREE from 'three'
import { fog } from '../lib/glsl.js'

export class Bursts {
  constructor(world, { count = 600, size = 0.06, additive = true, drag = 1.5, gravity = 0 } = {}) {
    this.n = count
    this.drag = drag
    this.gravity = gravity
    this.pos = new Float32Array(count * 3)
    this.vel = new Float32Array(count * 3)
    this.life = new Float32Array(count)
    this.max = new Float32Array(count).fill(1)
    this.col = new Float32Array(count * 3)
    this.alpha = new Float32Array(count)
    this.head = 0
    const g = new THREE.BufferGeometry()
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage)
    this.aA = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('position', this.aPos)
    g.setAttribute('aCol', this.aCol)
    g.setAttribute('aA', this.aA)
    const env = world.env
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...env.uniforms, uSize: { value: size } },
      defines: { ...env.defines },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        uniform float uSize;
        in vec3 aCol;
        in float aA;
        out vec3 vCol;
        out float vA;
        out vec3 vWorld;
        void main() {
          vCol = aCol;
          vA = aA;
          vWorld = position;
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aA > 0.0 ? clamp(uSize * 900.0 / max(-mv.z, 0.2), 1.5, 22.0) : 0.0;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec3 vCol;
        in float vA;
        in vec3 vWorld;
        out vec4 fragColor;
        ${fog}
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          vec3 rd;
          float f = fogFrom(vWorld, rd);
          fragColor = vec4(vCol * a * (1.0 - f), a);
        }
      `,
    }))
    this.points.frustumCulled = false
    this.points.renderOrder = 15
    world.scene.add(this.points)
  }

  emit(x, y, z, vx, vy, vz, life, r, g, b) {
    const i = this.head
    this.head = (this.head + 1) % this.n
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz
    this.life[i] = life
    this.max[i] = life
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b
  }

  update(dt, floor = null) {
    const k = Math.exp(-dt * this.drag)
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue }
      this.life[i] -= dt
      const j = i * 3
      this.vel[j + 1] -= this.gravity * dt
      this.vel[j] *= k; this.vel[j + 1] *= k; this.vel[j + 2] *= k
      this.pos[j] += this.vel[j] * dt
      this.pos[j + 1] += this.vel[j + 1] * dt
      this.pos[j + 2] += this.vel[j + 2] * dt
      if (floor !== null && this.pos[j + 1] < floor) { this.pos[j + 1] = floor; this.vel[j + 1] = 0 }
      const t = Math.max(0, this.life[i] / this.max[i])
      this.alpha[i] = Math.min(1, (1 - t) * 8) * t
    }
    this.aPos.needsUpdate = true
    this.aA.needsUpdate = true
    this.aCol.needsUpdate = true
  }
}
