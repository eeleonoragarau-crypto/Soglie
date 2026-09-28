// node tools/shot.mjs "<query>" out.png [waitMs] [w] [h]
import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const q = process.argv[2] || 'shot'
const out = process.argv[3] || 'shots/shot.png'
const wait = +(process.argv[4] || 4000)
const W = +(process.argv[5] || 1280), H = +(process.argv[6] || 720)
const gpu = process.env.SWIFT ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', ...gpu, `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
const logs = []
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message))
const t0 = Date.now()
await page.goto(`http://127.0.0.1:${process.env.PORT || 5213}/?${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => window.__soglie && window.__soglie.state !== 'loading', { timeout: 120000 }).catch(() => logs.push('TIMEOUT waiting for game'))
console.log('ready in', Date.now() - t0, 'ms')
if (process.env.EVAL) { const r = await page.evaluate(process.env.EVAL); if (r !== undefined) console.log('eval:', JSON.stringify(r)) }
await new Promise((r) => setTimeout(r, wait))
const info = await page.evaluate(() => { const g = window.__soglie; if (!g) return null; const ft = g.frameTimes; const avg = ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length); return { fps: +(1 / avg).toFixed(1), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, world: g.current?.id, pos: g.player.pos.toArray().map((v) => +v.toFixed(1)), gl: g.renderer.getContext().getParameter(g.renderer.getContext().VERSION), portals: g.stats.portals } })
console.log(JSON.stringify(info))
await page.screenshot({ path: out })
for (const l of logs.filter((l) => !l.includes('GPU stall') && !l.includes('Download the React'))) console.log(l)
await browser.close()
