// DOM overlay: loader, title cards, whispered lines, sigil inventory,
// compass, pause. Deliberately quiet.

import { glyphSVG } from './glyphs.js'
import { KEYS, KEY_ORDER } from '../story.js'

const $ = (s) => document.querySelector(s)
// four hairline icons, drawn here so the project has no private dependencies
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" aria-hidden="true">${d}</svg>`
const ICONS = {
  play: svg('<path d="M7 4.5v15l12-7.5z"/>'),
  volume: svg('<path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mute: svg('<path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>'),
  expand: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
}

export class Hud {
  constructor(game) {
    this.game = game
    this.loader = $('#loader')
    this.bar = $('#loader-bar')
    this.status = $('#loader-status')
    this.enter = $('#enter')
    this.msg = $('#message')
    this.card_ = $('#card')
    this.inv = $('#inventory')
    this.compass = $('#compass')
    this.pauseEl = $('#pause')
    this.hudEl = $('#hud')
    this.msgTimer = 0
    this.queue = []
    this.markers = []

    // sigil slots
    this.slots = {}
    for (const id of KEY_ORDER) {
      const k = KEYS[id]
      const el = document.createElement('div')
      el.className = 'slot'
      el.style.setProperty('--c', `rgb(${k.color.map((v) => Math.round(Math.min(1, v) * 255)).join(',')})`)
      el.innerHTML = glyphSVG(k.glyph)
      el.title = k.name
      this.inv.appendChild(el)
      this.slots[id] = el
    }

    // compass ticks
    const strip = document.createElement('div')
    strip.className = 'strip'
    const labels = { 0: 'N', 90: 'E', 180: 'S', 270: 'O' }
    for (let a = -360; a <= 720; a += 15) {
      const t = document.createElement('i')
      const aa = ((a % 360) + 360) % 360
      t.className = labels[aa] ? 'major' : aa % 45 === 0 ? 'mid' : ''
      t.style.left = `${(a / 360) * 1200}px`
      if (labels[aa]) t.dataset.l = labels[aa]
      strip.appendChild(t)
    }
    this.compass.appendChild(strip)
    this.strip = strip

    $('#pause-resume').innerHTML = ICONS.play + '<span>Riprendi</span>'
    $('#pause-resume').addEventListener('click', () => game.resume())
    const mute = $('#pause-mute')
    const setMute = () => (mute.innerHTML = (game.audio.muted ? ICONS.mute : ICONS.volume) + `<span>${game.audio.muted ? 'Audio spento' : 'Audio acceso'}</span>`)
    mute.addEventListener('click', () => { game.audio.toggleMute(); setMute() })
    setMute()
    $('#pause-full').innerHTML = ICONS.expand + '<span>Schermo intero</span>'
    $('#pause-full').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.documentElement.requestFullscreen?.()
    })
    const inv = $('#pause-invert')
    inv.addEventListener('change', () => (game.player.invertY = inv.checked))
    const sens = $('#pause-sens')
    sens.addEventListener('input', () => (game.player.sens = 0.0021 * Number(sens.value)))
    this.enter.addEventListener('click', () => game.start())
  }

  progress(p, text) {
    this.bar.style.transform = `scaleX(${Math.max(0.02, p)})`
    this.status.textContent = text ?? (p < 0.48 ? 'Il vento modella le dune' : 'La luce si posa')
  }

  ready() {
    this.progress(1)
    this.loader.classList.add('ready')
    this.status.textContent = ''
  }

  hideTitle() {
    this.loader.classList.add('gone')
    this.hudEl.classList.add('on')
    setTimeout(() => (this.loader.style.display = 'none'), 2200)
  }

  intro(lines) {
    lines.forEach((l, i) => setTimeout(() => this.say(l, 3.4), 2600 + i * 3000))
  }

  say(text, secs = 4) {
    this.queue.push({ text, secs })
    if (this.msgTimer <= 0) this.next()
  }

  next() {
    const m = this.queue.shift()
    if (!m) { this.msg.classList.remove('on'); return }
    this.msg.textContent = m.text
    this.msg.classList.remove('on')
    void this.msg.offsetWidth
    this.msg.classList.add('on')
    this.msgTimer = m.secs
  }

  card(name, sub) {
    this.card_.innerHTML = `<div class="card-sub">${sub}</div><div class="card-name">${name}</div>`
    this.card_.classList.remove('on')
    void this.card_.offsetWidth
    this.card_.classList.add('on')
  }

  gotKey(id) {
    const s = this.slots[id]
    if (!s) return
    s.classList.add('has', 'pulse')
    setTimeout(() => s.classList.remove('pulse'), 2400)
  }

  useKey(id) {
    const s = this.slots[id]
    if (!s) return
    s.classList.add('used')
  }

  credits() {
    const c = document.getElementById('credits')
    c.classList.add('on')
    setTimeout(() => c.classList.remove('on'), 16000)
  }

  showPause(on) {
    this.pauseEl.classList.toggle('on', on)
  }

  update(dt, game) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt
      if (this.msgTimer <= 0) this.next()
    }
    // compass: yaw 0 looks toward -Z = north
    const deg = ((-game.player.yaw * 180) / Math.PI) % 360
    const px = (deg / 360) * 1200
    this.strip.style.transform = `translateX(${-px}px)`
    this.updateMarkers(game)
  }

  updateMarkers(game) {
    const w = game.current
    const want = []
    for (const p of w.portals) {
      const known = p.keyId && (game.inventory.has(p.keyId) || !p.locked)
      if (known || p.id === 'desert-gate') want.push(p)
    }
    while (this.markers.length < want.length) {
      const el = document.createElement('b')
      this.compass.appendChild(el)
      this.markers.push({ el, id: null })
    }
    const cam = game.camera.position
    const yaw = game.player.yaw
    this.markers.forEach((m, i) => {
      const p = want[i]
      if (!p) { m.el.style.display = 'none'; return }
      m.el.style.display = ''
      if (m.id !== p.id) {
        m.id = p.id
        const k = KEYS[p.keyId]
        m.el.innerHTML = glyphSVG(k ? k.glyph : 'gate')
        m.el.style.setProperty('--c', `#${p.color.getHexString()}`)
      }
      const dx = p.group.position.x - cam.x
      const dz = p.group.position.z - cam.z
      // bearing relative to view direction
      let a = Math.atan2(-dx, -dz) - yaw
      a = Math.atan2(Math.sin(a), Math.cos(a))
      const x = (-a / (Math.PI * 2)) * 1200
      const inView = Math.abs(x) < 170
      m.el.style.opacity = inView ? String(Math.max(0.35, 1 - Math.abs(x) / 200)) : '0'
      m.el.style.transform = `translateX(${x}px)`
      m.el.classList.toggle('lit', !p.locked || game.inventory.has(p.keyId))
    })
  }
}
