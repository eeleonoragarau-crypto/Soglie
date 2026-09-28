// Everything beyond the path: the sky dome, the galaxy far below (a glowing
// disk plus resolved stars), the black hole, and the one-time bakes (nebula,
// and an environment map the glass reflects).

import * as THREE from 'three'
import { makeSkyDome } from '../../engine/skydome.js'
import { noise, fog } from '../../lib/glsl.js'
import { COMMON, COSMOS, GALAXY, HOLE, NEBULA_HQ } from './glsl.js'
import { BH, DISK_N, GAL, mulberry } from './layout.js'

// uniforms shared by reference by every cosmic material
export function makeCosmicUniforms(nebTex) {
  const e1 = new THREE.Vector3().crossVectors(DISK_N, new THREE.Vector3(0, 0, 1)).normalize()
  const e2 = new THREE.Vector3().crossVectors(DISK_N, e1).normalize()
  const gx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), GAL.n).normalize()
  const gz = new THREE.Vector3().crossVectors(gx, GAL.n).normalize()
  return {
    uTime: { value: 0 },
    uBH: { value: new THREE.Vector4(BH.x, BH.y, BH.z, BH.rs) },
    uBHn: { value: DISK_N.clone() },
    uBHe1: { value: e1 },
    uBHe2: { value: e2 },
    uBHR: { value: BH.R },
    uGalC: { value: GAL.c.clone() },
    uGalN: { value: GAL.n.clone() },
    uGalX: { value: gx },
    uGalZ: { value: gz },
    uGalR: { value: GAL.r },
    uGalRot: { value: 0 },
    uGalGain: { value: 0.32 },
    uNeb: { value: nebTex },
  }
}

const quadVertex = /* glsl */ `
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

function bake(renderer, target, uniforms, body) {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: quadVertex,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;
      ${body}
    `,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  quad.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(quad)
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const prev = renderer.getRenderTarget()
  renderer.setRenderTarget(target)
  renderer.render(scene, cam)
  renderer.setRenderTarget(prev)
  quad.geometry.dispose()
  mat.dispose()
}

export function makeTargets() {
  const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false, wrapS: THREE.RepeatWrapping }
  const neb = new THREE.WebGLRenderTarget(2048, 1024, opt)
  const env = new THREE.WebGLRenderTarget(1024, 512, opt)
  neb.texture.wrapS = THREE.RepeatWrapping
  env.texture.wrapS = THREE.RepeatWrapping
  return { neb, env }
}

export function bakeNebula(renderer, target) {
  bake(renderer, target, {}, /* glsl */ `
    ${noise}
    ${NEBULA_HQ}
    void main() {
      float phi = (vUv.x - 0.5) * 6.2831853;
      float lat = (vUv.y - 0.5) * 3.14159265;
      vec3 d = vec3(cos(phi) * cos(lat), sin(lat), sin(phi) * cos(lat));
      fragColor = vec4(nebulaHQ(d), 1.0);
    }
  `)
}

// what the glass reflects: the whole cosmos seen from the middle of the path,
// in the engine's sky-LUT layout (see skyUV in lib/glsl.js)
export function bakeEnv(renderer, target, U, ref) {
  bake(renderer, target, { ...U, uRef: { value: ref } }, /* glsl */ `
    uniform vec3 uRef;
    ${noise}
    ${COMMON}
    ${COSMOS}
    ${GALAXY}
    ${HOLE}
    void main() {
      float phi = (vUv.x - 0.5) * 6.2831853;
      float v = vUv.y - 0.5;
      float y = sign(v) * (2.0 * v) * (2.0 * v);
      float cy = sqrt(max(1.0 - y * y, 0.0));
      vec3 d = vec3(cos(phi) * cy, y, sin(phi) * cy);
      vec3 ld = lensDir(uRef, d);
      vec3 col = cosmos(ld, 0.006) + galaxyAt(uRef, ld);
      vec3 dir, pos; float esc, fade;
      vec4 h = traceHole(uRef, d, dir, pos, esc, fade);
      if (fade > 0.0) {
        vec3 inside = h.rgb + (esc > 0.5 ? (1.0 - h.a) * (cosmos(dir, 0.006) + galaxyAt(pos, dir)) : vec3(0.0));
        col = mix(col, inside, fade);
      }
      fragColor = vec4(col, 1.0);
    }
  `)
}

export function makeSky(env, U) {
  return makeSkyDome({
    uniforms: { ...env.uniforms, ...U },
    body: /* glsl */ `
      ${noise}
      ${fog}
      ${COMMON}
      ${COSMOS}
      vec3 skyColor(vec3 d) {
        float px = length(fwidth(d));
        return cosmos(lensDir(cameraPosition, d), px);
      }
    `,
  })
}

// ------------------------------------------------------------------ galaxy

const galaxyFrame = (U) => new THREE.Matrix4().makeBasis(U.uGalX.value, U.uGalN.value, U.uGalZ.value).setPosition(U.uGalC.value)

// the diffuse light of the galaxy: a disk whose every pixel re-aims its ray
// through the thin lens, so the galaxy bends around the hole like the sky
export function makeGalaxyDisk(env, U) {
  const geo = new THREE.CircleGeometry(GAL.r * 1.32, 160).rotateX(-Math.PI / 2)
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...env.uniforms, ...U },
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      out vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vWorld;
      out vec4 fragColor;
      ${noise}
      ${COMMON}
      ${GALAXY}
      void main() {
        vec3 o = cameraPosition;
        vec3 v = vWorld - o;
        float tp = length(v);
        vec3 rd = v / tp;
        vec3 hp = vWorld;
        vec3 c = uBH.xyz - o;
        float ts = dot(c, rd);
        if (ts > 0.0 && ts < tp) {
          vec3 perp = o + rd * ts - uBH.xyz;
          float pl = length(perp);
          float b = max(pl, uBH.w * 2.0);
          float a = (uBH.w / b) * (1.0 + ts / sqrt(b * b + ts * ts));
          vec3 d2 = normalize(rd - perp / max(pl, 1e-3) * a);
          vec3 o2 = o + rd * ts;
          float den = dot(d2, uGalN);
          float t = abs(den) > 1e-5 ? dot(uGalC - o2, uGalN) / den : -1.0;
          if (t < 0.0) discard;
          hp = o2 + d2 * t;
        }
        vec3 l = hp - uGalC;
        fragColor = vec4(galaxyGlow(vec2(dot(l, uGalX), dot(l, uGalZ))), 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.matrixAutoUpdate = false
  mesh.matrix.copy(galaxyFrame(U))
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  return mesh
}

const K = 3.6
const warp = (lr) => 0.35 * Math.sin(3.1 * lr + 1.3) + 0.12 * Math.sin(7.3 * lr + 0.4)
const lanes = (ph) => Math.pow(0.5 + 0.5 * Math.cos(2 * (ph + 0.42)), 10)

// the resolved stars of the galaxy, drawn from the same spiral as the glow
export function makeGalaxyPoints(env, U, count, pixelRatio) {
  const rnd = mulberry(1234)
  const gauss = () => {
    let u = 0, v = 0
    while (u === 0) u = rnd()
    v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 4)
  const siz = new Float32Array(count)
  const R = GAL.r
  let i = 0
  const put = (x, y, z, r, g, b, a, size) => {
    if (i >= count) return
    pos[i * 3] = x * R; pos[i * 3 + 1] = y * R; pos[i * 3 + 2] = z * R
    col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = a
    siz[i] = size
    i++
  }
  const bright = () => 0.25 + Math.pow(rnd(), 7) * 5
  while (i < count) {
    const u = rnd()
    if (u < 0.17) {
      // bulge: warm, puffy
      const r = Math.abs(gauss()) * 0.05 + Math.abs(gauss()) * 0.012
      const th = rnd() * Math.PI * 2
      const y = gauss() * 0.022 * Math.exp(-r / 0.08)
      const w = 0.85 + rnd() * 0.15
      put(Math.cos(th) * r, y, Math.sin(th) * r, 1.0, 0.72 * w + 0.06, 0.45 * w + 0.05, bright() * 0.8, 1.2 + rnd() * 0.8)
    } else if (u < 0.8) {
      // arms: two log spirals, young and blue near the ridge
      let r = -0.27 * Math.log(1 - rnd() * 0.985)
      r = Math.max(0.035, Math.min(1.25, r + 0.03))
      const arm = rnd() < 0.5 ? 0 : Math.PI
      const sp = gauss() * (0.16 + 0.22 * r)
      const lr = Math.log(r)
      const th = K * lr + warp(lr) + arm + sp
      const young = Math.exp(-sp * sp / 0.02)
      const dim = 1 - 0.8 * lanes(arm + sp)
      const y = gauss() * 0.004
      const hii = young > 0.6 && rnd() < 0.012
      if (hii) {
        // a knot of star formation
        const n = 6 + Math.floor(rnd() * 14)
        for (let k = 0; k < n; k++) {
          const rr = r + gauss() * 0.006, tt = th + gauss() * 0.01
          put(Math.cos(tt) * rr, y + gauss() * 0.002, Math.sin(tt) * rr, 1.0, 0.56, 0.68, (0.5 + rnd() * 1.3) * dim, 1.4 + rnd() * 1.4)
        }
      } else {
        const c0 = [1.0, 0.86, 0.7], c1 = [0.6, 0.72, 1.0]
        const m = young * (0.7 + 0.3 * rnd())
        put(Math.cos(th) * r, y, Math.sin(th) * r,
          c0[0] + (c1[0] - c0[0]) * m, c0[1] + (c1[1] - c0[1]) * m, c0[2] + (c1[2] - c0[2]) * m,
          bright() * dim * (0.6 + young * 0.6), 1.1 + rnd() * 1.1 + (rnd() < 0.01 ? 1.6 : 0))
      }
    } else {
      // the old disk between the arms
      const r = Math.min(1.25, -0.3 * Math.log(1 - rnd() * 0.98) + 0.02)
      const th = rnd() * Math.PI * 2
      const lr = Math.log(r)
      const ph = th - K * lr - warp(lr)
      const dim = 1 - 0.7 * lanes(ph)
      put(Math.cos(th) * r, gauss() * 0.006, Math.sin(th) * r, 1.0, 0.88, 0.74, bright() * 0.55 * dim, 1.0 + rnd() * 0.9)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aCol', new THREE.BufferAttribute(col, 4))
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.4)
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...env.uniforms, ...U, uPx: { value: pixelRatio }, uGain: { value: 1.0 } },
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${COMMON}
      uniform float uPx;
      uniform float uGain;
      in vec4 aCol;
      in float aSize;
      out vec3 vCol;
      void main() {
        vec2 xz = rot2(-uGalRot) * position.xz;
        vec3 lp = vec3(xz.x, position.y, xz.y);
        vec3 wp = (modelMatrix * vec4(lp, 1.0)).xyz;
        wp = lensPoint(wp);
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float att = clamp(1500.0 / d, 0.35, 1.6);
        gl_PointSize = aSize * uPx;
        vCol = aCol.rgb * aCol.a * att * uGain;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vCol;
      out vec4 fragColor;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float a = exp(-dot(q, q) * 3.2);
        fragColor = vec4(vCol * a, 1.0);
      }
    `,
  })
  const pts = new THREE.Points(geo, mat)
  pts.matrixAutoUpdate = false
  pts.matrix.copy(galaxyFrame(U))
  pts.frustumCulled = false
  pts.renderOrder = 2
  return pts
}

// ------------------------------------------------------------------ the hole

export function makeHole(env, U) {
  const R = BH.rs * BH.R
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...env.uniforms, ...U },
    defines: { ...env.defines },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */ `
      out vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vWorld;
      out vec4 fragColor;
      ${noise}
      ${COMMON}
      ${COSMOS}
      ${GALAXY}
      ${HOLE}
      void main() {
        vec3 rd = normalize(vWorld - cameraPosition);
        vec3 dir, pos; float esc, fade;
        vec4 h = traceHole(cameraPosition, rd, dir, pos, esc, fade);
        float px = length(fwidth(dir));
        vec3 bg = vec3(0.0);
        if (esc > 0.5) bg = cosmos(dir, px) + galaxyAt(pos, dir) * 1.3;
        vec3 col = h.rgb + (1.0 - h.a) * bg;
        fragColor = vec4(col * fade, fade);
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 4), mat)
  mesh.position.set(BH.x, BH.y, BH.z)
  mesh.frustumCulled = false
  mesh.renderOrder = 5
  return mesh
}
