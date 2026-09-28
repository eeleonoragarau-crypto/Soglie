// L'Abisso, as data: the winding path of hexagonal glass tiles, its two
// platforms, the trail of stars above it, the drifting shards, and where the
// hole and the galaxy sit. Pure JS, no rendering here.

import * as THREE from 'three'

export const HEX = 1.0 // cell circumradius (m), pointy-top axial grid
export const TILE_R = HEX - 0.06 // the glass tile itself, leaving a thin seam
const SQ3 = Math.sqrt(3)
const COLUMNS = 0 // far hexagonal columns: off, they read as dark sticks against the galaxy

// the black hole: centre (m), Schwarzschild radius (m), traced sphere (in rs)
export const BH = { x: 12, y: -22, z: 770, rs: 22, R: 14 }
// accretion disk plane: slightly tilted toward the path, rolled a little
const TILT = (2.2 * Math.PI) / 180
const ROLL = (-9 * Math.PI) / 180
export const DISK_N = new THREE.Vector3(-Math.sin(ROLL) * Math.cos(TILT), Math.cos(ROLL) * Math.cos(TILT), -Math.sin(TILT)).normalize()

// the spiral galaxy far below: centre, normal, radius (m)
export const GAL = { c: new THREE.Vector3(560, -1150, 2100), n: new THREE.Vector3(0.05, 1, -0.28).normalize(), r: 3400 }

export const START = { x: 0, y: 0, z: 1.2, r: 6.6 }
export const END = { x: 3, y: 6.6, z: 300, r: 6.4 }
export const KEY_AT = new THREE.Vector3(END.x + 0.6, END.y + 0.28, END.z + 2.2)

// centre line of the path: x, y, z, half width
const CTRL = [
  [0, 0, 6.5, 2.4],
  [3, 0.1, 19, 1.9],
  [11, 0.4, 33, 1.6],
  [13, 0.8, 49, 1.45],
  [5, 1.1, 63, 1.7],
  [-8, 1.3, 75, 1.45],
  [-19, 1.6, 90, 1.35],
  [-22, 2.0, 107, 1.6],
  [-15, 2.4, 123, 1.8],
  [-2, 2.7, 136, 1.45],
  [13, 3.0, 149, 1.35],
  [23, 3.4, 166, 1.6],
  [20, 3.9, 184, 1.45],
  [8, 4.3, 199, 1.35],
  [-6, 4.7, 214, 1.5],
  [-13, 5.1, 231, 1.7],
  [-9, 5.6, 250, 1.55],
  [1, 6.0, 266, 1.5],
  [4, 6.4, 283, 1.9],
  [3, 6.6, 294, 2.6],
]

// two breaks in the path that need a jump: near a point, length along the path (m)
const GAPS = [
  { at: [-19.5, 115], len: 3.3 },
  { at: [-11.5, 241], len: 4.4 },
]

export function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hexCenter(q, r) {
  return [HEX * SQ3 * (q + r / 2), HEX * 1.5 * r]
}

// nearest cell (axial q, r) to a point
export function hexRound(x, z) {
  const qf = ((SQ3 / 3) * x - z / 3) / HEX
  const rf = ((2 / 3) * z) / HEX
  const yf = -qf - rf
  let rq = Math.round(qf), rr = Math.round(rf), ry = Math.round(yf)
  const dq = Math.abs(rq - qf), dr = Math.abs(rr - rf), dy = Math.abs(ry - yf)
  if (dq > dr && dq > dy) rq = -rr - ry
  else if (dr > dy) rr = -rq - ry
  return [rq, rr]
}

export const cellKey = (q, r) => q * 4096 + r

export function buildLayout() {
  const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal')
  const len = curve.getLength()
  const N = Math.ceil(len / 0.25)
  const samples = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const p = curve.getPointAt(u)
    const tan = curve.getTangentAt(u)
    const f = curve.getUtoTmapping(u) * (CTRL.length - 1)
    const k = Math.min(CTRL.length - 2, Math.floor(f))
    const w = CTRL[k][3] + (CTRL[k + 1][3] - CTRL[k][3]) * (f - k)
    samples.push({ p, tan, s: u * len, w })
  }

  // gap intervals in arc length
  const gaps = GAPS.map((g) => {
    let best = 0, bd = Infinity
    samples.forEach((sm, i) => {
      const d = Math.hypot(sm.p.x - g.at[0], sm.p.z - g.at[1])
      if (d < bd) { bd = d; best = i }
    })
    const s = samples[best].s
    return [s - g.len / 2, s + g.len / 2]
  })
  const inGap = (s) => gaps.some(([a, b]) => s > a && s < b)

  // path cells: every cell whose centre lies within the half width of the line
  const cells = new Map()
  for (const sm of samples) {
    const [q0, r0] = hexRound(sm.p.x, sm.p.z)
    const n = Math.ceil(sm.w / HEX) + 1
    for (let dq = -n; dq <= n; dq++) {
      for (let dr = -n; dr <= n; dr++) {
        const q = q0 + dq, r = r0 + dr
        const [cx, cz] = hexCenter(q, r)
        const d = Math.hypot(cx - sm.p.x, cz - sm.p.z)
        if (d > sm.w) continue
        const k = cellKey(q, r)
        const c = cells.get(k)
        if (!c || d < c.d) cells.set(k, { q, r, x: cx, z: cz, d, s: sm.s, y: sm.p.y, tan: sm.tan, kind: 0 })
      }
    }
  }
  for (const [k, c] of cells) if (inGap(c.s)) cells.delete(k)

  // platforms: flat discs of cells
  const platform = (P, s, tan) => {
    const [q0, r0] = hexRound(P.x, P.z)
    const n = Math.ceil(P.r / HEX) + 2
    for (let dq = -n; dq <= n; dq++) {
      for (let dr = -n; dr <= n; dr++) {
        const q = q0 + dq, r = r0 + dr
        const [cx, cz] = hexCenter(q, r)
        const d = Math.hypot(cx - P.x, cz - P.z)
        if (d > P.r) continue
        cells.set(cellKey(q, r), { q, r, x: cx, z: cz, d, s, y: P.y, tan, kind: 1 })
      }
    }
  }
  platform(START, 0, new THREE.Vector3(0, 0, 1))
  platform(END, len, samples[samples.length - 1].tan.clone())

  // the altar under the key
  const [aq, ar] = hexRound(KEY_AT.x, KEY_AT.z)
  const altar = cells.get(cellKey(aq, ar))
  if (altar) { altar.kind = 2 }

  const rnd = mulberry(7)
  const tiles = []
  for (const c of cells.values()) {
    let top = c.y
    if (c.kind === 0) {
      // path tiles float a little unevenly; they blend flat into the platforms
      const jit = (rnd() - 0.5) * 0.08
      const toStart = Math.hypot(c.x - START.x, c.z - START.z) - START.r
      const toEnd = Math.hypot(c.x - END.x, c.z - END.z) - END.r
      const calm = Math.min(1, Math.max(0, Math.min(toStart, toEnd) / 4))
      top += jit * calm
    } else if (c.kind === 2) top += 0.28
    tiles.push({ q: c.q, r: c.r, x: c.x, z: c.z, top, kind: c.kind, s: c.s, seed: rnd(), tan: c.tan, lit: 0, visited: 0, pinged: -99 })
  }
  tiles.sort((a, b) => a.s - b.s)
  const lookup = new Map()
  tiles.forEach((t, i) => { t.i = i; lookup.set(cellKey(t.q, t.r), t) })

  // the trail of stars hovering above the path, gaps included
  const markers = []
  for (let s = 9; s < len - 3; s += 4.4) {
    const p = curve.getPointAt(s / len)
    markers.push({ x: p.x + (rnd() - 0.5) * 0.5, y: p.y + 2.5 + rnd() * 0.5, z: p.z + (rnd() - 0.5) * 0.5, s, seed: rnd() })
  }

  // drifting shards and far hexagonal columns
  const shards = []
  const farFromPath = (x, y, z, m) => samples.every((sm, i) => i % 8 !== 0 || Math.hypot(sm.p.x - x, (sm.p.y - y) * 0.6, sm.p.z - z) > m)
  let tries = 0
  while (shards.length < 70 && tries++ < 4000) {
    const sm = samples[Math.floor(rnd() * samples.length)]
    const side = rnd() < 0.5 ? -1 : 1
    const off = 14 + Math.pow(rnd(), 0.7) * 70
    const nx = -sm.tan.z, nz = sm.tan.x
    const x = sm.p.x + nx * off * side + (rnd() - 0.5) * 10
    const z = sm.p.z + nz * off * side + (rnd() - 0.5) * 10
    const y = sm.p.y + (rnd() < 0.7 ? -1 : 1) * (4 + Math.pow(rnd(), 0.8) * 40)
    if (z > BH.z - BH.rs * BH.R - 30) continue
    if (!farFromPath(x, y, z, 11)) continue
    const s = 0.5 + Math.pow(rnd(), 2) * 1.8
    shards.push({ x, y, z, sx: s, sy: s * (0.8 + rnd() * 1.6), sz: s, seed: rnd(), speed: 0.03 + rnd() * 0.12, kind: 0 })
  }
  tries = 0
  while (shards.length < 70 + COLUMNS && tries++ < 4000) {
    const a = rnd() * Math.PI * 2
    const d = 90 + rnd() * 330
    const x = Math.cos(a) * d * 1.2 + 0
    const z = 150 + Math.sin(a) * d
    if (z > BH.z - BH.rs * BH.R - 60) continue
    if (Math.abs(x) < 60 && z > -40 && z < 330) continue // keep the corridor clear
    const y = -30 - rnd() * 140 + (rnd() < 0.25 ? 120 : 0)
    if (!farFromPath(x, y, z, 50)) continue
    const w = 3 + rnd() * 7
    shards.push({ x, y, z, sx: w, sy: 18 + rnd() * 90, sz: w, seed: rnd(), speed: 0.004 + rnd() * 0.01, kind: 1 })
  }

  return { curve, len, samples, tiles, lookup, markers, shards, gaps }
}

// hexagonal prism with a bevelled top and a cut-gem underside; top face at y = 0
export function hexPrism({ r = TILE_R, bevel = 0.045, side = 0.16, taper = 0.2, bottom = 0.68 } = {}) {
  const rings = [
    [r - bevel, 0],
    [r, -bevel],
    [r, -bevel - side],
    [r * bottom, -bevel - side - taper],
  ]
  const pos = []
  const nor = []
  const corner = (k, rad, y) => {
    const a = Math.PI / 6 + (k * Math.PI) / 3
    return new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad)
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3()
  const tri = (a, b, c, hint) => {
    _n.crossVectors(_a.subVectors(b, a), _b.subVectors(c, a)).normalize()
    if (_n.dot(hint) < 0) { const t = b; b = c; c = t; _n.negate() }
    for (const v of [a, b, c]) { pos.push(v.x, v.y, v.z); nor.push(_n.x, _n.y, _n.z) }
  }
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0)
  const top = rings[0], bot = rings[rings.length - 1]
  for (let k = 0; k < 6; k++) {
    tri(new THREE.Vector3(0, top[1], 0), corner(k, top[0], top[1]), corner(k + 1, top[0], top[1]), up)
    tri(new THREE.Vector3(0, bot[1], 0), corner(k, bot[0], bot[1]), corner(k + 1, bot[0], bot[1]), down)
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const [r0, y0] = rings[i], [r1, y1] = rings[i + 1]
    for (let k = 0; k < 6; k++) {
      const a = corner(k, r0, y0), b = corner(k + 1, r0, y0)
      const c = corner(k + 1, r1, y1), d = corner(k, r1, y1)
      const mid = a.clone().add(b).add(c).add(d).multiplyScalar(0.25)
      // outward, and up for the bevel, down for the gem cut
      const hint = new THREE.Vector3(mid.x, r1 > r0 ? 0.6 : r1 < r0 ? -0.6 : 0, mid.z).normalize()
      tri(a, b, c, hint)
      tri(a, c, d, hint)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.computeBoundingSphere()
  return g
}
