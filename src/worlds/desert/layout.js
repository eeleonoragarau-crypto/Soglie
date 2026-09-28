// Single source of truth for the desert: grid, sun, wind and every place that
// matters. Shared by the terrain worker, the Node preview and the game.

export const GRID = {
  nodes: 2048, // height samples per side (power of two, for the mip chain)
  spacing: 1.2, // metres between samples = finest clipmap spacing
}
GRID.size = GRID.nodes * GRID.spacing // 2457.6 m
GRID.half = GRID.size / 2

// Late golden hour, low in the west-north-west. Unit vector toward the sun.
const el = (7.5 * Math.PI) / 180
const az = Math.atan2(-0.47, -0.88)
export const SUN = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]

// Direction the wind blows toward (xz). Crests run perpendicular to it and the
// slip faces sit on the downwind side, facing the low sun.
export const WIND_ANGLE = Math.atan2(0.34, -0.94)
export const WIND = [Math.cos(WIND_ANGLE), Math.sin(WIND_ANGLE)]

// Flat pans carved into the dune field. r0 = fully flat, r1 = back to dunes.
export const PLACES = {
  gate: { x: 0, z: 0, r0: 58, r1: 130, lift: 0 },
  spawn: { x: 46, z: 660, r0: 16, r1: 60, lift: 0 },
  key1: { x: -18, z: 548, r0: 20, r1: 55, lift: 1.5 },
  sea: { x: -160, z: 330, r0: 22, r1: 70, lift: 0.5 },
  crystal: { x: 560, z: 40, r0: 22, r1: 70, lift: 0.5 },
  void: { x: -520, z: -330, r0: 22, r1: 70, lift: 0.5 },
  garden: { x: 250, z: -560, r0: 22, r1: 70, lift: 0.5 },
}

// Ruins scattered on the way, purely scenic (and landmarks for orientation).
export const RUINS = [
  { kind: 'ring', x: -34, z: 560, yaw: 0.6, s: 1 },
  { kind: 'columns', x: -140, z: 470, yaw: 0.2, s: 1 },
  { kind: 'obelisk', x: 190, z: 380, yaw: -0.4, s: 1 },
  { kind: 'columns', x: 360, z: 180, yaw: 1.2, s: 0.9 },
  { kind: 'obelisk', x: -380, z: 60, yaw: 0.9, s: 1.2 },
  { kind: 'ring', x: 120, z: -300, yaw: -1.1, s: 1.4 },
  { kind: 'columns', x: -260, z: -160, yaw: 0.5, s: 1.1 },
  { kind: 'obelisk', x: 420, z: -330, yaw: 2.1, s: 0.8 },
  { kind: 'ring', x: 640, z: 360, yaw: 0.3, s: 1.1 },
  { kind: 'obelisk', x: -40, z: 250, yaw: 1.7, s: 0.7 },
]

export const BOUND = { soft: 820, hard: 960 }
