// Floating islands: a grassy cap on a craggy inverted mountain of layered
// rock, soil and dangling roots. Every island is merged into one mesh; each
// vertex knows its island so the whole thing can bob in one draw call.

import * as THREE from 'three'
import { makeNoise2D } from '../../lib/noise.js'
import { gardenGLSL } from './common.js'
import { noise, fog } from '../../lib/glsl.js'

export const NBOB = 24 // bob slots; the last one never moves (ground things)
export const STATIC = NBOB - 1

// --- small deterministic 3D value noise for shaping rock on the CPU
function h3(i, j, k) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
export function vn3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z)
  const fx = x - i, fy = y - j, fz = z - k
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz)
  const a = h3(i, j, k), b = h3(i + 1, j, k), c = h3(i, j + 1, k), d = h3(i + 1, j + 1, k)
  const e = h3(i, j, k + 1), f = h3(i + 1, j, k + 1), g = h3(i, j + 1, k + 1), hh = h3(i + 1, j + 1, k + 1)
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (hh - g) * u
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v
  return y1 + (y2 - y1) * w
}
export function fbm3(x, y, z, o = 4) {
  let s = 0, a = 0.5, n = 0
  for (let i = 0; i < o; i++) { s += a * vn3(x, y, z); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 - 9.2; a *= 0.5 }
  return s / n
}
export function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// rim radius of island I at angle th (world units, from its centre)
export function rimRadius(I, th) {
  const n = I._n || (I._n = makeNoise2D(I.seed * 17 + 5))
  const c = Math.cos(th), s = Math.sin(th)
  return I.r * (1 + 0.17 * n(c * 1.1 + I.seed, s * 1.1) + 0.07 * n(c * 3.1 - I.seed, s * 3.1 + 2) + 0.025 * n(c * 7, s * 7))
}
// height of the grassy top at local polar (k = fraction of the rim radius)
export function topHeight(I, k, th) {
  const n = I._n || (I._n = makeNoise2D(I.seed * 17 + 5))
  const dome = I.r * 0.07
  return dome * (1 - k * k) + I.r * 0.02 * n(Math.cos(th) * k * 2 + 9, Math.sin(th) * k * 2) * k
}

function buildIsland(I, idx, out) {
  const A = I.a
  const base = out.pos.length / 3
  const rimR = []
  for (let a = 0; a < A; a++) rimR.push(rimRadius(I, (a / A) * Math.PI * 2))
  const rnd = mulberry(I.seed * 101)
  const tipDir = rnd() * Math.PI * 2
  const tipOff = I.id === 'goal' ? 0 : I.r * (0.12 + rnd() * 0.18)
  const push = (x, y, z, top, s) => {
    out.pos.push(I.x + x, I.y + y, I.z + z)
    out.isl.push(idx)
    out.top.push(top)
    out.depth.push(s)
  }
  // rings: top (k from centre to rim), rim lip, soil band, then the rock
  const topK = [0.18, 0.4, 0.6, 0.76, 0.88, 0.96, 1.0]
  const rows = []
  // centre vertex
  push(0, topHeight(I, 0, 0), 0, 1, 0)
  const centre = base
  let row = 0
  for (const k of topK) {
    const r0 = out.pos.length / 3
    for (let a = 0; a < A; a++) {
      const th = (a / A) * Math.PI * 2
      const R = rimR[a] * k
      push(Math.cos(th) * R, topHeight(I, k, th), Math.sin(th) * R, 1, 0)
    }
    rows.push(r0)
    row++
  }
  // lip and soil
  const lip = [[1.02, -0.5, 0.75], [1.015, -1.4, 0.5], [0.995, -2.6, 0.3]]
  for (const [kr, dy, top] of lip) {
    const r0 = out.pos.length / 3
    for (let a = 0; a < A; a++) {
      const th = (a / A) * Math.PI * 2
      const R = rimR[a] * kr
      push(Math.cos(th) * R, dy - (I.r > 20 ? 0.6 * (kr < 1 ? 1 : 0) : 0), Math.sin(th) * R, top, 0)
    }
    rows.push(r0)
  }
  // rock: a thick earthen plate, a bulging belly, then a long fluted taper
  const R = I.rings
  const soilY = -2.6
  const sc = 1 / Math.max(6, I.r * 0.22)
  const lobes = 2 + Math.floor(rnd() * 3)
  const lobePh = rnd() * Math.PI * 2
  const ex = 1.5 + rnd() * 0.6
  for (let q = 1; q <= R; q++) {
    const s = q / R
    const y = soilY - (I.d - 2.6) * s
    const r0 = out.pos.length / 3
    const last = q === R
    for (let a = 0; a < A; a++) {
      const th = (a / A) * Math.PI * 2
      const e = ex + 0.5 * (fbm3(Math.cos(th) * 1.3 + I.seed, s * 1.5, Math.sin(th) * 1.3, 2) - 0.5)
      let f = Math.pow(Math.max(0, 1 - Math.pow(s, e)), 1.25)
      // the lower part splits into flutes that meet at the tip
      f *= 1 + 0.32 * s * s * Math.cos(lobes * (th - lobePh))
      // strata: horizontal ledges
      const band = ((y * 0.3 + fbm3(th * 0.8, I.seed, 0, 2) * 2) % 1 + 1) % 1
      f *= 1 - 0.05 * band * (1 - s * 0.5)
      const rr = rimR[a] * 0.99 * f
      const cx = Math.cos(tipDir) * tipOff * s * s
      const cz = Math.sin(tipDir) * tipOff * s * s
      let px = cx + Math.cos(th) * rr
      let pz = cz + Math.sin(th) * rr
      // lumps
      const d = (fbm3(px * sc, y * sc * 1.4, pz * sc, 4) - 0.5) * I.r * 0.3 * (0.35 + s) * (1 - s * s * 0.7)
      const len = Math.hypot(px - cx, pz - cz) || 1
      px += ((px - cx) / len) * d
      pz += ((pz - cz) / len) * d
      if (last) { px = cx; pz = cz }
      push(px, y, pz, 0, s)
    }
    rows.push(r0)
  }
  // hanging spurs of rock around the belly, breaking the silhouette
  const spurs = I.r < 8 ? 0 : 2 + Math.floor(rnd() * 3)
  const spurList = []
  for (let k = 0; k < spurs; k++) {
    const th = lobePh + (k / spurs) * Math.PI * 2 + (rnd() - 0.5) * 0.8
    const s0 = 0.25 + rnd() * 0.25
    const y0 = soilY - (I.d - 2.6) * s0
    const f0 = Math.pow(Math.max(0, 1 - Math.pow(s0, ex)), 1.25)
    const R0 = rimRadius(I, th) * f0 * 0.72
    spurList.push({ x: Math.cos(th) * R0, z: Math.sin(th) * R0, y: y0, len: I.d * (0.2 + rnd() * 0.25), w: I.r * (0.14 + rnd() * 0.1), seed: rnd() * 50, s0 })
  }
  const spurRows = []
  for (const sp of spurList) {
    const SA = 12, SR = 7
    const first = out.pos.length / 3
    for (let q = 0; q <= SR; q++) {
      const t = q / SR
      for (let a = 0; a < SA; a++) {
        const th = (a / SA) * Math.PI * 2
        const rr = sp.w * Math.pow(1 - t, 1.1) * (0.8 + 0.4 * vn3(Math.cos(th) * 2 + sp.seed, t * 3, Math.sin(th) * 2))
        const lean = t * t * sp.w * 0.6
        push(sp.x + Math.cos(th) * rr + (sp.x / (Math.hypot(sp.x, sp.z) || 1)) * lean, sp.y + sp.w * 0.6 - sp.len * t, sp.z + Math.sin(th) * rr + (sp.z / (Math.hypot(sp.x, sp.z) || 1)) * lean, 0, Math.min(1, sp.s0 + t * 0.5))
      }
    }
    spurRows.push({ first, SA, SR })
  }
  // indices
  const fan0 = rows[0]
  for (let a = 0; a < A; a++) out.idx.push(centre, fan0 + ((a + 1) % A), fan0 + a)
  for (let r = 0; r < rows.length - 1; r++) {
    const r0 = rows[r], r1 = rows[r + 1]
    for (let a = 0; a < A; a++) {
      const a1 = (a + 1) % A
      out.idx.push(r0 + a, r0 + a1, r1 + a)
      out.idx.push(r0 + a1, r1 + a1, r1 + a)
    }
  }
  for (const { first, SA, SR } of spurRows) {
    for (let q = 0; q < SR; q++) {
      const r0 = first + q * SA, r1 = r0 + SA
      for (let a = 0; a < SA; a++) {
        const a1 = (a + 1) % SA
        out.idx.push(r0 + a, r0 + a1, r1 + a)
        out.idx.push(r0 + a1, r1 + a1, r1 + a)
      }
    }
  }
  return { rimR, tipDir, tipOff }
}

export function buildIslandsGeometry(list) {
  const out = { pos: [], isl: [], top: [], depth: [], idx: [] }
  const info = list.map((I, i) => buildIsland(I, i, out))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3))
  g.setAttribute('aIsl', new THREE.Float32BufferAttribute(out.isl, 1))
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(out.top, 1))
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(out.depth, 1))
  g.setIndex(out.idx)
  g.computeVertexNormals()
  return { geometry: g, info }
}

export const bobGLSL = /* glsl */ `
  uniform vec4 uBob[${NBOB}];
  vec3 bobOf(float i) { return uBob[int(i + 0.5)].xyz; }
`

export function makeBobUniform() {
  return { value: Array.from({ length: NBOB }, () => new THREE.Vector4()) }
}

export function makeIslands(env, gu, list, bobU) {
  const { geometry, info } = buildIslandsGeometry(list)
  const uniforms = { ...env.uniforms, ...gu, uBob: bobU }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    vertexShader: /* glsl */ `
      in float aIsl;
      in float aTop;
      in float aDepth;
      out vec3 vWorld;
      out vec3 vNormal;
      out float vTop;
      out float vDepth;
      out vec3 vLocal;
      ${bobGLSL}
      void main() {
        vec3 p = position + bobOf(aIsl);
        vWorld = p;
        vLocal = position;
        vNormal = normal;
        vTop = aTop;
        vDepth = aDepth;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      uniform vec3 uAmbGround;
      in vec3 vWorld;
      in vec3 vNormal;
      in float vTop;
      in float vDepth;
      in vec3 vLocal;
      out vec4 fragColor;
      ${noise}
      ${fog}
      ${gardenGLSL}
      float tri(vec3 p, vec3 n) {
        vec3 w = abs(n); w /= (w.x + w.y + w.z);
        return vnoise(p.yz) * w.x + vnoise(p.xz) * w.y + vnoise(p.xy) * w.z;
      }
      void main() {
        vec3 N0 = normalize(vNormal);
        vec3 p = vLocal;
        float dist = length(cameraPosition - vWorld);
        // rock detail as a bump from screen-space derivatives
        float n1 = tri(p * 0.35, N0);
        float n2 = tri(p * 1.4 + 3.0, N0);
        float n3 = tri(p * 5.0 + 9.0, N0);
        float wy = p.y + n1 * 4.0 + n2 * 1.5;
        float strata = vnoise(vec2(wy * 0.18, 0.5)) * 0.65 + vnoise(vec2(wy * 0.6, 3.5)) * 0.35;
        float hgt = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
        vec3 dpx = dFdx(vLocal), dpy = dFdy(vLocal);
        float hx = dFdx(hgt), hy = dFdy(hgt);
        vec3 r1 = cross(dpy, N0), r2 = cross(N0, dpx);
        float det = dot(dpx, r1);
        vec3 grad = sign(det) * (hx * r1 + hy * r2);
        float bumpK = (1.0 - vTop) * 0.9 * (1.0 - smoothstep(150.0, 600.0, dist));
        vec3 N = normalize(abs(det) * N0 - grad * bumpK);

        // albedo: layered warm stone, dark soil under the turf, moss on ledges
        vec3 rockA = vec3(0.34, 0.24, 0.15);
        vec3 rockB = vec3(0.55, 0.46, 0.34);
        vec3 rockC = vec3(0.3, 0.29, 0.27);
        vec3 alb = mix(rockA, rockB, smoothstep(0.35, 0.7, strata));
        alb = mix(alb, rockC, smoothstep(0.5, 0.85, n2 + (strata - 0.5) * 0.5) * 0.55);
        // streaks of wet dark stain running down from the soil
        alb *= 1.0 - 0.35 * smoothstep(0.62, 0.9, vnoise(vec2(p.x * 0.35 + p.z * 0.2, p.y * 0.03))) * (1.0 - vDepth);
        alb *= 0.8 + 0.4 * n3;
        alb *= mix(1.0, 0.75, vDepth);
        float moss = smoothstep(0.25, 0.75, N.y + n2 * 0.4 - 0.2) * (1.0 - vDepth * 0.7);
        alb = mix(alb, vec3(0.05, 0.1, 0.022) * (0.7 + 0.6 * n1), moss * 0.85);
        vec3 soil = vec3(0.05, 0.035, 0.022) * (0.8 + 0.4 * n2);
        float soilK = smoothstep(0.1, 0.35, vTop) * (1.0 - smoothstep(0.6, 0.9, vTop));
        alb = mix(alb, soil, soilK);
        float pch = 0.5 + 0.5 * sin(vLocal.x * 0.05 + vLocal.z * 0.04);
        vec3 turf = grassTip(vLocal.xz, pch, 0.5 + 0.3 * (n1 - 0.5)) * 0.95;
        alb = mix(alb, turf, smoothstep(0.6, 0.9, vTop));

        vec3 V = normalize(cameraPosition - vWorld);
        float ndl = dot(N, uSunDir);
        float diff = vTop > 0.6 ? clamp((ndl + 0.35) / 1.35, 0.0, 1.0) : max(ndl, 0.0);
        // light bounced up from the sunlit meadow keeps the bellies alive
        vec3 amb = N.y > 0.0 ? mix(uAmbHorizon, uAmbTop, N.y) : mix(uAmbHorizon * 0.8, uAmbGround, -N.y);
        float ao = mix(1.0, 0.7, vDepth) * (0.75 + 0.25 * n1);
        vec3 col = alb * (uSunColor * diff + amb * ao);
        float back = pow(max(dot(-V, uSunDir), 0.0), 6.0) * pow(1.0 - max(dot(N, V), 0.0), 2.0);
        col += alb * uSunColor * back * 0.6;
        col = applyFog(col, vWorld);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.frustumCulled = false
  return { mesh, info }
}

// Roots and vines dangling from the soil band and the upper underside.
export function makeRoots(env, gu, list, info, bobU) {
  const SEG = 7
  const pos = [], aA = [], aB = [], idx = []
  let vi = 0
  list.forEach((I, i) => {
    const rnd = mulberry(I.seed * 7 + 3)
    const n = Math.round(Math.min(70, 8 + I.r * 1.2))
    for (let k = 0; k < n; k++) {
      const th = rnd() * Math.PI * 2
      const deep = rnd() < 0.12
      const R = rimRadius(I, th) * (deep ? 0.55 + rnd() * 0.3 : 0.97)
      const y = deep ? -2.6 - (I.d * (0.12 + rnd() * 0.22)) : -1.4 - rnd() * 1.2
      const len = (deep ? 5 : 3) + rnd() * Math.min(16, I.r * 0.45)
      const x = I.x + Math.cos(th) * R, z = I.z + Math.sin(th) * R
      for (let s = 0; s <= SEG; s++) {
        for (const side of [-1, 1]) {
          pos.push(x, I.y + y, z)
          aA.push(s / SEG, side, len, i)
          aB.push(Math.cos(th), Math.sin(th), rnd() * 100, 0.03 + rnd() * 0.07)
          vi++
        }
      }
      const b = vi - (SEG + 1) * 2
      for (let s = 0; s < SEG; s++) {
        const a = b + s * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aA', new THREE.Float32BufferAttribute(aA, 4))
  g.setAttribute('aB', new THREE.Float32BufferAttribute(aB, 4))
  g.setIndex(idx)
  const uniforms = { ...env.uniforms, ...gu, uBob: bobU }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      in vec4 aA; // t, side, length, island
      in vec4 aB; // outward xz, seed, width
      out vec3 vWorld;
      out float vT;
      out float vSide;
      uniform float uTime;
      ${bobGLSL}
      void main() {
        float t = aA.x;
        vec3 root = position + bobOf(aA.w);
        vec2 out2 = aB.xy;
        float sw = sin(uTime * (0.5 + fract(aB.z) * 0.4) + aB.z) * 0.6 * t * t;
        float sw2 = cos(uTime * 0.37 + aB.z * 1.7) * 0.4 * t * t;
        vec3 p = root + vec3(out2.x, 0.0, out2.y) * (0.6 * t + 0.4 * sin(t * 3.0)) * 0.6 + vec3(0.0, -aA.z * t, 0.0);
        p.x += sw * out2.y + sw2 * 0.5;
        p.z -= sw * out2.x;
        vec3 tng = normalize(vec3(out2.x * 0.3, -aA.z, out2.y * 0.3));
        vec3 toC = normalize(cameraPosition - p);
        vec3 side = normalize(cross(tng, toC));
        float d = length(cameraPosition - p);
        float w = aB.w * (1.0 - 0.75 * t) * (1.0 + d * 0.004);
        p += side * aA.y * w;
        vWorld = p;
        vT = t;
        vSide = aA.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbGround;
      uniform vec3 uAmbHorizon;
      in vec3 vWorld;
      in float vT;
      in float vSide;
      out vec4 fragColor;
      ${fog}
      void main() {
        vec3 alb = mix(vec3(0.06, 0.045, 0.03), vec3(0.09, 0.1, 0.04), vT);
        float lit = 0.35 + 0.35 * (vSide * 0.5 + 0.5);
        vec3 col = alb * (uSunColor * lit * 0.35 + uAmbGround * 2.0 + uAmbHorizon * 0.4);
        col = applyFog(col, vWorld);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  return mesh
}
