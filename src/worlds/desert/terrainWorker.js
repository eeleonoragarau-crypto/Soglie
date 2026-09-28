import { generateGrid } from './terrainGen.js'

self.onmessage = (e) => {
  const { seed } = e.data
  const out = generateGrid(seed, (p) => self.postMessage({ type: 'progress', p }))
  const buffers = out.mips.map((m) => m.data.buffer)
  self.postMessage({ type: 'done', mips: out.mips, min: out.min, max: out.max, pans: out.pans }, buffers)
}
