import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
const logs = []
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) logs.push(m.text()) })
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message))
await page.goto(`http://127.0.0.1:${process.env.PORT || 5213}/${process.argv[2] || ''}`, { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 900))
await page.screenshot({ path: 'shots/title-loading.png' })
await page.waitForFunction(() => window.__soglie && window.__soglie.state === 'ready', { timeout: 120000 })
await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: 'shots/title-ready.png' })
await page.click('#enter')
for (const t of [1500, 4000, 7000, 10500, 13000]) {
  await new Promise((r) => setTimeout(r, t - (t > 1500 ? [1500, 4000, 7000, 10500][[4000, 7000, 10500, 13000].indexOf(t)] : 0)))
  await page.screenshot({ path: `shots/intro-${t}.png` })
}
console.log(await page.evaluate(() => window.__soglie.state))
console.log(logs.join('\n'))
await browser.close()
