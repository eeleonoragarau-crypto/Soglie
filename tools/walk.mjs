// node tools/walk.mjs "<query>" <waitBeforeMs> <walkMs> out-prefix [shots during walk]
import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [q, waitMs = 6000, walkMs = 3000, prefix = 'shots/walk', nShots = 3] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
const logs = []
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('Clock')) logs.push(m.type() + ': ' + m.text()) })
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message))
await page.goto(`http://127.0.0.1:${process.env.PORT || 5213}/?shot&${q}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__soglie && window.__soglie.state === 'play', { timeout: 120000 })
await new Promise((r) => setTimeout(r, +waitMs))
const st = () => page.evaluate(() => { const g = window.__soglie; return { world: g.current.id, pos: g.player.pos.toArray().map((v) => +v.toFixed(2)), yaw: +g.player.yaw.toFixed(2), inv: [...g.inventory] } })
console.log('before', JSON.stringify(await st()))
await page.keyboard.down('KeyW')
const step = +walkMs / +nShots
for (let i = 0; i < +nShots; i++) {
  await new Promise((r) => setTimeout(r, step))
  await page.screenshot({ path: `${prefix}-${i}.png` })
  console.log('t' + i, JSON.stringify(await st()))
}
await page.keyboard.up('KeyW')
await new Promise((r) => setTimeout(r, 600))
await page.screenshot({ path: `${prefix}-end.png` })
console.log('end', JSON.stringify(await st()))
for (const l of logs.filter((l) => !l.includes('404'))) console.log(l)
await browser.close()
