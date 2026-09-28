// Il Giardino di Vetro: single source of truth for where things stand.
// The return door sits at the origin facing +Z; the arrival view looks down
// the valley toward the great crystal, with the low dawn sun just to its left.

export const deg = Math.PI / 180

// unit vector toward the sun: 8 degrees above the horizon, 14 degrees left of
// the arrival axis (world +X is screen-left when looking along +Z)
const SUN_EL = 8 * deg
const SUN_AZ = 30 * deg
export const SUN = [Math.cos(SUN_EL) * Math.sin(SUN_AZ), Math.sin(SUN_EL), Math.cos(SUN_EL) * Math.cos(SUN_AZ)]

// the great crystal (the key sleeps inside it)
export const HEART = { x: 0, z: 172, R: 16, H: 98, K: 1.05, taper: 0.9, keyY: 15 }

// three resonant crystals, one note each of an A major chord
export const RES = [
  { x: -68, z: 98, note: 440.0, tint: [1.0, 0.62, 0.78], name: 'rosa' },
  { x: 62, z: 128, note: 554.37, tint: [0.72, 0.62, 1.0], name: 'lilla' },
  { x: -42, z: 244, note: 659.25, tint: [1.0, 0.76, 0.5], name: 'pesca' },
]

// the valley: soft bounds around its centre
export const VALLEY = { x: 0, z: 130, soft: 470, hard: 540 }

// ---------------------------------------------------------------- ground
// Very gentle large undulations, flattened around the door. The same numbers
// drive the JS walker and the GLSL of the ground and the crystal bases.
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function saltHeight(x, z) {
  let h = Math.sin(x * 0.0113 + 1.3) * Math.sin(z * 0.0087 - 0.4) * 0.8
  h += Math.sin(x * 0.0061 - z * 0.0049 + 2.1) * 0.6
  h += Math.sin(-x * 0.0171 + z * 0.0133 + 0.5) * 0.22
  h += Math.sin(x * 0.041 + z * 0.029 + 4.0) * 0.05
  return h * sstep(14, 70, Math.hypot(x, z))
}

export const heightGLSL = /* glsl */ `
float saltH(vec2 p) {
  float h = sin(p.x * 0.0113 + 1.3) * sin(p.y * 0.0087 - 0.4) * 0.8;
  h += sin(p.x * 0.0061 - p.y * 0.0049 + 2.1) * 0.6;
  h += sin(-p.x * 0.0171 + p.y * 0.0133 + 0.5) * 0.22;
  h += sin(p.x * 0.041 + p.y * 0.029 + 4.0) * 0.05;
  return h * smoothstep(14.0, 70.0, length(p));
}
`

export function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// distance from p to the segment a-b (xz)
export function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)))
  return Math.hypot(px - ax - vx * t, pz - az - vz * t)
}
