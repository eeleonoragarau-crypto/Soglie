// The monolith: a tall slab of dark stone with a narrow door cut through it.
// Every world builds its doors with this so a linked pair lines up exactly.

import * as THREE from 'three'
import { makeStoneMaterial } from './materials.js'
import { glyphGeometry } from './glyphs.js'
import { Portal } from './portal.js'
import { fog } from '../lib/glsl.js'

export const DOOR = { w: 2.6, h: 10.5, side: 1.25, top: 2.4, depth: 1.0, sill: 1.6 }

function slabGeometry(w, h, W, H, depth, sill) {
  const s = new THREE.Shape()
  s.moveTo(-W / 2, -sill)
  s.lineTo(W / 2, -sill)
  s.lineTo(W / 2, H)
  s.lineTo(-W / 2, H)
  s.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-w / 2, 0)
  hole.lineTo(-w / 2, h)
  hole.lineTo(w / 2, h)
  hole.lineTo(w / 2, 0)
  hole.closePath()
  s.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(s, {
    depth: depth - 0.06,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 1,
  })
  g.translate(0, 0, -(depth - 0.06) / 2)
  g.computeVertexNormals()
  return g
}

function outlineGeometry(w, h, pad0, pad1, depth) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2 - pad1, -0.02)
  s.lineTo(w / 2 + pad1, -0.02)
  s.lineTo(w / 2 + pad1, h + pad1)
  s.lineTo(-w / 2 - pad1, h + pad1)
  s.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-w / 2 - pad0, -0.01)
  hole.lineTo(-w / 2 - pad0, h + pad0)
  hole.lineTo(w / 2 + pad0, h + pad0)
  hole.lineTo(w / 2 + pad0, -0.01)
  hole.closePath()
  s.holes.push(hole)
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false })
}

const inlayFragment = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uCharge;
  uniform float uTime;
  uniform float uH;
  in vec3 vLocal;
  in vec3 vWorld;
  out vec4 fragColor;
  ${fog}
  void main() {
    // light climbs the frame as the door charges
    float climb = smoothstep(uCharge * (uH + 3.0) - 1.0, uCharge * (uH + 3.0), vLocal.y);
    float lit = 1.0 - climb;
    float pulse = 0.85 + 0.15 * sin(uTime * 2.0 - vLocal.y * 0.8);
    vec3 col = uColor * (0.12 + lit * 5.0 * pulse);
    col = applyFog(col, vWorld);
    fragColor = vec4(col, 1.0);
  }
`

// Build door + portal and register colliders on the world.
export function addDoor(world, o) {
  const { w, h, side, top, depth, sill } = { ...DOOR, ...(o.size || {}) }
  const W = w + side * 2
  const H = h + top
  const env = world.env
  const portal = new Portal(world, { ...o, width: w, height: h })
  const g = portal.group

  const stone = o.stone || makeStoneMaterial(env, {
    color: [0.03, 0.026, 0.024],
    color2: [0.065, 0.05, 0.042],
    rough: 0.42,
    bump: 0.22,
    scale: 0.9,
    spec: 1.0,
    sandLine: o.sandDust ?? 0,
  })
  const slab = new THREE.Mesh(slabGeometry(w, h, W, H, depth, sill), stone)
  slab.layers.enable(1) // shadow caster
  g.add(slab)

  const inlayU = {
    ...env.uniforms,
    uColor: { value: portal.color },
    uCharge: portal.uniforms.uCharge,
    uTime: portal.uniforms.uTime,
    uH: { value: h },
  }
  const inlayMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: inlayU,
    defines: { ...env.defines },
    vertexShader: /* glsl */ `
      out vec3 vLocal;
      out vec3 vWorld;
      void main() {
        vLocal = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: inlayFragment,
  })
  const frontZ = (depth - 0.06) / 2 + 0.03 + 0.006
  const outline = new THREE.Mesh(outlineGeometry(w, h, 0.07, 0.13, 0.015), inlayMat)
  outline.position.z = frontZ
  g.add(outline)
  // thin light strips on the inner jambs
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.01, h, 0.04), inlayMat)
    strip.position.set(sx * (w / 2 - 0.004), h / 2, 0.3)
    g.add(strip)
  }
  const glyph = new THREE.Mesh(glyphGeometry(o.glyph || 'amber', { size: Math.min(top * 0.28, side * 0.9), depth: 0.03, bevel: 0.008 }), inlayMat)
  glyph.position.set(0, h + top * 0.5, frontZ)
  g.add(glyph)
  // the same sigil, dim, on the back
  const glyphB = glyph.clone()
  glyphB.rotation.y = Math.PI
  glyphB.position.z = -frontZ
  g.add(glyphB)

  world.scene.add(g)
  world.portals.push(portal)

  // colliders: two jambs, plus a pane across the opening while locked
  const c = Math.cos(portal.yaw), s = Math.sin(portal.yaw)
  const toWorld = (lx, lz) => [o.x + c * lx + s * lz, o.z - s * lx + c * lz]
  for (const sx of [-1, 1]) {
    const [x, z] = toWorld(sx * (w / 2 + side / 2), 0)
    world.colliders.push({ type: 'box', x, z, c, s, hx: side / 2, hz: depth / 2, y0: o.y - 2, y1: o.y + H })
  }
  const [px, pz] = toWorld(0, -0.05)
  portal.pane = { type: 'box', x: px, z: pz, c, s, hx: w / 2, hz: 0.12, y0: o.y - 2, y1: o.y + h, enabled: () => portal.locked }
  world.colliders.push(portal.pane)

  portal.frame = { slab, outline, glyph, inlayMat, W, H }
  return portal
}
