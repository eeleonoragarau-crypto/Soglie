// Procedural dune field. Transverse dunes (gentle windward back, sharp brink,
// steep slip face) crossed by a weaker oblique system, domain-warped so the
// crests meander and break into barchan-like segments.

import { makeNoise2D, fbm, smoothstep, lerp } from '../../lib/noise.js'
import { GRID, WIND_ANGLE, PLACES } from './layout.js'

// One dune system: sawtooth in the wind axis with an asymmetric profile.
function duneProfile(s, brink) {
  if (s < brink) {
    const w = s / brink
    return w * w * (3 - 2 * w) * 0.9 + w * 0.1 // long convex back, rounded near the top
  }
  const l = (s - brink) / (1 - brink)
  return Math.pow(1 - l, 1.28) // slip face, concave apron at the foot
}

export function makeHeightField(seed = 7) {
  const nA = makeNoise2D(seed)
  const nB = makeNoise2D(seed + 11)
  const nC = makeNoise2D(seed + 23)
  const nD = makeNoise2D(seed + 37)
  const nE = makeNoise2D(seed + 51)
  const ca = Math.cos(WIND_ANGLE)
  const sa = Math.sin(WIND_ANGLE)
  // second system, rotated 58 degrees
  const cb = Math.cos(WIND_ANGLE + 1.01)
  const sb = Math.sin(WIND_ANGLE + 1.01)

  function raw(x, z) {
    // meander
    const wx = x + 70 * fbm(nB, x * 0.0011, z * 0.0011, 3)
    const wz = z + 70 * fbm(nC, x * 0.0011 + 5.3, z * 0.0011 - 2.9, 3)

    // main transverse system
    const u = wx * ca + wz * sa
    const v = -wx * sa + wz * ca
    const lam = 190
    const ph = u / lam + 0.42 * nA(v * 0.0021, u * 0.0006) + 0.06 * nD(v * 0.006, u * 0.0015)
    const s = ph - Math.floor(ph)
    const amp = smoothstep(-0.55, 0.7, nD(v * 0.0032 + 3.1, u * 0.0016 - 1.7))
    const main = duneProfile(s, 0.64) * (0.35 + 0.65 * amp)

    // oblique secondary dunes
    const u2 = wx * cb + wz * sb
    const v2 = -wx * sb + wz * cb
    const ph2 = u2 / 83 + 0.5 * nE(v2 * 0.004, u2 * 0.002)
    const s2 = ph2 - Math.floor(ph2)
    const amp2 = smoothstep(-0.3, 0.9, nE(v2 * 0.006 - 4.2, u2 * 0.003 + 8.1))
    const second = duneProfile(s2, 0.66) * amp2

    // large rolling base and fine hummocks
    const base = fbm(nC, x * 0.00055 + 11.0, z * 0.00055 - 4.0, 3)
    const hum = fbm(nA, x * 0.011, z * 0.011, 2)

    let h = main * 34 + second * 7.5 * (0.4 + 0.6 * main) + base * 22 + hum * 0.9
    return h
  }

  // pans: mean height around each place, then blend towards it
  const pans = Object.values(PLACES).map((p) => {
    let sum = raw(p.x, p.z)
    let n = 1
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2
      const r = p.r0 * (0.4 + 0.6 * (k % 2))
      sum += raw(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r)
      n++
    }
    return { ...p, h: sum / n + (p.lift || 0) }
  })

  function height(x, z) {
    let h = raw(x, z)
    for (const p of pans) {
      const dx = x - p.x
      const dz = z - p.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < p.r1) {
        const k = smoothstep(p.r1, p.r0, d)
        h = lerp(h, p.h, k * k * (3 - 2 * k))
      }
    }
    return h
  }

  return { height, raw, pans }
}

// Fill the full node grid and a node-aligned mip chain (3x3 tent downsample, so
// node j of mip l sits exactly on node j * 2^l of mip 0).
export function generateGrid(seed = 7, onRow) {
  const { nodes, spacing, half } = GRID
  const field = makeHeightField(seed)
  const h0 = new Float32Array(nodes * nodes)
  let min = Infinity
  let max = -Infinity
  for (let j = 0; j < nodes; j++) {
    const z = -half + j * spacing
    const row = j * nodes
    for (let i = 0; i < nodes; i++) {
      const v = field.height(-half + i * spacing, z)
      h0[row + i] = v
      if (v < min) min = v
      if (v > max) max = v
    }
    if (onRow && (j & 63) === 63) onRow((j + 1) / nodes)
  }
  const mips = [{ data: h0, width: nodes, height: nodes }]
  let prev = h0
  let n = nodes
  while (n > 1) {
    const m = n >> 1
    const out = new Float32Array(m * m)
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        const ci = i * 2
        const cj = j * 2
        let s = 0
        let w = 0
        for (let dj = -1; dj <= 1; dj++) {
          const y = Math.min(n - 1, Math.max(0, cj + dj))
          for (let di = -1; di <= 1; di++) {
            const x = Math.min(n - 1, Math.max(0, ci + di))
            const k = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1)
            s += prev[y * n + x] * k
            w += k
          }
        }
        out[j * m + i] = s / w
      }
    }
    mips.push({ data: out, width: m, height: m })
    prev = out
    n = m
  }
  return { mips, min, max, pans: field.pans }
}
