// Top-down hillshade of the dune field with raymarched sun shadows.
// node tools/preview-terrain.mjs [size] [window-metres] [cx] [cz]
import { makeHeightField } from '../src/worlds/desert/terrainGen.js'
import { SUN, PLACES } from '../src/worlds/desert/layout.js'
import { writePNG } from './png.mjs'
const N = +(process.argv[2] || 700), W = +(process.argv[3] || 2400), cx = +(process.argv[4] || 0), cz = +(process.argv[5] || 0)
const f = makeHeightField(7)
const t0 = Date.now()
const px = W / N, H = new Float32Array(N * N)
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = f.height(cx - W / 2 + i * px, cz - W / 2 + j * px)
console.log('gen ms', Date.now() - t0)
let mn = Infinity, mx = -Infinity; for (const v of H) { mn = Math.min(mn, v); mx = Math.max(mx, v) }
console.log('height range', mn.toFixed(1), mx.toFixed(1))
const L = SUN, hs = Math.hypot(L[0], L[2]), tanE = L[1] / hs, dx = L[0] / hs, dz = L[2] / hs
const at = (x, z) => { const i = Math.max(0, Math.min(N - 1, Math.round(x))), j = Math.max(0, Math.min(N - 1, Math.round(z))); return H[j * N + i] }
const out = Buffer.alloc(N * N * 3)
let steepest = 0
for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
  const gx = (H[j * N + i + 1] - H[j * N + i - 1]) / (2 * px), gz = (H[(j + 1) * N + i] - H[(j - 1) * N + i]) / (2 * px)
  steepest = Math.max(steepest, Math.atan(Math.hypot(gx, gz)) * 57.3)
  let nx = -gx, ny = 1, nz = -gz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l
  let ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2])
  let sh = 1, h0 = H[j * N + i]
  for (let t = 2; t < 500 / px; t *= 1.12) { const h = at(i + dx * t, j + dz * t); const ray = h0 + t * px * tanE + 0.3; if (h > ray) { sh = 0; break } }
  const lit = ndl * sh
  const sand = [0.86, 0.58, 0.36], amb = [0.25, 0.3, 0.42]
  for (let c = 0; c < 3; c++) out[(j * N + i) * 3 + c] = Math.min(255, Math.pow(sand[c] * (lit * 1.6 + amb[c] * (0.5 + 0.5 * ny)), 1 / 2.2) * 255)
}
for (const [k, p] of Object.entries(PLACES)) { const i = Math.round((p.x - cx + W / 2) / px), j = Math.round((p.z - cz + W / 2) / px); for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const q = ((j + b) * N + i + a) * 3; if (q >= 0 && q < out.length - 2) { out[q] = 255; out[q + 1] = 30; out[q + 2] = 60 } } }
console.log('steepest slope deg', steepest.toFixed(1))
writePNG('shots/terrain.png', N, N, out)
const hist = new Array(10).fill(0)
for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const gx = (H[j * N + i + 1] - H[j * N + i - 1]) / (2 * px), gz = (H[(j + 1) * N + i] - H[(j - 1) * N + i]) / (2 * px); hist[Math.min(9, Math.floor(Math.atan(Math.hypot(gx, gz)) * 57.3 / 7))]++ }
console.log('slope hist (7deg bins):', hist.map((v) => (100 * v / (N * N)).toFixed(1) + '%').join(' '))
