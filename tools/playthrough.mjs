// Automated run through the whole chain using teleports: every key, every door.
// node tools/playthrough.mjs
import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = process.env.PORT || 5213
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
const logs = []
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) logs.push(m.text()) })
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message))
await page.goto(`http://127.0.0.1:${PORT}/?shot`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__soglie && window.__soglie.state === 'play', { timeout: 120000 })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = (fn, ...a) => page.evaluate(fn, ...a)
const state = () => ev(() => { const g = window.__soglie; return { world: g.current.id, inv: [...g.inventory].join(','), used: [...g.used].join(',') } })
let n = 0
const shot = (name) => page.screenshot({ path: `shots/play-${String(n++).padStart(2, '0')}-${name}.png` })
let failures = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++ }

// stand before a door of the current world, let it open, run through it
async function throughDoor(expr, label) {
  await ev((expr) => {
    const g = window.__soglie
    const d = eval(expr)
    const p = d.group.position, nrm = d.normal
    const dist = d.h > 20 ? 40 : 9
    const x = p.x + nrm.x * dist, z = p.z + nrm.z * dist
    g.player.place(x, g.current.groundAt(x, z, p.y + 5) ?? p.y, z, d.yaw)
    g.player.pitch = 0.05
  }, expr)
  await wait(6500)
  await shot(label + '-door')
  const before = await ev(() => window.__soglie.current.id)
  await page.keyboard.down('KeyW')
  await page.keyboard.down('ShiftLeft')
  for (let i = 0; i < 60; i++) {
    await wait(250)
    if ((await ev(() => window.__soglie.current.id)) !== before) break
  }
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  await wait(1800)
  await shot(label + '-in')
  return ev(() => window.__soglie.current.id)
}

async function takeKey(keyId, label) {
  const ok = await ev((keyId) => {
    const g = window.__soglie
    const k = g.current.items.find((i) => i.id === keyId)
    if (!k) return 'no key item'
    if (k.hidden) return 'still hidden'
    const p = k.group.position
    g.player.place(p.x, g.current.groundAt(p.x, p.z, p.y) ?? p.y - 1.6, p.z + 0.5, g.player.yaw)
    return 'placed'
  }, keyId)
  await wait(2200)
  await shot(label + '-key')
  const has = await ev((k) => window.__soglie.inventory.has(k), keyId)
  check(has, `key ${keyId} (${ok})`)
}

const t0 = Date.now()
// desert
await takeKey('sea', 'desert')
check((await throughDoor('g.worlds.desert.doors.sea', 'sea')) === 'sea', 'into the sea')
// sea: the key rises from its reflection when you come close
await ev(() => { const g = window.__soglie; g.player.place(114, 0, 183, Math.atan2(-4, -3)) })
await wait(3500)
await takeKey('crystal', 'sea')
check((await throughDoor('g.current.door', 'back1')) === 'desert', 'back to the desert')
// crystal: wake three crystals, wait for the giant to open
check((await throughDoor('g.worlds.desert.doors.crystal', 'crystal')) === 'crystal', 'into the glass garden')
for (const [x, z] of [[-68, 98], [62, 128], [-42, 244]]) {
  await ev(([x, z]) => { const g = window.__soglie; g.player.place(x + 0.5, g.current.groundAt(x + 0.5, z), z + 0.5, 0) }, [x, z])
  await wait(1200)
}
check((await ev(() => window.__soglie.current.woken)) === 3, 'three crystals awake')
await ev(() => { const g = window.__soglie; g.player.place(0, g.current.groundAt(0, 120), 120, Math.PI) })
await wait(7000)
await shot('crystal-opening')
await wait(7000)
await takeKey('void', 'crystal')
check((await throughDoor('g.current.door', 'back2')) === 'desert', 'back to the desert')
// void: straight to the last platform
check((await throughDoor('g.worlds.desert.doors.void', 'void')) === 'void', 'into the abyss')
await takeKey('garden', 'void')
check((await throughDoor('g.current.door', 'back3')) === 'desert', 'back to the desert')
// garden
check((await throughDoor('g.worlds.desert.doors.garden', 'garden')) === 'garden', 'into the hanging garden')
// wade into the pond at the foot of the upward waterfall: the Seed comes down
await ev(() => { const g = window.__soglie; g.player.place(-64, g.current.groundAt(-64, 262), 262, 0) })
for (let i = 0; i < 24 && !(await ev(() => window.__soglie.inventory.has('gate'))); i++) await wait(500)
await shot('garden-seed')
check(await ev(() => window.__soglie.inventory.has('gate')), 'the Seed came down to you')
check((await throughDoor('g.current.door', 'back4')) === 'desert', 'back to the desert')
// the great gate
check((await throughDoor('g.worlds.desert.doors.gate', 'gate')) === 'origin', 'through the great gate')
await wait(26000)
await shot('origin-tree')
console.log('final', JSON.stringify(await state()), `${((Date.now() - t0) / 1000).toFixed(0)} s`)
console.log(logs.join('\n') || 'no console errors')
console.log(failures ? `${failures} FAILURES` : 'ALL PASSED')
await browser.close()
