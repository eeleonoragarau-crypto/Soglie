// Il Giardino Sospeso: single source of truth for the heightfield, the sun,
// the wind and every place that matters. Pure JS (no three) so a Node preview
// can import it too.

import { makeNoise2D, fbm, smoothstep } from '../../lib/noise.js'

// heightfield grid, shared by groundAt() and every shader (texelFetch bilinear)
export const HF = { n: 1024, s: 2.0 }
HF.half = (HF.n * HF.s) / 2

// late morning: warm sun high over the left shoulder of the first view
const el = (41 * Math.PI) / 180
const az = (62 * Math.PI) / 180 // from +Z (the arrival view) toward +X (screen left)
export const SUN = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]

// the breeze blows toward this direction (xz), roughly across the view
export const WIND_ANGLE = Math.atan2(0.62, -0.78)
export const WIND = [Math.cos(WIND_ANGLE), Math.sin(WIND_ANGLE)]

export const DOOR = { x: 0, z: 0, yaw: 0 }
// the pond at the foot of the upward waterfall
export const POND = { x: -64, z: 268, r: 17, depth: 0.7 }
export const BOUND = { soft: 600, hard: 700 }

// Floating islands. y: height of the grassy top, r: radius, d: depth of the
// rocky underside, a: angular detail, fall: rim angles (radians, 0 = +x)
// where a waterfall pours off, trees: how many grow on top.
export const ISLANDS = [
  { id: 'goal', x: POND.x, z: POND.z, y: 118, r: 46, d: 66, a: 80, rings: 26, seed: 1, trees: 5, fall: [], bob: 0.6 },
  { id: 'near', x: 78, z: 104, y: 70, r: 20, d: 27, a: 60, rings: 22, seed: 2, trees: 2, fall: [3.4], bob: 1.1 },
  { id: 'left', x: 230, z: 300, y: 102, r: 34, d: 42, a: 56, rings: 20, seed: 3, trees: 3, fall: [3.0, 4.2], bob: 0.9 },
  { id: 'right', x: -290, z: 430, y: 150, r: 52, d: 62, a: 60, rings: 20, seed: 4, trees: 4, fall: [5.9], bob: 0.8 },
  { id: 'far', x: 60, z: 880, y: 250, r: 96, d: 112, a: 56, rings: 18, seed: 5, trees: 7, fall: [4.9], bob: 0.5 },
  { id: 'farleft', x: 430, z: 640, y: 185, r: 62, d: 70, a: 48, rings: 16, seed: 6, trees: 4, fall: [], bob: 0.7 },
  { id: 'behind', x: -80, z: -160, y: 88, r: 36, d: 44, a: 52, rings: 20, seed: 7, trees: 3, fall: [1.2], bob: 1.0 },
  { id: 'side', x: -230, z: 130, y: 78, r: 26, d: 32, a: 48, rings: 18, seed: 8, trees: 2, fall: [0.4], bob: 1.2 },
  { id: 'back', x: 170, z: -70, y: 62, r: 22, d: 28, a: 44, rings: 18, seed: 9, trees: 2, fall: [], bob: 1.0 },
  { id: 'rock1', x: POND.x + 62, z: POND.z - 30, y: 70, r: 7, d: 10, a: 24, rings: 10, seed: 10, trees: 0, fall: [], bob: 1.6 },
  { id: 'rock2', x: POND.x - 50, z: POND.z + 20, y: 92, r: 9, d: 12, a: 24, rings: 10, seed: 11, trees: 1, fall: [], bob: 1.4 },
  { id: 'rock3', x: POND.x + 40, z: POND.z + 70, y: 84, r: 5, d: 7, a: 20, rings: 8, seed: 12, trees: 0, fall: [], bob: 1.8 },
  { id: 'rock4', x: POND.x - 24, z: POND.z - 56, y: 136, r: 6, d: 8, a: 20, rings: 8, seed: 13, trees: 0, fall: [], bob: 1.5 },
]

// natural rolling ground, before the pond basin is carved into it
export function makeNatural(seed = 5) {
  const A = makeNoise2D(seed)
  const B = makeNoise2D(seed * 7 + 3)
  const C = makeNoise2D(seed * 13 + 1)
  const D = makeNoise2D(seed * 31 + 7)
  return (x, z) => {
    // broad land swells and round meadow hills; almost no small-scale lumps
    let h = fbm(A, x / 640 + 0.3, z / 640 - 0.7, 3) * 26
    h += fbm(B, x / 230 + 4.1, z / 230 - 2.3, 2) * 13
    const w = fbm(D, x / 420, z / 420, 2)
    h += Math.sin((z + w * 160) / 95) * 1.8
    h += fbm(C, x / 55, z / 55, 2) * 0.45
    // far hills rise beyond the pond, a backdrop for the upward fall
    h += 22 * smoothstep(360, 680, z) * (0.6 + 0.4 * fbm(A, x / 300, 3.3, 2))
    return h
  }
}

// The view from the door: the door stands on the brow of a hill and the
// meadow falls away in front of it in one long concave sweep (so nothing
// hides the valley), then climbs gently to the pond terrace.
function viewProfile(z) {
  if (z < 0) return -7 * (1 - Math.exp(z / 70))
  const u = Math.max(0, z - 7)
  const soft = u * u / (u + 6)
  return -23 * (1 - Math.exp(-soft / 62)) + 8 * smoothstep(150, 270, z)
}

export function makeGround(seed = 5) {
  const nat = makeNatural(seed)
  const y0 = nat(DOOR.x, DOOR.z) + 4
  const N = makeNoise2D(seed + 99)
  return (x, z) => {
    const v = nat(x, z)
    // corridor that widens from the door toward the pond
    const cx = POND.x * Math.max(0, Math.min(1, z / POND.z))
    const width = 70 + Math.max(0, z) * 0.55
    const k = Math.exp(-(((x - cx) / width) ** 2)) * (1 - smoothstep(250, 380, z)) * smoothstep(-160, -40, z)
    const d = y0 + viewProfile(z) + fbm(N, x / 140, z / 140, 2) * 2.2 * smoothstep(20, 80, Math.abs(z))
    let h = v + (d - v) * k
    // a small level place for the door itself
    const rd = Math.hypot(x - DOOR.x, z - DOOR.z)
    h += (y0 - h) * (1 - smoothstep(5, 11, rd))
    return h
  }
}


export function buildHeights(seed = 5) {
  const { n, s, half } = HF
  const nat = makeGround(seed)
  const h = new Float32Array(n * n)
  // the pond sits in a soft hollow: flatten the ground around it to a level
  const hp = avgAround(nat, POND.x, POND.z, 22)
  const W = hp - 1.2 // water level
  const edge = nat(0, 0) - 4
  for (let j = 0; j < n; j++) {
    const z = -half + j * s
    for (let i = 0; i < n; i++) {
      const x = -half + i * s
      let v = nat(x, z)
      const r = Math.hypot(x - POND.x, z - POND.z)
      // settle the land around the pond into a shallow bowl
      const wide = Math.exp(-((r / 70) ** 2))
      v = v + (W + 0.9 + r * 0.02 - v) * wide * 0.85
      // basin: a gentle beach down to the deepest point
      const R = POND.r
      let bed
      if (r < R) bed = W - POND.depth * Math.pow(1 - (r / R) ** 2, 0.8)
      else bed = W + (r - R) * 0.075
      const k = smoothstep(R + 0.5, R + 16, r)
      const kept = Math.max(v, bed)
      v = r < R + 16 ? bed + (kept - bed) * k : kept + (v - kept) * smoothstep(R + 16, R + 40, r)
      // far edge of the grid melts into a level plain under the haze
      const m = Math.max(Math.abs(x), Math.abs(z))
      v += (edge - v) * smoothstep(880, 1010, m)
      h[j * n + i] = v
    }
  }
  return { data: h, water: W }
}

function avgAround(f, x, z, r) {
  let s = 0, c = 0
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2
    s += f(x + Math.cos(t) * r, z + Math.sin(t) * r)
    c++
  }
  return (s + f(x, z) * 4) / (c + 4)
}

// CPU twin of groundH() in the shaders
export function sampleHeight(data, x, z) {
  const { n, s, half } = HF
  let gx = (x + half) / s
  let gz = (z + half) / s
  gx = gx < 0 ? 0 : gx > n - 1 ? n - 1 : gx
  gz = gz < 0 ? 0 : gz > n - 1 ? n - 1 : gz
  const i = Math.floor(gx), j = Math.floor(gz)
  const tx = gx - i, tz = gz - j
  const i1 = Math.min(i + 1, n - 1), j1 = Math.min(j + 1, n - 1)
  const a = data[j * n + i], b = data[j * n + i1], c = data[j1 * n + i], d = data[j1 * n + i1]
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz
}
