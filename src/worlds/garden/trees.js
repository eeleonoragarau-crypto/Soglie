// Round, generous trees: a tapered trunk with a couple of limbs and a canopy
// of lumpy leaf clumps that scatter the light. Two draw calls for all of them,
// on the meadow and on the islands (clumps ride their island's bob).

import * as THREE from 'three'
import { gardenGLSL } from './common.js'
import { bobGLSL, mulberry, rimRadius, topHeight, STATIC } from './islands.js'
import { noise, fog } from '../../lib/glsl.js'

// ground trees: x, z, height; groves are listed tree by tree
export const GROUND_TREES = [
  { x: -34, z: 58, h: 14 },
  { x: 118, z: 196, h: 12 }, { x: 131, z: 206, h: 10 }, { x: 124, z: 222, h: 13 }, { x: 140, z: 190, h: 8 },
  { x: -196, z: 250, h: 13 }, { x: -210, z: 262, h: 10 }, { x: -186, z: 270, h: 11 },
  { x: -24, z: 300, h: 11 },
  { x: 70, z: 420, h: 14 }, { x: 86, z: 432, h: 11 }, { x: 58, z: 441, h: 12 },
  { x: 250, z: 140, h: 13 }, { x: 262, z: 128, h: 10 },
  { x: -130, z: 96, h: 12 },
  { x: -320, z: 380, h: 14 }, { x: 330, z: 420, h: 15 }, { x: 200, z: 520, h: 12 },
  { x: 40, z: -70, h: 13 }, { x: -60, z: -40, h: 11 },
]

export function treeList(islands, groundAt) {
  const trees = []
  const rnd = mulberry(77)
  for (const t of GROUND_TREES) {
    trees.push({ x: t.x, y: groundAt(t.x, t.z) - 0.3, z: t.z, h: t.h, isl: STATIC, seed: rnd() * 100 })
  }
  islands.forEach((I, i) => {
    const r2 = mulberry(I.seed * 31 + 1)
    for (let k = 0; k < I.trees; k++) {
      const th = r2() * Math.PI * 2
      const kk = 0.35 + r2() * 0.5
      const R = rimRadius(I, th) * kk
      const h = Math.min(16, 5 + I.r * 0.14 + r2() * 4)
      trees.push({ x: I.x + Math.cos(th) * R, y: I.y + topHeight(I, kk, th) - 0.3, z: I.z + Math.sin(th) * R, h, isl: i, seed: r2() * 100 })
    }
  })
  return trees
}

function trunkGeometry(trees) {
  const pos = [], nor = [], isl = [], idx = []
  const cyl = (x0, y0, z0, x1, y1, z1, r0, r1, is, seg = 7) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1)
    const ax = b.clone().sub(a).normalize()
    const u = new THREE.Vector3(1, 0, 0).cross(ax)
    if (u.lengthSq() < 1e-4) u.set(0, 0, 1).cross(ax)
    u.normalize()
    const v = ax.clone().cross(u)
    const base = pos.length / 3
    for (let j = 0; j <= 1; j++) {
      const p = j ? b : a
      const r = j ? r1 : r0
      for (let i = 0; i < seg; i++) {
        const t = (i / seg) * Math.PI * 2
        const n = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t))
        pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r)
        nor.push(n.x, n.y, n.z)
        isl.push(is)
      }
    }
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg
      idx.push(base + i, base + seg + i, base + i1, base + i1, base + seg + i, base + seg + i1)
    }
  }
  for (const t of trees) {
    const r = mulberry(Math.floor(t.seed * 1000))
    const w = 0.22 + t.h * 0.035
    const lean = (r() - 0.5) * 0.08 * t.h
    const topY = t.y + t.h * 0.7
    cyl(t.x, t.y - 0.5, t.z, t.x + lean, topY, t.z + lean * 0.5, w, w * 0.55, t.isl)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + r() * 1.2
      const y0 = t.y + t.h * (0.3 + r() * 0.18)
      const L = t.h * (0.3 + r() * 0.12)
      cyl(t.x + lean * 0.5, y0, t.z + lean * 0.25, t.x + Math.cos(a) * L, y0 + L * 0.8, t.z + Math.sin(a) * L, w * 0.45, w * 0.18, t.isl, 5)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('aIsl', new THREE.Float32BufferAttribute(isl, 1))
  g.setIndex(idx)
  return g
}

export function makeTrees(env, gu, bobU, trees) {
  const uniforms = { ...env.uniforms, ...gu, uBob: bobU }
  // trunks
  const trunkMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    vertexShader: /* glsl */ `
      in float aIsl;
      out vec3 vWorld;
      out vec3 vN;
      ${bobGLSL}
      void main() {
        vec3 p = position + bobOf(aIsl);
        vWorld = p;
        vN = normal;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      in vec3 vWorld;
      in vec3 vN;
      out vec4 fragColor;
      ${noise}
      ${fog}
      void main() {
        vec3 N = normalize(vN);
        float bark = vnoise(vec2(atan(N.z, N.x) * 3.0, vWorld.y * 1.5));
        vec3 alb = mix(vec3(0.07, 0.05, 0.035), vec3(0.16, 0.13, 0.1), bark);
        float ndl = max(dot(N, uSunDir), 0.0);
        vec3 col = alb * (uSunColor * ndl * 0.6 + mix(uAmbHorizon, uAmbTop, N.y * 0.5 + 0.5) * 0.7);
        col = applyFog(col, vWorld);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const trunks = new THREE.Mesh(trunkGeometry(trees), trunkMat)
  trunks.frustumCulled = false

  // canopy clumps
  const clumps = []
  for (const t of trees) {
    const r = mulberry(Math.floor(t.seed * 1000) + 7)
    const Rc = t.h * 0.36
    const c = new THREE.Vector3(t.x, t.y + t.h * 0.64, t.z)
    const n = t.isl === STATIC ? 15 : 7
    for (let k = 0; k < n; k++) {
      // an umbrella of clumps: wide, a little flattened, heavier on top
      const a = (k / n) * Math.PI * 2 * 2.618 + r() * 0.6
      const e = k === 0 ? 1.2 : -0.45 + r() * 1.4
      const d = k === 0 ? Rc * 0.2 : Rc * (0.5 + r() * 0.42)
      const x = c.x + Math.cos(a) * Math.cos(e) * d * 1.15
      const y = c.y + Math.sin(e) * d * 0.62
      const z = c.z + Math.sin(a) * Math.cos(e) * d * 1.15
      clumps.push([x, y, z, Rc * (k === 0 ? 0.6 : (n > 10 ? 0.24 : 0.3) + r() * 0.16), c.x, c.y, c.z, t.isl])
    }
  }
  const ico = new THREE.IcosahedronGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = ico.index
  geo.setAttribute('position', ico.getAttribute('position'))
  const A = new Float32Array(clumps.length * 4), B = new Float32Array(clumps.length * 4)
  clumps.forEach((c, i) => { A.set(c.slice(0, 4), i * 4); B.set(c.slice(4, 8), i * 4) })
  geo.setAttribute('aC', new THREE.InstancedBufferAttribute(A, 4))
  geo.setAttribute('aT', new THREE.InstancedBufferAttribute(B, 4))
  geo.instanceCount = clumps.length
  const leafMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    vertexShader: /* glsl */ `
      in vec4 aC; // clump centre, radius
      in vec4 aT; // tree canopy centre, island
      out vec3 vWorld;
      out vec3 vN;
      out vec3 vTN;
      out float vSun;
      ${noise}
      ${fog}
      ${gardenGLSL}
      ${bobGLSL}
      void main() {
        vec3 dir = normalize(position);
        vec3 b = bobOf(aT.w);
        vec3 c = aC.xyz + b;
        float lump = vnoise(dir.xz * 3.0 + aC.x * 0.13) * 0.45 + vnoise(dir.xy * 6.0 + aC.z * 0.1) * 0.35;
        // the breeze stirs the leaves
        float sway = sin(uTime * 1.3 + aC.x * 0.3 + aC.z * 0.2) * 0.05 * aC.w * gustAt(c.xz);
        vec3 p = c + dir * aC.w * (0.82 + lump * 0.4);
        p.x += sway * uWind.x * (dir.y + 1.0);
        p.z += sway * uWind.y * (dir.y + 1.0);
        vWorld = p;
        vN = dir;
        vTN = normalize(p - (aT.xyz + b));
        vSun = aT.w > 22.5 ? islandShadow(c) * cloudShadow(c) : cloudShadow(c);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      uniform vec3 uAmbGround;
      in vec3 vWorld;
      in vec3 vN;
      in vec3 vTN;
      in float vSun;
      out vec4 fragColor;
      ${noise}
      ${fog}
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);
        // leaf clusters at two scales, fading to calm far away
        vec3 q = vWorld * 2.2;
        float l1 = vnoise(q.xz + q.y * 0.7) * 0.5 + vnoise(q.xy * 1.9 - q.z) * 0.5;
        float l2 = vnoise(vWorld.xz * 7.0 + vWorld.y * 5.0);
        float calm = smoothstep(30.0, 160.0, dist);
        vec3 Nc = normalize(vN);
        vec3 N = normalize(mix(Nc, vTN, 0.6) + (vec3(l1, l2, 1.0 - l1) - 0.5) * 1.1 * (1.0 - calm));
        float rim = 1.0 - max(dot(Nc, V), 0.0);
        // ragged leafy silhouette
        float cut = mix(l2, l1, 0.4 + 0.5 * calm);
        if (rim > 0.45 && cut < (rim - 0.45) * 1.9) discard;
        float ndl = dot(N, uSunDir);
        float wrap = clamp((ndl + 0.2) / 1.2, 0.0, 1.0);
        float clumpLit = smoothstep(-0.35, 0.75, dot(Nc, uSunDir));
        float lit = wrap * vSun * mix(clumpLit, smoothstep(-0.5, 0.5, dot(vTN, uSunDir) + 0.25), 0.6);
        float inner = clamp(dot(vTN, Nc) * 0.5 + 0.5, 0.0, 1.0);
        vec3 deep = vec3(0.012, 0.035, 0.012);
        vec3 mid = vec3(0.035, 0.09, 0.018);
        vec3 hi = vec3(0.15, 0.23, 0.04);
        vec3 alb = mix(deep, mid, smoothstep(0.1, 0.7, l1 * 0.6 + inner * 0.5));
        alb = mix(alb, hi, smoothstep(0.45, 0.95, lit + l2 * 0.25) * 0.8);
        float ao = mix(0.35, 1.0, inner) * (0.7 + 0.3 * vTN.y);
        vec3 amb = mix(uAmbGround * 0.7, uAmbTop, vTN.y * 0.5 + 0.5);
        vec3 col = alb * (uSunColor * lit + amb * ao);
        float through = pow(max(dot(-V, uSunDir), 0.0), 4.0) * rim;
        col += vec3(0.2, 0.3, 0.04) * uSunColor * through * 0.35 * vSun;
        col = applyFog(col, vWorld);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const leaves = new THREE.Mesh(geo, leafMat)
  leaves.frustumCulled = false
  return { trunks, leaves }
}
