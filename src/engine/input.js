// Keyboard + pointer-lock mouse + a minimal twin-stick touch layer.

export class Input {
  constructor(el) {
    this.el = el
    this.keys = new Set()
    this.dx = 0
    this.dy = 0
    this.locked = false
    this.pressed = new Set() // edge-triggered this frame
    this.touch = { move: { x: 0, y: 0, id: null, ox: 0, oy: 0 }, look: { id: null, x: 0, y: 0 } }
    this.isTouch = matchMedia('(pointer: coarse)').matches
    this.stick = document.createElement('div')
    this.stick.id = 'stick'
    this.stick.innerHTML = '<i></i>'
    document.body.appendChild(this.stick)

    addEventListener('keydown', (e) => {
      if (e.repeat) return
      this.keys.add(e.code)
      this.pressed.add(e.code)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
    })
    addEventListener('keyup', (e) => this.keys.delete(e.code))
    addEventListener('blur', () => this.keys.clear())
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el
      this.onLockChange?.(this.locked)
    })
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return
      // ignore the occasional huge spike some browsers emit on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return
      this.dx += e.movementX
      this.dy += e.movementY
    })

    // touch: left half = move stick, right half = look drag
    el.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && this.touch.move.id === null) {
          Object.assign(this.touch.move, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 })
          this.stick.style.transform = `translate(${t.clientX - 60}px, ${t.clientY - 60}px)`
          this.stick.classList.add('on')
        } else if (this.touch.look.id === null) {
          Object.assign(this.touch.look, { id: t.identifier, x: t.clientX, y: t.clientY, t0: performance.now(), travel: 0 })
        }
      }
      e.preventDefault()
    }, { passive: false })
    el.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.move.id) {
          const m = this.touch.move
          m.x = Math.max(-1, Math.min(1, (t.clientX - m.ox) / 60))
          m.y = Math.max(-1, Math.min(1, (t.clientY - m.oy) / 60))
          this.stick.firstChild.style.transform = `translate(${m.x * 34}px, ${m.y * 34}px)`
        } else if (t.identifier === this.touch.look.id) {
          const l = this.touch.look
          this.dx += (t.clientX - l.x) * 2.2
          this.dy += (t.clientY - l.y) * 2.2
          l.travel += Math.abs(t.clientX - l.x) + Math.abs(t.clientY - l.y)
          l.x = t.clientX
          l.y = t.clientY
        }
      }
      e.preventDefault()
    }, { passive: false })
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.move.id) {
          Object.assign(this.touch.move, { id: null, x: 0, y: 0 })
          this.stick.classList.remove('on')
          this.stick.firstChild.style.transform = ''
        }
        if (t.identifier === this.touch.look.id) {
          // a quick tap on the right side is a jump
          const l = this.touch.look
          if (performance.now() - l.t0 < 220 && l.travel < 12) this.pressed.add('Space')
          l.id = null
        }
      }
    }
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
  }

  lock() {
    if (this.isTouch || !this.el.requestPointerLock) return
    const retry = () => {
      try { this.el.requestPointerLock()?.catch?.(() => {}) } catch {}
    }
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true })
      p?.catch?.(retry)
    } catch {
      retry()
    }
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)) }
  hit(code) { return this.pressed.has(code) }

  axis() {
    let x = 0, y = 0
    if (this.down('KeyW', 'ArrowUp')) y += 1
    if (this.down('KeyS', 'ArrowDown')) y -= 1
    if (this.down('KeyA', 'ArrowLeft')) x -= 1
    if (this.down('KeyD', 'ArrowRight')) x += 1
    if (this.touch.move.id !== null) { x += this.touch.move.x; y -= this.touch.move.y }
    const l = Math.hypot(x, y)
    if (l > 1) { x /= l; y /= l }
    return { x, y }
  }

  consumeMouse() {
    const d = { x: this.dx, y: this.dy }
    this.dx = 0
    this.dy = 0
    return d
  }

  endFrame() { this.pressed.clear() }
}
