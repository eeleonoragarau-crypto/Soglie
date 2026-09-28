// The five sigils. Each world, its door and its key share one. Built as
// THREE.Shapes (unit size ~1) so they can be extruded for doors and keys and
// also exported as SVG paths for the HUD.

import * as THREE from 'three'

function ring(r0, r1, seg = 48) {
  const s = new THREE.Shape()
  s.absarc(0, 0, r1, 0, Math.PI * 2, false)
  const h = new THREE.Path()
  h.absarc(0, 0, r0, 0, Math.PI * 2, true)
  s.holes.push(h)
  return s
}
function rect(x0, y0, x1, y1) {
  const s = new THREE.Shape()
  s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.closePath()
  return s
}
function polyRing(n, r0, r1, rot = 0) {
  const s = new THREE.Shape()
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2
    i ? s.lineTo(Math.cos(a) * r1, Math.sin(a) * r1) : s.moveTo(Math.cos(a) * r1, Math.sin(a) * r1)
  }
  s.closePath()
  const h = new THREE.Path()
  for (let i = n - 1; i >= 0; i--) {
    const a = rot + (i / n) * Math.PI * 2
    i === n - 1 ? h.moveTo(Math.cos(a) * r0, Math.sin(a) * r0) : h.lineTo(Math.cos(a) * r0, Math.sin(a) * r0)
  }
  h.closePath()
  s.holes.push(h)
  return s
}
function disc(x, y, r) {
  const s = new THREE.Shape()
  s.absarc(x, y, r, 0, Math.PI * 2, false)
  return s
}
function leaf(w, h) {
  const s = new THREE.Shape()
  s.moveTo(0, -h)
  s.quadraticCurveTo(w, 0, 0, h)
  s.quadraticCurveTo(-w, 0, 0, -h)
  const hole = new THREE.Path()
  const k = 0.62
  hole.moveTo(0, h * k)
  hole.quadraticCurveTo(-w * k, 0, 0, -h * k)
  hole.quadraticCurveTo(w * k, 0, 0, h * k)
  s.holes.push(hole)
  return s
}

export const GLYPHS = {
  // amber: the sun low over the dunes
  amber: () => [ring(0.34, 0.46), rect(-0.95, -0.72, 0.95, -0.62), rect(-0.62, -0.95, 0.62, -0.87)],
  // sea: the moon, the horizon, half a reflection
  sea: () => seaGlyph(),
  // crystal: hexagon with its core
  crystal: () => [polyRing(6, 0.62, 0.78, Math.PI / 2), polyRing(6, 0.18, 0.3, Math.PI / 2)],
  // void: a ring swallowing a dot
  void: () => [ring(0.66, 0.78), ring(0.4, 0.46), disc(0, 0, 0.12)],
  // garden: a seed-leaf
  garden: () => [leaf(0.8, 0.95), rect(-0.04, -1.0, 0.04, -0.2)],
  // the great gate: an eye
  gate: () => [ring(0.22, 0.34), leafEye()],
}

function leafEye() {
  const s = new THREE.Shape()
  s.moveTo(-1, 0)
  s.quadraticCurveTo(0, 0.85, 1, 0)
  s.quadraticCurveTo(0, -0.85, -1, 0)
  const h = new THREE.Path()
  h.moveTo(-0.84, 0)
  h.quadraticCurveTo(0, -0.66, 0.84, 0)
  h.quadraticCurveTo(0, 0.66, -0.84, 0)
  s.holes.push(h)
  return s
}

function seaGlyph() {
  const m = new THREE.Shape()
  m.absarc(0, 0.34, 0.4, 0, Math.PI * 2, false)
  const mh = new THREE.Path()
  mh.absarc(0, 0.34, 0.28, 0, Math.PI * 2, true)
  m.holes.push(mh)
  const refl = new THREE.Shape()
  refl.absarc(0, -0.5, 0.28, Math.PI, Math.PI * 2, false)
  refl.lineTo(0.2, -0.5)
  refl.absarc(0, -0.5, 0.2, 0, Math.PI, true)
  refl.closePath()
  return [m, rect(-0.95, -0.12, 0.95, -0.03), refl]
}

export function glyphGeometry(name, { size = 1, depth = 0.04, bevel = 0.012 } = {}) {
  const shapes = GLYPHS[name]()
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 32,
  })
  g.scale(size, size, 1)
  return g
}

// SVG path data for the HUD (y flipped)
export function glyphSVG(name) {
  const shapes = GLYPHS[name]()
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${(-p.y).toFixed(3)}`).join('') + 'Z'
  let d = ''
  for (const s of shapes) {
    d += path(s.getPoints(32))
    for (const h of s.holes) d += path(h.getPoints(32))
  }
  return `<svg viewBox="-1.1 -1.1 2.2 2.2" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`
}
