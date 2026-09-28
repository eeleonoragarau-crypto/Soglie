import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
const marks = []
page.on('console', (m) => { if (m.text().startsWith('[load]')) marks.push(m.text()) })
await page.evaluateOnNewDocument(() => {
  const t0 = performance.now()
  const obs = new MutationObserver(() => { const s = document.getElementById('loader-status'); if (s && s.textContent !== window.__lastS) { window.__lastS = s.textContent; console.log('[load] ' + (performance.now() - t0).toFixed(0) + 'ms ' + s.textContent) } })
  addEventListener('DOMContentLoaded', () => obs.observe(document.body, { subtree: true, childList: true, characterData: true }))
})
const t0 = Date.now()
await page.goto(`http://127.0.0.1:${process.env.PORT || 5213}/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__soglie && window.__soglie.state === 'ready', { timeout: 120000 })
console.log(marks.join('\n'))
console.log('ready', Date.now() - t0, 'ms')
await browser.close()
