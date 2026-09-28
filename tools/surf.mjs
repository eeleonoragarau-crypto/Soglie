import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
await page.goto(`http://127.0.0.1:5213/?shot`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__soglie && window.__soglie.state === 'play', { timeout: 120000 })
const found = await page.evaluate(() => {
  const g = window.__soglie, d = g.worlds.desert, T = d.terrain
  let best = null
  for (let x = -200; x <= 200; x += 3) for (let z = 450; z <= 750; z += 3) {
    const n = T.normalAt(x, z)
    const s = Math.hypot(n.x, n.z)
    if (s > 0.45 && s < 0.6 && (!best || T.heightAt(x, z) > best.h)) best = { x, z, h: T.heightAt(x, z), s, dx: n.x / s, dz: n.z / s }
  }
  // start a few metres uphill of it, facing downhill
  const sx = best.x - best.dx * 4, sz = best.z - best.dz * 4
  const yaw = Math.atan2(-best.dx, -best.dz)
  g.player.place(sx, T.heightAt(sx, sz), sz, yaw)
  g.player.pitch = -0.15
  return best
})
console.log('slope', JSON.stringify(found))
await page.keyboard.down('KeyW')
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 500))
  const s = await page.evaluate(() => { const p = window.__soglie.player; return { speed: +p.speedH.toFixed(1), surf: +p.surf.toFixed(2), slide: +p.slide.length().toFixed(1), fov: +p.fov.toFixed(1), ground: p.onGround } })
  console.log(i, JSON.stringify(s))
  if (i === 3) await page.screenshot({ path: 'shots/surf.png' })
}
await page.keyboard.up('KeyW')
await new Promise((r) => setTimeout(r, 1200))
// look back at the prints
await page.evaluate(() => { const p = window.__soglie.player; p.yaw += Math.PI; p.pitch = -0.55 })
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: 'shots/prints.png' })
await browser.close()
