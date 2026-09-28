import './style.css'
import * as THREE from 'three'
import { createPost } from './engine/post.js'
import { Input } from './engine/input.js'
import { Player } from './engine/player.js'
import { Hud } from './engine/hud.js'
import { AudioEngine } from './engine/audio.js'
import { Desert } from './worlds/desert/desert.js'
import { UNIVERSES } from './worlds/index.js'
import { StubWorld } from './worlds/stub.js'
import { Origin } from './worlds/origin.js'
import { KEYS, LINES } from './story.js'
import { makeKeyMaterial } from './engine/key.js'
import { glyphGeometry } from './engine/glyphs.js'

const params = new URLSearchParams(location.search)
const DEV = params.has('dev')
const SKIP = params.has('skip') || params.has('shot')

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

class Game {
  constructor() {
    this.canvas = document.getElementById('scene')
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
    this.quality = this.pickQuality()
    this.renderer.setPixelRatio(this.quality.dpr)
    this.renderer.setSize(innerWidth, innerHeight, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.info.autoReset = false

    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 7000)
    this.input = new Input(this.canvas)
    this.player = new Player(this.camera)
    this.audio = new AudioEngine(this)
    this.hud = new Hud(this)
    this.worlds = {}
    this.current = null
    this.inventory = new Set()
    this.used = new Set()
    this.time = 0
    this.clock = new THREE.Clock(false)
    this.state = 'loading' // loading | ready | intro | play | pause | cinematic
    this.frameTimes = []
    this.cinematic = null
    this.messages = []
    this.portalRT = []
    this.stats = { portals: 0 }

    addEventListener('resize', () => this.resize())
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'play') this.pause()
    }
  }

  pickQuality() {
    const q = params.get('q') || 'auto'
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const tiers = {
      low: { dpr: Math.min(dpr, 0.85), samples: 0, portal: 0.5 },
      medium: { dpr: Math.min(dpr, 1.15), samples: 2, portal: 0.75 },
      high: { dpr: Math.min(dpr, 1.5), samples: 4, portal: 1 },
    }
    const t = q === 'auto' ? 'high' : q
    return { name: t, auto: q === 'auto', ...(tiers[t] || tiers.high) }
  }

  async init() {
    const r = this.renderer
    this.post = createPost(r, new THREE.Scene(), this.camera, { samples: this.quality.samples })
    this.post.composer.autoRenderToScreen = true

    const desert = new Desert(this)
    await desert.build(r, (p) => this.hud.progress(p * 0.6))
    this.worlds.desert = desert
    await this.buildOtherWorlds()
    this.makePortalTargets()
    this.resize()

    // place the player
    const sp = desert.spawn
    this.player.place(sp.x, sp.y, sp.z, sp.yaw)
    this.player.pitch = -0.04
    const pos = params.get('pos')
    if (pos) {
      const [x, z, yaw, pitch] = pos.split(',').map(Number)
      this.player.place(x, desert.groundAt(x, z), z, isNaN(yaw) ? sp.yaw : yaw)
      if (!isNaN(pitch)) this.player.pitch = pitch
    }
    this.setWorld(desert, true)
    const w = params.get('world')
    if (w && this.worlds[w]) {
      const W = this.worlds[w]
      this.setWorld(W, true)
      this.player.place(W.spawn.x, W.spawn.y, W.spawn.z, W.spawn.yaw)
    }
    for (const k of (params.get('keys') || '').split(',').filter(Boolean)) this.inventory.add(k)
    this.player.updateCamera(0)

    // compile everything up front so the first steps do not stutter
    for (const wd of Object.values(this.worlds)) r.compile(wd.scene, this.camera)
    this.hud.ready()
    this.state = 'ready'
    this.clock.start()
    r.setAnimationLoop(() => this.frame())
    if (SKIP) this.start(true)
    window.__soglie = this
  }

  async buildOtherWorlds() {
    const d = this.worlds.desert
    const only = params.get('only')
    const names = { sea: 'Il mare trattiene il respiro', crystal: 'Il vetro cresce', void: 'Il vuoto si apre', garden: "L'erba si alza" }
    let i = 0
    for (const U of UNIVERSES) {
      this.hud.progress(0.6 + (i++ / UNIVERSES.length) * 0.35, names[U.id])
      await new Promise((r) => setTimeout(r, 0))
      let w
      try {
        if (only && only !== U.id) throw new Error('skipped (only=' + only + ')')
        w = new U.World(this)
        await w.build(this.renderer)
        if (!w.door) throw new Error('world has no return door')
      } catch (e) {
        if (!only) console.error(`[soglie] ${U.id} failed to build, using a stand-in:`, e)
        w = new StubWorld(this, U.id, U.next)
        await w.build(this.renderer)
      }
      this.worlds[U.id] = w
      d.doors[U.id].link(w.door)
    }
    this.hud.progress(0.97, 'Le porte si allineano')
    let o
    try {
      o = new Origin(this)
      await o.build(this.renderer)
    } catch (e) {
      console.error('[soglie] origin failed to build, using a stand-in:', e)
      o = new StubWorld(this, 'origin', null)
      await o.build(this.renderer)
      o.views = {}
      for (const U of UNIVERSES) o.views[U.id] = { viewInto() {} }
    }
    this.worlds.origin = o
    d.doors.gate.link(o.door)
    for (const U of UNIVERSES) o.views[U.id].viewInto(this.worlds[U.id].door)
  }

  makePortalTargets() {
    for (const rt of this.portalRT) rt.dispose()
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    const mk = (scale, samples) => new THREE.WebGLRenderTarget(Math.max(2, Math.round(size.x * scale)), Math.max(2, Math.round(size.y * scale)), {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
    })
    this.portalRT = [
      mk(this.quality.portal, this.quality.samples ? 4 : 0),
      mk(this.quality.portal * 0.5, 0),
      mk(this.quality.portal * 0.5, 0),
      mk(this.quality.portal * 0.5, 0),
    ]
  }

  resize() {
    const w = innerWidth, h = innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(this.quality.dpr)
    this.renderer.setSize(w, h, false)
    this.post?.composer.setSize(w, h, false)
    this.makePortalTargets()
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.bufferSize = size
    for (const wd of Object.values(this.worlds)) for (const p of wd.portals) p.uniforms.uRes.value.copy(size)
  }

  // ---------------------------------------------------------------- flow
  start(skipIntro = false) {
    this.audio.start()
    if (!SKIP) this.input.lock()
    if (skipIntro) {
      this.state = 'play'
      this.post.u.fade.value.w = 0
      this.hud.hideTitle()
      return
    }
    this.state = 'intro'
    this.hud.hideTitle()
    const p = this.player
    p.updateCamera(0)
    const endPos = this.camera.position.clone()
    const endQ = this.camera.quaternion.clone()
    const back = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw))
    const startPos = endPos.clone().addScaledVector(back, 70).add(new THREE.Vector3(0, 46, 0))
    const look = new THREE.Object3D()
    look.position.copy(startPos)
    look.lookAt(endPos.clone().addScaledVector(back, -260).add(new THREE.Vector3(0, 6, 0)))
    this.cinematic = { t: 0, dur: 11, startPos, endPos, startQ: look.quaternion.clone(), endQ }
    this.hud.intro(LINES.intro)
  }

  pause() {
    if (this.state !== 'play') return
    this.state = 'pause'
    this.hud.showPause(true)
    this.audio.duck(true)
  }

  resume() {
    this.hud.showPause(false)
    this.audio.duck(false)
    this.state = 'play'
    this.input.lock()
  }

  setWorld(world, silent = false) {
    const prev = this.current
    if (prev === world) return
    prev?.onLeave?.()
    this.current = world
    document.body.dataset.world = world.id
    this.post.setScene(world.scene)
    world.onEnter?.(this)
    this.audio.setWorld(world)
    const g = { exposure: 1, haze: 0, bloom: 0.7, bloomThreshold: 1.1, saturation: 1.02, contrast: 1.04, grain: 0.035, ...world.grade }
    this.gradeTarget = g
    if (silent) this.applyGrade(1)
    if (!silent && !world.visited) this.hud.card(world.name, world.subtitle)
    world.visited = true
  }

  applyGrade(k) {
    const g = this.gradeTarget
    const u = this.post.u
    u.exposure.value += (g.exposure - u.exposure.value) * k
    u.haze.value += (g.haze - u.haze.value) * k
    u.saturation.value += (g.saturation - u.saturation.value) * k
    u.contrast.value += (g.contrast - u.contrast.value) * k
    u.grain.value += (g.grain - u.grain.value) * k
    this.post.bloom.intensity += (g.bloom - this.post.bloom.intensity) * k
    const lm = this.post.bloom.luminanceMaterial
    lm.threshold += (g.bloomThreshold - lm.threshold) * k
  }

  traverse(portal) {
    const M = portal.transfer.clone()
    const yawDelta = portal.dest.yaw + Math.PI - portal.yaw
    this.player.teleport(M, yawDelta)
    this.player.updateCamera(0)
    this.audio.whoosh()
    this.setWorld(portal.dest.world)
  }

  // ---------------------------------------------------------------- keys & doors
  pickUp(item) {
    item.taken = true
    this.inventory.add(item.id)
    const start = item.group.position.clone()
    this.flights = this.flights || []
    this.flights.push({ item, t: 0, start })
    this.audio.chime(item.color)
    this.hud.gotKey(item.id)
    this.hud.say(LINES.found(item.name), 4.5)
    setTimeout(() => this.hud.say(LINES.foundAfter, 4), 4200)
  }

  checkItems(dt) {
    const w = this.current
    const pp = this.player.pos
    for (const it of w.items) {
      if (it.taken || it.hidden) continue
      const dx = it.group.position.x - pp.x
      const dz = it.group.position.z - pp.z
      const dy = it.group.position.y - (pp.y + 1.2)
      if (dx * dx + dz * dz + dy * dy * 0.3 < it.radius * it.radius) this.pickUp(it)
    }
    if (this.flights) {
      for (const f of this.flights) {
        f.t += dt
        const k = ease(Math.min(1, f.t / 1.1))
        const target = this.camera.position.clone().add(new THREE.Vector3(0, -0.4, -0.9).applyQuaternion(this.camera.quaternion))
        f.item.group.position.lerpVectors(f.start, target, k)
        f.item.key.rotation.y += dt * (4 + k * 18)
        f.item.group.scale.setScalar(1 - k * 0.85)
        if (f.item.beam) f.item.beam.material.uniforms.uAmp.value = 1 - k
        if (f.item.wide) f.item.wide.material.uniforms.uAmp.value = 1 - k
        if (f.t > 1.1) f.item.group.visible = false
      }
      this.flights = this.flights.filter((f) => f.t < 1.2)
    }
  }

  flyKeys(dt) {
    if (!this.keyFlights) return
    for (const f of this.keyFlights) {
      f.t += dt
      const k = Math.min(1, f.t / 1.5)
      const e = ease(k)
      f.m.position.lerpVectors(f.from, f.to, e)
      f.m.position.y += Math.sin(e * Math.PI) * 0.6
      f.m.rotation.set(0, f.yaw + (1 - e) * 6 + (f.t > 1.5 ? Math.min(1, (f.t - 1.5) / 0.4) * Math.PI / 2 : 0), 0)
      f.mat.uniforms.uTime.value = this.time
      f.mat.uniforms.uBright.value = 1 + Math.max(0, f.t - 1.6) * 6
      if (f.t > 2.3) f.m.scale.setScalar(Math.max(0.001, 1 - (f.t - 2.3) * 3))
      if (f.t > 2.7) { f.m.removeFromParent(); f.m.geometry.dispose(); f.mat.dispose(); f.done = true }
    }
    this.keyFlights = this.keyFlights.filter((f) => !f.done)
  }

  checkDoors(dt) {
    const w = this.current
    const eye = this.camera.position
    for (const p of w.portals) {
      const has = p.keyId && this.inventory.has(p.keyId)
      const dist = p.distanceTo(eye)
      if (p.locked) {
        // charge the inlays when you carry its key
        const want = has ? 0.35 + 0.1 * Math.sin(this.time * 3) : 0
        if (!p.unlocking) p.charge += (want - p.charge) * (1 - Math.exp(-dt * 2))
        if (has && !p.unlocking && dist < (p.h > 20 ? 60 : 14) && p.inFront(eye)) this.unlock(p)
        else if (!has && dist < 6 && p.inFront(eye) && !p.warned) {
          p.warned = true
          const k = KEYS[p.keyId]
          this.hud.say(p.keyId === 'gate' ? LINES.lockedGate : LINES.locked(k ? k.name : 'la sua chiave'), 4)
          this.audio.denied()
          setTimeout(() => (p.warned = false), 9000)
        }
      } else {
        p.charge += (1 - p.charge) * (1 - Math.exp(-dt * 1.5))
      }
      if (p.unlocking) {
        const u = p.unlocking
        u.t += dt
        p.charge = Math.min(1, u.t / 2.2)
        p.open = smooth(1.6, 4.8, u.t)
        if (u.t > 5) {
          p.unlocking = null
          p.locked = false
          p.open = 1
          if (p.dest) { p.dest.locked = false; p.dest.open = 1; p.dest.charge = 1 }
          this.onDoorOpened?.(p)
        }
      }
    }
  }

  onDoorOpened(p) {
    p.world.onDoorOpened?.(p, this)
    if (p.keyId === 'gate') this.hud.say(LINES.gate.wake, 5)
  }

  unlock(p) {
    // the key leaves your hand and turns in the lock
    const k = KEYS[p.keyId]
    if (k) {
      const mat = makeKeyMaterial(p.world.env, k.color)
      const m = new THREE.Mesh(glyphGeometry(k.glyph, { size: p.h > 20 ? 1.4 : 0.26, depth: 0.05, bevel: 0.012 }), mat)
      m.geometry.center()
      p.world.scene.add(m)
      const lock = new THREE.Vector3(0, p.h > 20 ? 12 : 1.55, 0.35).applyMatrix4(p.matrix)
      this.keyFlights = this.keyFlights || []
      this.keyFlights.push({ m, mat, t: 0, from: this.camera.position.clone().add(new THREE.Vector3(0, -0.35, -0.7).applyQuaternion(this.camera.quaternion)), to: lock, yaw: p.yaw })
    }
    p.unlocking = { t: 0 }
    this.used.add(p.keyId)
    this.hud.useKey(p.keyId)
    this.hud.say(LINES.unlocking, 3.5)
    this.audio.unlock(p)
  }

  // ---------------------------------------------------------------- loop
  frame() {
    const rawDt = Math.min(this.clock.getDelta(), 1 / 20)
    const dt = rawDt
    this.time += dt
    const t = this.time
    this.renderer.info.reset()

    const world = this.current
    const prevEye = this.camera.position.clone()

    if (this.state === 'intro' && this.cinematic) {
      const c = this.cinematic
      c.t += dt
      const k = ease(Math.min(1, c.t / c.dur))
      this.camera.position.lerpVectors(c.startPos, c.endPos, k)
      this.camera.quaternion.slerpQuaternions(c.startQ, c.endQ, ease(smooth(0.25, 1, c.t / c.dur)))
      this.camera.updateMatrixWorld()
      this.post.u.fade.value.w = 1 - smooth(0.0, 3.5, c.t)
      this.input.consumeMouse()
      if (c.t >= c.dur || (c.t > 2 && this.input.hit('Space'))) {
        this.cinematic = null
        this.state = 'play'
        this.post.u.fade.value.w = 0
        this.player.updateCamera(0)
        this.hud.say(LINES.firstHint, 5)
      }
    } else if (this.state === 'play') {
      this.player.update(dt, this.input, world, {
        step: (x, z, heading, speed, run) => {
          world.onStep(x, z, heading, speed)
          this.audio.step(world.surface, speed, run)
        },
        land: (v) => this.audio.land(world.surface, v),
        jump: () => this.audio.jump?.(),
      })
      for (const p of world.portals) {
        if (p.crossed(prevEye, this.camera.position)) {
          this.traverse(p)
          break
        }
      }
      this.checkItems(dt)
      this.checkDoors(dt)
      this.flyKeys(dt)
      if (this.input.hit('KeyM')) this.audio.toggleMute()
      if (DEV && this.input.hit('KeyP')) console.log('pos', this.player.pos.x.toFixed(1), this.player.pos.z.toFixed(1), this.player.yaw.toFixed(2))
    } else {
      this.player.updateCamera(0)
      this.input.consumeMouse()
    }
    this.applyGrade(1 - Math.exp(-dt * 1.2))

    this.current.update(dt, t, this)
    this.renderPortals(dt, t)
    this.post.u.time.value = t
    this.audio.update(dt, this)
    this.hud.update(dt, this)
    this.input.endFrame()

    this.current.beforeRender?.(this.camera)
    this.post.composer.render(dt)
    this.track(rawDt)
  }

  renderPortals(dt, t) {
    const cam = this.camera
    const world = this.current
    const cands = []
    for (const p of world.portals) {
      const l = p.local(cam.position)
      const front = l.z > 0
      const open = !p.locked || p.unlocking
      // seen from behind, an open door is just a door
      p.surface.visible = front || !open
      p.uniforms.uLive.value = 0
      if (!p.dest || !front) continue
      const d = l.length()
      const range = open ? p.liveRange : 70
      if (d > range) continue
      if (!p.onScreen(cam)) continue
      cands.push({ p, d, range })
    }
    cands.sort((a, b) => a.d - b.d)
    const max = Math.min(world.maxPortals ?? 2, cands.length)
    this.stats.portals = max
    const updated = new Set()
    for (let i = 0; i < max; i++) {
      const { p, d, range } = cands[i]
      const rt = this.portalRT[i]
      const dw = p.dest.world
      if (!updated.has(dw)) {
        dw.update(dt, t, this)
        updated.add(dw)
      }
      p.renderView(this.renderer, cam, rt, (w, vc) => w.beforeRender?.(vc))
      p.uniforms.tView.value = rt.texture
      p.uniforms.uLive.value = smooth(range, range * 0.8, d)
    }
    this.renderer.setRenderTarget(null)
  }

  track(dt) {
    this.frameTimes.push(dt)
    if (this.frameTimes.length > 120) this.frameTimes.shift()
    // keep ~60 fps: trade resolution for smoothness, slowly and with hysteresis
    if (!this.quality.auto || this.state !== 'play' || SKIP) return
    this.adaptT = (this.adaptT || 0) + dt
    if (this.adaptT < 3 || this.frameTimes.length < 120) return
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
    const max = Math.min(devicePixelRatio || 1, 1.5)
    let d = this.quality.dpr
    if (avg > 1 / 50 && d > 0.7) d = Math.max(0.7, d - 0.15)
    else if (avg < 1 / 58.5 && d < max) d = Math.min(max, d + 0.1)
    if (d !== this.quality.dpr) {
      this.quality.dpr = d
      this.adaptT = 0
      this.frameTimes.length = 0
      this.resize()
    }
  }
}

const game = new Game()
game.init().catch((e) => {
  console.error(e)
  document.getElementById('loader-status').textContent = 'Errore: ' + e.message
})
