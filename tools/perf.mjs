// GPU-synchronous frame timing: node tools/perf.mjs "<query>" [frames] [w] [h] [dpr]
import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [q = '', frames = 60, W = 1440, H = 900, dpr = 1] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] })
const page = await browser.newPage()
await page.setViewport({ width: +W, height: +H, deviceScaleFactor: +dpr })
await page.goto(`http://127.0.0.1:${process.env.PORT || 5213}/?shot&${q}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__soglie && window.__soglie.state === 'play', { timeout: 120000 })
if (process.env.EVAL) await page.evaluate(process.env.EVAL)
await new Promise((r) => setTimeout(r, 2500))
const r = await page.evaluate((n) => {
  const g = window.__soglie
  g.renderer.setAnimationLoop(null)
  const gl = g.renderer.getContext()
  const px = new Uint8Array(4)
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  for (let i = 0; i < 5; i++) { g.frame(); sync() }
  const ts = []
  for (let i = 0; i < n; i++) { const t0 = performance.now(); g.frame(); sync(); ts.push(performance.now() - t0) }
  ts.sort((a, b) => a - b)
  return { world: g.current.id, median: +ts[n >> 1].toFixed(2), p90: +ts[Math.floor(n * 0.9)].toFixed(2), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, portals: g.stats.portals, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], quality: g.quality.name }
}, +frames)
console.log(JSON.stringify(r))
await browser.close()
