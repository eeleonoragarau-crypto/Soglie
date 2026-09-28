// node tools/multi.mjs "<query>" prefix t1,t2,... (ms after ready)
import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [q, prefix, times] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
const logs = []
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) logs.push(m.text()) })
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message))
await page.goto(`http://127.0.0.1:${process.env.PORT || 5213}/?shot&${q}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__soglie && window.__soglie.state === 'play', { timeout: 120000 })
if (process.env.EVAL) await page.evaluate(process.env.EVAL)
let last = 0
for (const t of times.split(',').map(Number)) {
  await new Promise((r) => setTimeout(r, t - last))
  last = t
  if (process.env.EACH) await page.evaluate(process.env.EACH)
  await page.screenshot({ path: `${prefix}-${t}.png` })
}
const info = await page.evaluate(() => { const g = window.__soglie; return { world: g.current.id, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, portals: g.stats.portals } })
console.log(JSON.stringify(info))
console.log(logs.join('\n'))
await browser.close()
