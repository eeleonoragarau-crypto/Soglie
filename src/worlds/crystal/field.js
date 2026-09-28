// Where the crystals grow. Druses of tilted hexagonal prisms around the
// valley, a few composed ones that frame the arrival view, far spires that
// stand in the haze like mountains, crystals floating high in the air, the
// three resonant crystals and the petals of the great one.

import * as THREE from 'three'
import { HEART, RES, VALLEY, saltHeight, mulberry, segDist } from './layout.js'

const UP = new THREE.Vector3(0, 1, 0)
const _k = new THREE.Vector3()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()

// orientation: spin about the own axis, then lean toward leanDir
function orient(spin, lean, leanDir) {
  _q2.setFromAxisAngle(UP, spin)
  _k.set(Math.sin(leanDir), 0, -Math.cos(leanDir)) // = cross(up, (cos, 0, sin))
  _q1.setFromAxisAngle(_k, lean)
  return new THREE.Quaternion().multiplyQuaternions(_q1, _q2)
}

const PALETTE = [
  [0.97, 0.97, 1.0], // clear
  [1.0, 0.84, 0.9], // rose quartz
  [0.88, 0.83, 1.0], // amethyst milk
  [1.0, 0.88, 0.8], // peach
  [0.93, 0.9, 1.0], // pale lilac
  [0.97, 0.97, 1.0],
]

export function buildField() {
  const rnd = mulberry(23)
  const crystals = []
  const colliders = []
  const casters = []
  const heart = []
  const petals = []

  const add = (o, into = crystals) => {
    const lean = o.lean ?? 0
    const dir = o.leanDir ?? 0
    const R = o.R
    const g = saltHeight(o.x, o.z)
    const sink = R * Math.sin(lean) + 0.35 + (o.sink ?? 0)
    const c = {
      x: o.x, y: (o.y ?? g) - (o.y !== undefined ? 0 : sink), z: o.z,
      R, H: o.H + (o.y !== undefined ? 0 : sink), K: o.K ?? 1.0 + rnd() * 0.35, taper: o.taper ?? 0.88 + rnd() * 0.1,
      q: orient(o.spin ?? rnd() * Math.PI, lean, dir),
      tint: o.tint, glow: o.glow ?? 0,
      type: o.type ?? 0, a: o.a ?? 0, b: o.b ?? 0, c: o.c ?? 0,
      seed: rnd(),
    }
    into.push(c)
    if (!o.noCollide && R > 0.3) {
      const off = Math.sin(lean) * 1.0
      colliders.push({ type: 'circle', x: o.x + Math.cos(dir) * off, z: o.z + Math.sin(dir) * off, r: R * 0.95 + 0.05 })
    }
    return c
  }
  const vary = (t, k = 0.04) => t.map((v) => Math.min(1, v + (rnd() - 0.5) * k))

  // a druse: a main prism and satellites leaning away from it
  const druse = (cx, cz, H, n, tint, o = {}) => {
    const R = H / (o.slim ?? 4.2 + rnd() * 2.6)
    const ld = rnd() * Math.PI * 2
    const main = add({ x: cx, z: cz, R, H, lean: o.lean ?? rnd() * 0.2, leanDir: ld, tint: vary(tint), glow: o.glow ?? (rnd() < 0.3 ? rnd() * 0.12 : 0) })
    const items = [main]
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2
      const d = R * (1.0 + rnd() * 2.4)
      const h = H * (0.15 + Math.pow(rnd(), 1.4) * 0.6)
      const r = Math.max(0.18, h / (3.2 + rnd() * 3.5))
      items.push(add({
        x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, R: r, H: h,
        lean: 0.18 + rnd() * 0.6, leanDir: a + (rnd() - 0.5) * 0.7, tint: vary(tint), glow: rnd() < 0.15 ? rnd() * 0.2 : 0,
      }))
    }
    return items
  }

  const keep = [
    { x: 0, z: 0, r: 24 },
    { x: HEART.x, z: HEART.z, r: 60 },
    ...RES.map((r) => ({ x: r.x, z: r.z, r: 26 })),
  ]
  const lines = [HEART, ...RES]
  const free = (x, z, pad) => {
    for (const k of keep) if (Math.hypot(x - k.x, z - k.z) < k.r + pad) return false
    for (const t of lines) {
      const d = Math.hypot(t.x, t.z)
      const along = Math.max(0, Math.min(1, (x * t.x + z * t.z) / (d * d)))
      if (segDist(x, z, 0, 0, t.x, t.z) < 9 + pad * 0.6 + along * d * 0.04) return false
    }
    return true
  }

  // --- composed near the arrival: scale at your feet, framing the valley
  druse(-15, 27, 7.5, 5, PALETTE[1], { slim: 3.6, lean: 0.12 })
  druse(23, 46, 9, 6, PALETTE[2], { slim: 4.2, lean: 0.1 })
  druse(-44, 44, 11, 4, PALETTE[0], { slim: 4 })
  druse(56, 84, 17, 5, PALETTE[4], { slim: 5 })
  druse(-62, 170, 30, 6, PALETTE[0], { slim: 5.2, lean: 0.06 })
  druse(76, 236, 38, 7, PALETTE[1], { slim: 5.5, lean: 0.1 })
  druse(-92, 196, 44, 6, PALETTE[3], { slim: 6, lean: 0.12 })
  druse(98, 246, 56, 7, PALETTE[2], { slim: 6.4, lean: 0.07 })
  druse(-120, 60, 26, 5, PALETTE[4], { slim: 5 })
  druse(112, 60, 20, 5, PALETTE[0], { slim: 4.5 })
  const placed = crystals.map((c) => ({ x: c.x, z: c.z }))

  // --- the valley
  const clusters = []
  for (let tries = 0; tries < 3000 && clusters.length < 58; tries++) {
    const a = rnd() * Math.PI * 2
    const r = 50 + Math.pow(rnd(), 0.8) * 560
    const x = VALLEY.x + Math.cos(a) * r, z = VALLEY.z + Math.sin(a) * r
    const big = rnd()
    const H = big < 0.1 ? 36 + rnd() * 24 : big < 0.38 ? 16 + rnd() * 20 : 5 + rnd() * 11
    if (!free(x, z, H * 0.3 + 4)) continue
    if (clusters.some((c) => Math.hypot(c.x - x, c.z - z) < 24 + (c.H + H) * 0.35)) continue
    if (placed.some((c) => Math.hypot(c.x - x, c.z - z) < 20 + H * 0.3)) continue
    clusters.push({ x, z, H })
    druse(x, z, H, 2 + Math.floor(rnd() * 6), PALETTE[Math.floor(rnd() * PALETTE.length)])
  }

  // --- far spires in the haze, like mountains
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2
    const r = 900 + rnd() * 1500
    const x = VALLEY.x + Math.cos(a) * r, z = VALLEY.z + Math.sin(a) * r
    const H = 90 + rnd() * 190
    const R = H / (4 + rnd() * 3)
    add({ x, z, R, H, lean: rnd() * 0.22, leanDir: rnd() * 6.28, tint: PALETTE[Math.floor(rnd() * 5)], noCollide: true })
    const n = 1 + Math.floor(rnd() * 3)
    for (let k = 0; k < n; k++) {
      const b = rnd() * 6.28
      const h = H * (0.3 + rnd() * 0.4)
      add({ x: x + Math.cos(b) * R * 2, z: z + Math.sin(b) * R * 2, R: h / 4.5, H: h, lean: 0.3 + rnd() * 0.4, leanDir: b, tint: PALETTE[0], noCollide: true })
    }
  }

  // --- floating crystals, double terminated, turning slowly
  const floating = []
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2
    const r = 110 + rnd() * 420
    const x = VALLEY.x + Math.cos(a) * r, z = VALLEY.z + Math.sin(a) * r
    const y = 70 + Math.pow(rnd(), 1.1) * 120
    const H = 8 + Math.pow(rnd(), 1.3) * 20
    const R = H / (2.6 + rnd() * 2)
    floating.push(add({
      x, y: y - H / 2, z, R, H, K: 1.1, taper: 1.0, lean: 0.2 + rnd() * 1.2, leanDir: rnd() * 6.28,
      tint: vary(PALETTE[Math.floor(rnd() * 5)]), glow: 0.05 + rnd() * 0.12,
      type: 3, a: (rnd() < 0.5 ? -1 : 1) * (0.03 + rnd() * 0.08), b: rnd(), c: 0.6 + rnd() * 1.6, noCollide: true,
    }))
  }

  // --- the three resonant crystals
  const res = []
  const rc = (i, o) => add({ ...o, tint: RES[i].tint.map((v) => 0.55 + v * 0.45), glow: o.glow ?? 1, type: 1, a: i })
  {
    const r = RES[0] // rose: one slender spire with small ones at its feet
    res.push([rc(0, { x: r.x, z: r.z, R: 1.35, H: 15.5, lean: 0.1, leanDir: 2.2, K: 1.25, taper: 0.9 })])
    for (let k = 0; k < 4; k++) {
      const a = k * 1.7 + 0.4
      res[0].push(rc(0, { x: r.x + Math.cos(a) * 2.2, z: r.z + Math.sin(a) * 2.2, R: 0.3 + rnd() * 0.2, H: 1.4 + rnd() * 2.2, lean: 0.5, leanDir: a, glow: 0.6 }))
    }
  }
  {
    const r = RES[1] // lilac: two crystals crossing
    res.push([
      rc(1, { x: r.x - 0.9, z: r.z, R: 1.05, H: 12.5, lean: 0.36, leanDir: 0.3, K: 1.2 }),
      rc(1, { x: r.x + 0.9, z: r.z, R: 1.0, H: 11.5, lean: 0.36, leanDir: Math.PI + 0.3, K: 1.2 }),
      rc(1, { x: r.x + 0.3, z: r.z + 2.2, R: 0.4, H: 3.2, lean: 0.5, leanDir: 1.6, glow: 0.6 }),
    ])
  }
  {
    const r = RES[2] // peach: a crown opening like a flower
    const g = [rc(2, { x: r.x, z: r.z, R: 1.1, H: 11, lean: 0.03, leanDir: 0, K: 1.3 })]
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.2
      g.push(rc(2, { x: r.x + Math.cos(a) * 1.6, z: r.z + Math.sin(a) * 1.6, R: 0.7, H: 5.5 + (k % 2) * 2, lean: 0.42, leanDir: a, glow: 0.8 }))
    }
    res.push(g)
  }

  // --- the petals of the great crystal (the window toward the door stays low)
  const toDoor = Math.atan2(-HEART.z, -HEART.x)
  for (let i = 0; i < 9; i++) {
    const a = toDoor + 0.62 + (i / 8) * (Math.PI * 2 - 1.24)
    const dr = HEART.R + 4.5 + rnd() * 3
    const H = 22 + (18 + rnd() * 26) * Math.sin((i / 8) * Math.PI)
    const x = HEART.x + Math.cos(a) * dr, z = HEART.z + Math.sin(a) * dr
    petals.push(add({
      x, z, R: 2.4 + H * 0.065, H, lean: 0.22 + rnd() * 0.12, leanDir: a, tint: vary([0.92, 0.88, 1.0]), glow: 0.08,
      type: 2, a: Math.cos(a), b: Math.sin(a), c: 0.4 + rnd() * 0.25, K: 1.1,
    }))
  }
  // two small ones in front, so the window is framed but open
  for (const s of [-1, 1]) {
    const a = toDoor + s * 0.34
    const x = HEART.x + Math.cos(a) * (HEART.R + 5), z = HEART.z + Math.sin(a) * (HEART.R + 5)
    petals.push(add({ x, z, R: 1.9, H: 9, lean: 0.4, leanDir: a, tint: [0.94, 0.9, 1.0], glow: 0.08, type: 2, a: Math.cos(a), b: Math.sin(a), c: 0.5 }))
  }
  // the heart itself
  const hc = add({ x: HEART.x, z: HEART.z, R: HEART.R, H: HEART.H, K: HEART.K, taper: HEART.taper, lean: 0.04, leanDir: 1.2, spin: 0.2, tint: [0.9, 0.84, 1.0], glow: 0.25, sink: 0.3, noCollide: true }, heart)

  // --- shadow casters: the heart, the resonant, the petals, then the biggest
  const castOf = (c) => ({ x: c.x, z: c.z, r: c.R * 0.9, h: c.H + c.y, tint: c.tint })
  casters.push({ ...castOf(hc), heart: true })
  for (const g of res) casters.push(castOf(g[0]))
  const big = crystals
    .filter((c) => c.type === 0 && Math.hypot(c.x - VALLEY.x, c.z - VALLEY.z) < 640 && c.H > 7)
    .sort((a, b) => b.H * b.R - a.H * a.R)
  const petalBig = petals.filter((p) => p.H > 20).slice(0, 4)
  for (const p of petalBig) casters.push(castOf(p))
  for (const c of big) { if (casters.length >= 28) break; casters.push(castOf(c)) }

  return { crystals, colliders, casters, heart: hc, res, petals, floating }
}
