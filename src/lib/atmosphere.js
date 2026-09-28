// Single-scattering atmosphere (Rayleigh + Mie) evaluated on the CPU once per
// world and baked into a small equirect LUT. The same numbers give the sun
// colour and the ambient, so sky, light and fog always agree.

import * as THREE from 'three'

const R_PLANET = 6371e3
const R_ATMOS = 6471e3

function raySphere(ox, oy, oz, dx, dy, dz, r) {
  const b = 2 * (dx * ox + dy * oy + dz * oz)
  const c = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - 4 * c
  if (disc < 0) return null
  const s = Math.sqrt(disc)
  return [(-b - s) / 2, (-b + s) / 2]
}

export function makeAtmosphere(opts = {}) {
  const o = {
    rayleigh: [5.5e-6, 13.0e-6, 22.4e-6],
    mie: 21e-6,
    mieAbs: [1.0, 1.0, 1.0], // tint of the aerosol (dust)
    shR: 8e3,
    shM: 1.2e3,
    g: 0.76,
    sunI: 22,
    height: 1000,
    ...opts,
  }
  const [kr, kg, kb] = o.rayleigh

  function scatter(dx, dy, dz, sx, sy, sz, steps = 16, lsteps = 8) {
    const ox = 0, oy = R_PLANET + o.height, oz = 0
    const hit = raySphere(ox, oy, oz, dx, dy, dz, R_ATMOS)
    if (!hit) return [0, 0, 0]
    let tMax = hit[1]
    const g = raySphere(ox, oy, oz, dx, dy, dz, R_PLANET)
    if (g && g[0] > 0) tMax = Math.min(tMax, g[0])
    const ds = tMax / steps
    let tr = 0, tg = 0, tb = 0, tmr = 0, tmg = 0, tmb = 0
    let odR = 0, odM = 0
    const mu = dx * sx + dy * sy + dz * sz
    const mumu = mu * mu
    const gg = o.g * o.g
    const pR = (3 / (16 * Math.PI)) * (1 + mumu)
    const pM = (3 / (8 * Math.PI)) * ((1 - gg) * (mumu + 1)) / (Math.pow(1 + gg - 2 * mu * o.g, 1.5) * (2 + gg))
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * ds
      const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t
      const h = Math.sqrt(px * px + py * py + pz * pz) - R_PLANET
      const dR = Math.exp(-h / o.shR) * ds
      const dM = Math.exp(-h / o.shM) * ds
      odR += dR
      odM += dM
      const lh = raySphere(px, py, pz, sx, sy, sz, R_ATMOS)
      const lds = lh[1] / lsteps
      let lR = 0, lM = 0
      let blocked = false
      for (let j = 0; j < lsteps; j++) {
        const lt = (j + 0.5) * lds
        const qx = px + sx * lt, qy = py + sy * lt, qz = pz + sz * lt
        const lhgt = Math.sqrt(qx * qx + qy * qy + qz * qz) - R_PLANET
        if (lhgt < 0) { blocked = true; break }
        lR += Math.exp(-lhgt / o.shR) * lds
        lM += Math.exp(-lhgt / o.shM) * lds
      }
      if (blocked) continue
      const m = o.mie
      const ar = Math.exp(-(kr * (odR + lR) + m * 1.1 * (odM + lM) / o.mieAbs[0]))
      const ag = Math.exp(-(kg * (odR + lR) + m * 1.1 * (odM + lM) / o.mieAbs[1]))
      const ab = Math.exp(-(kb * (odR + lR) + m * 1.1 * (odM + lM) / o.mieAbs[2]))
      tr += dR * ar; tg += dR * ag; tb += dR * ab
      tmr += dM * ar; tmg += dM * ag; tmb += dM * ab
    }
    const m = o.mie
    return [
      o.sunI * (pR * kr * tr + pM * m * tmr * o.mieAbs[0]),
      o.sunI * (pR * kg * tg + pM * m * tmg * o.mieAbs[1]),
      o.sunI * (pR * kb * tb + pM * m * tmb * o.mieAbs[2]),
    ]
  }

  // colour of direct sunlight reaching the ground
  function sunTransmittance(sx, sy, sz) {
    const ox = 0, oy = R_PLANET + o.height, oz = 0
    const hit = raySphere(ox, oy, oz, sx, sy, sz, R_ATMOS)
    const steps = 48
    const ds = hit[1] / steps
    let odR = 0, odM = 0
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * ds
      const px = ox + sx * t, py = oy + sy * t, pz = oz + sz * t
      const h = Math.sqrt(px * px + py * py + pz * pz) - R_PLANET
      odR += Math.exp(-h / o.shR) * ds
      odM += Math.exp(-h / o.shM) * ds
    }
    return [
      Math.exp(-(kr * odR + o.mie * 1.1 * odM / o.mieAbs[0])),
      Math.exp(-(kg * odR + o.mie * 1.1 * odM / o.mieAbs[1])),
      Math.exp(-(kb * odR + o.mie * 1.1 * odM / o.mieAbs[2])),
    ]
  }

  return { scatter, sunTransmittance, opts: o }
}

// Equirect LUT, v mapped with sqrt around the horizon for detail there.
// Must match skyUV() in glsl.js.
export function bakeSkyLUT(atmo, sun, w = 256, h = 128, below = [0.3, 0.25, 0.2]) {
  const data = new Uint16Array(w * h * 4)
  const [sx, sy, sz] = sun
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / h
    const q = (v - 0.5) * 2
    const y = Math.sign(q) * q * q
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w
      const a = (u - 0.5) * Math.PI * 2
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r
      let c
      if (y >= 0) {
        c = atmo.scatter(dx, y, dz, sx, sy, sz)
      } else {
        // below the horizon: horizon colour fading into a ground-bounce tone
        const hc = atmo.scatter(dx, 0.0, dz, sx, sy, sz)
        const k = Math.min(1, -y * 6)
        c = [hc[0] * (1 - k) + below[0] * k * hc[0], hc[1] * (1 - k) + below[1] * k * hc[1], hc[2] * (1 - k) + below[2] * k * hc[2]]
      }
      const p = (j * w + i) * 4
      data[p] = THREE.DataUtils.toHalfFloat(c[0])
      data[p + 1] = THREE.DataUtils.toHalfFloat(c[1])
      data[p + 2] = THREE.DataUtils.toHalfFloat(c[2])
      data[p + 3] = THREE.DataUtils.toHalfFloat(1)
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

// Hemispherical ambient: average sky radiance above, horizon ring.
export function skyAmbient(atmo, sun) {
  const [sx, sy, sz] = sun
  const acc = (dirs) => {
    const s = [0, 0, 0]
    for (const d of dirs) {
      const c = atmo.scatter(d[0], d[1], d[2], sx, sy, sz, 12, 6)
      s[0] += c[0]; s[1] += c[1]; s[2] += c[2]
    }
    return s.map((v) => v / dirs.length)
  }
  const up = []
  const ring = []
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    up.push([Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6])
    ring.push([Math.cos(a) * 0.98, 0.18, Math.sin(a) * 0.98])
  }
  up.push([0, 1, 0])
  return { zenith: acc(up), horizon: acc(ring) }
}
