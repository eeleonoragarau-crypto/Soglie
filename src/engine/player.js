// First-person walker. Heightfield ground supplied by the current world,
// slope physics (slow uphill, sand-surfing downhill), jump, footsteps.

import * as THREE from 'three'

const _n = new THREE.Vector3()

export class Player {
  constructor(camera) {
    this.camera = camera
    this.pos = new THREE.Vector3()
    this.vel = new THREE.Vector3()
    this.slide = new THREE.Vector2()
    this.yaw = 0
    this.pitch = 0
    this.eye = 1.68
    this.radius = 0.35
    this.onGround = true
    this.airTime = 0
    this.bob = 0
    this.stepDist = 0
    this.side = 1
    this.fov = 72
    this.roll = 0
    this.dip = 0
    this.surf = 0 // 0..1 how much we are sand-surfing
    this.sens = 0.0021
    this.invertY = false
    this.enabled = true
    this.frozen = false
    this.speedH = 0
  }

  place(x, y, z, yaw = this.yaw) {
    this.pos.set(x, y, z)
    this.vel.set(0, 0, 0)
    this.slide.set(0, 0)
    this.yaw = yaw
    this.onGround = true
  }

  update(dt, input, world, events) {
    const mouse = input.consumeMouse()
    if (this.enabled) {
      this.yaw -= mouse.x * this.sens
      this.pitch -= mouse.y * this.sens * (this.invertY ? -1 : 1)
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch))
    }

    const g = world.gravity ?? 20
    const ax = this.enabled && !this.frozen ? input.axis() : { x: 0, y: 0 }
    const run = input.down('ShiftLeft', 'ShiftRight') || (input.isTouch && Math.hypot(ax.x, ax.y) > 0.92)
    const sp = (run ? 9.2 : 4.6) * (world.speedScale ?? 1)
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
    let wx = (-sy * ax.y + cy * ax.x) * sp
    let wz = (-cy * ax.y - sy * ax.x) * sp

    const ground = world.groundAt(this.pos.x, this.pos.z, this.pos.y)
    let s = 0
    if (this.onGround && ground !== null) {
      const n = world.normalAt ? world.normalAt(this.pos.x, this.pos.z, _n) : _n.set(0, 1, 0)
      const dx = n.x, dz = n.z
      s = Math.hypot(dx, dz) // sin of slope
      if (s > 1e-3 && world.slopePhysics !== false) {
        const ux = dx / s, uz = dz / s // downhill
        const wl = Math.hypot(wx, wz)
        if (wl > 0.01) {
          const up = -(wx * ux + wz * uz) / wl // 1 = straight uphill
          if (up > 0) {
            const k = 1 - Math.min(0.62, Math.max(0, (s - 0.12) * 1.5)) * up
            wx *= k; wz *= k
          }
        }
        if (s > 0.27) {
          this.slide.x += ux * (s - 0.27) * 30 * dt
          this.slide.y += uz * (s - 0.27) * 30 * dt
        }
      }
      const fr = s > 0.27 ? 0.55 : 3.2
      this.slide.multiplyScalar(Math.exp(-dt * fr))
    } else {
      this.slide.multiplyScalar(Math.exp(-dt * 0.4))
    }
    if (this.slide.length() > 16) this.slide.setLength(16)

    const tx = wx + this.slide.x
    const tz = wz + this.slide.y
    const acc = this.onGround ? 9 : 1.6
    const k = 1 - Math.exp(-dt * acc)
    this.vel.x += (tx - this.vel.x) * k
    this.vel.z += (tz - this.vel.z) * k

    if (this.onGround && this.enabled && !this.frozen && input.hit('Space')) {
      this.vel.y = world.jump ?? 6.8
      this.onGround = false
      events.jump?.()
    }

    // integrate
    const prevY = this.pos.y
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt
    world.collide?.(this.pos, this.radius, this.vel)
    world.constrain?.(this.pos, this.vel, dt)

    const h = world.groundAt(this.pos.x, this.pos.z, this.pos.y)
    this.speedH = Math.hypot(this.vel.x, this.vel.z)
    if (this.onGround) {
      if (h === null) {
        this.onGround = false
      } else {
        const snap = 0.45 + this.speedH * dt * 1.2
        if (prevY - h > snap && this.vel.y <= 0) {
          this.onGround = false // left a brink: fly for a moment
          this.vel.y = Math.min(0, (h - prevY) / dt * 0.2)
        } else {
          this.pos.y = h
          this.vel.y = 0
        }
      }
    }
    if (!this.onGround) {
      this.vel.y -= g * dt
      this.pos.y += this.vel.y * dt
      this.airTime += dt
      if (h !== null && this.pos.y <= h && this.vel.y <= 0) {
        const impact = -this.vel.y
        this.pos.y = h
        this.vel.y = 0
        this.onGround = true
        if (this.airTime > 0.25) {
          this.dip = Math.min(0.35, impact * 0.03)
          events.land?.(impact)
        }
        this.airTime = 0
      }
    }

    // footsteps
    if (this.onGround && this.speedH > 0.6) {
      const stride = run ? 1.55 : 0.95
      this.stepDist += this.speedH * dt
      this.bob += this.speedH * dt * (Math.PI / stride)
      if (this.stepDist > stride) {
        this.stepDist -= stride
        this.side = -this.side
        const ox = Math.cos(this.yaw) * 0.13 * this.side
        const oz = -Math.sin(this.yaw) * 0.13 * this.side
        events.step?.(this.pos.x + ox, this.pos.z + oz, Math.atan2(this.vel.x, this.vel.z), this.speedH, run)
      }
    }

    // surfing: fast and downhill on a real slope
    const down = this.slide.length()
    const surfT = this.onGround ? Math.min(1, Math.max(0, (down - 3) / 7)) : this.surf * 0.98
    this.surf += (surfT - this.surf) * (1 - Math.exp(-dt * 3))

    this.updateCamera(dt, run)
  }

  updateCamera(dt, run = false) {
    const cam = this.camera
    const moving = this.onGround ? Math.min(1, this.speedH / 5) : 0
    const bobA = (run ? 0.055 : 0.035) * moving * (1 - this.surf * 0.8)
    this.dip += (0 - this.dip) * (1 - Math.exp(-dt * 6))
    const by = Math.abs(Math.sin(this.bob)) * bobA * 1.6 - bobA * 0.8
    const bx = Math.cos(this.bob) * bobA * 0.6
    const eye = this.eye - this.surf * 0.35 - this.dip
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
    cam.position.set(this.pos.x + cy * bx, this.pos.y + eye + by, this.pos.z - sy * bx)
    // strafe/turn roll + a lean while surfing
    const lateral = this.vel.x * cy - this.vel.z * sy
    const rollT = -lateral * 0.004 - this.surf * lateral * 0.012
    this.roll += (rollT - this.roll) * (1 - Math.exp(-dt * 4))
    cam.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ')
    const fovT = 72 + (run ? 4 : 0) * moving + this.surf * 12
    this.fov += (fovT - this.fov) * (1 - Math.exp(-dt * 3))
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov
      cam.updateProjectionMatrix()
    }
    cam.updateMatrixWorld()
  }

  // apply a rigid transform (portal crossing): position, heading, velocity
  teleport(matrix, yawDelta) {
    this.pos.applyMatrix4(matrix)
    const v = new THREE.Vector3(this.vel.x, 0, this.vel.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawDelta)
    this.vel.x = v.x
    this.vel.z = v.z
    const sl = new THREE.Vector3(this.slide.x, 0, this.slide.y).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawDelta)
    this.slide.set(sl.x, sl.z)
    this.yaw += yawDelta
  }
}
