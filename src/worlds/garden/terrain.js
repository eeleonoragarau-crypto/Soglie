// The meadow ground: heightfield textures and a camera-centred clipmap whose
// shading is the far treatment of the grass (the same palette, the same gusts
// rolling across it) so the blades can thin out with distance unnoticed.

import * as THREE from 'three'
import { HF } from './layout.js'
import { gardenGLSL } from './common.js'
import { noise, fog } from '../../lib/glsl.js'
import { makeNoise2D, fbm } from '../../lib/noise.js'

const LEVELS = 6
const RING = 28

export function makeHeightTextures(data) {
  const n = HF.n
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true

  // smooth normals (xz) + meadow patch value, filtered
  const nd = new Uint16Array(n * n * 4)
  const P = makeNoise2D(91)
  const h = (i, j) => data[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))]
  const s = HF.s
  const hf = THREE.DataUtils.toHalfFloat
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gx = (h(i + 1, j) - h(i - 1, j)) / (2 * s)
      const gz = (h(i, j + 1) - h(i, j - 1)) / (2 * s)
      const l = Math.hypot(gx, 1, gz)
      const x = -HF.half + i * s, z = -HF.half + j * s
      const patch = 0.5 + 0.5 * fbm(P, x / 60, z / 60, 3)
      const k = (j * n + i) * 4
      nd[k] = hf(-gx / l)
      nd[k + 1] = hf(-gz / l)
      nd[k + 2] = hf(0)
      nd[k + 3] = hf(patch)
    }
  }
  const ntex = new THREE.DataTexture(nd, n, n, THREE.RGBAFormat, THREE.HalfFloatType)
  ntex.minFilter = THREE.LinearFilter
  ntex.magFilter = THREE.LinearFilter
  ntex.wrapS = ntex.wrapT = THREE.ClampToEdgeWrapping
  ntex.generateMipmaps = false
  ntex.needsUpdate = true
  return { heightTex: tex, normTex: ntex }
}

function buildClipmapGeometry() {
  const pos = []
  const lev = []
  const morph = []
  const idx = []
  let base = 0
  const n = RING
  for (let l = 0; l < LEVELS; l++) {
    const s = HF.s * 2 ** l
    const side = 2 * n + 1
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        pos.push(i * s, 0, j * s)
        lev.push(l)
        let mx = 0, mz = 0, f = 0
        if (Math.abs(i) === n && (j & 1)) { mz = s; f = 1 }
        else if (Math.abs(j) === n && (i & 1)) { mx = s; f = 1 }
        morph.push(mx, mz, f)
      }
    }
    const hole = l === 0 ? 0 : n / 2
    for (let j = -n; j < n; j++) {
      for (let i = -n; i < n; i++) {
        if (hole && i >= -hole && i < hole && j >= -hole && j < hole) continue
        const a = base + (j + n) * side + (i + n)
        const b = a + 1
        const c = a + side
        const d = c + 1
        if (((i + j) & 1) === 0) idx.push(a, c, b, b, c, d)
        else idx.push(a, c, d, a, d, b)
      }
    }
    base += side * side
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aLevel', new THREE.Float32BufferAttribute(lev, 1))
  g.setAttribute('aMorph', new THREE.Float32BufferAttribute(morph, 3))
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1))
  return g
}

const _v = new THREE.Vector3()

export function makeTerrain(env, gu) {
  const uniforms = {
    ...env.uniforms,
    ...gu,
    uOrigin: { value: new THREE.Vector2() },
    uAmbGround: env.uniforms.uAmbGround,
  }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    vertexShader: /* glsl */ `
      precision highp float;
      uniform vec2 uOrigin;
      in float aLevel;
      in vec3 aMorph;
      out vec3 vWorld;
      const float RINGN = ${RING.toFixed(1)};
      ${noise}
      ${fog}
      ${gardenGLSL}
      void main() {
        int lev = int(aLevel + 0.5);
        float s = GS * float(1 << lev);
        float R = RINGN * s;
        vec2 lp = position.xz;
        vec2 wp = lp + uOrigin;
        float h;
        if (aMorph.z > 0.5) h = 0.5 * (groundH(wp + aMorph.xy) + groundH(wp - aMorph.xy));
        else h = groundH(wp);
        vWorld = vec3(wp.x, h, wp.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      uniform vec3 uAmbGround;
      in vec3 vWorld;
      out vec4 fragColor;
      ${noise}
      ${fog}
      ${gardenGLSL}
      void main() {
        vec3 wp = vWorld;
        vec3 toCam = cameraPosition - wp;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec4 gi = groundInfo(wp.xz);
        vec3 N = normalize(gi.xyz);
        float pch = gi.w;

        // what the eye sees of the meadow here: dark under the near blades,
        // the averaged blade colour further out where the blades thin away
        float g = gustAt(wp.xz);
        float wv = waveAt(wp.xz);
        vec3 tip = grassTip(wp.xz, pch, 0.5 + 0.25 * (vnoise(wp.xz * 0.9) - 0.5));
        vec3 far = mix(tip * 0.8, tip * vec3(1.25, 1.2, 1.0) + vec3(0.03, 0.03, 0.0), g * 0.5 + wv * 0.08);
        // broad patches of darker lush grass and paler dry swathes
        float big = vnoise(wp.xz * 0.012 + 2.0) * 0.6 + vnoise(wp.xz * 0.04 - 1.0) * 0.4;
        far *= 0.62 + 0.6 * big;
        // under the blades: moss, clover, old straw and a little earth
        float u1 = vnoise(wp.xz * 3.1) * 0.6 + vnoise(wp.xz * 9.0) * 0.4;
        float u2 = vnoise(wp.xz * 0.7 + 5.0);
        vec3 under = mix(grassRoot(), tip * 0.45, 0.25 + 0.35 * u1);
        under = mix(under, vec3(0.07, 0.05, 0.025), smoothstep(0.62, 0.85, u2) * 0.6);
        under = mix(under, vec3(0.12, 0.1, 0.05), smoothstep(0.7, 0.9, u1) * 0.35);
        float cover = smoothstep(3.0, 28.0, dist);
        vec3 alb = mix(under, far, cover);

        // wildflower drifts read as soft colour from afar
        float drift = smoothstep(0.62, 0.86, vnoise(wp.xz * 0.045 + 11.0));
        float kind = vnoise(wp.xz * 0.013 - 4.0);
        vec3 fcol = kind < 0.45 ? vec3(0.9, 0.88, 0.8) : (kind < 0.62 ? vec3(0.95, 0.7, 0.1) : vec3(0.5, 0.35, 0.85));
        alb = mix(alb, fcol * 0.3, drift * 0.07 * cover * smoothstep(20.0, 60.0, dist));

        // pond shore: wet mud and short grass
        float above = wp.y - uWaterY;
        float pr = length(wp.xz - uPond.xy);
        float shore = (1.0 - smoothstep(0.0, 0.5, above)) * (1.0 - smoothstep(uPond.z + 4.0, uPond.z + 8.0, pr));
        alb = mix(alb, vec3(0.07, 0.06, 0.035), shore);

        float sv = sunVis(wp);
        float ndl = max(dot(N, uSunDir), 0.0);
        // the grass canopy scatters light: soft wrap and a little translucency
        float wrap = clamp((dot(N, uSunDir) + 0.35) / 1.35, 0.0, 1.0);
        float diff = mix(ndl, wrap, 0.6 * cover);
        float back = pow(max(dot(-V, uSunDir), 0.0), 4.0) * cover;
        vec3 amb = mix(uAmbHorizon, uAmbTop, N.y * 0.5 + 0.5);
        float ao = mix(0.55, 1.0, cover);
        // the ground right under tall grass sits in the blades' shade, dappled
        float canopy = mix(0.3 + 0.35 * smoothstep(0.45, 0.8, vnoise(wp.xz * 2.3 + uTime * 0.2)), 1.0, cover);
        vec3 col = alb * (uSunColor * diff * sv * canopy + amb * ao);
        col += alb * uSunColor * back * 0.5 * sv * vec3(1.0, 1.1, 0.5);
        // sheen of bent blades in the gusts
        col += uSunColor * vec3(0.05, 0.055, 0.02) * g * cover * sv * (0.4 + 0.6 * wrap);
        col = applyFog(col, wp);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(buildClipmapGeometry(), mat)
  mesh.frustumCulled = false
  const snap = HF.s * 2 ** (LEVELS - 1)
  mesh.onBeforeRender = (_r, _s, camera) => {
    const p = camera.getWorldPosition(_v)
    uniforms.uOrigin.value.set(Math.round(p.x / snap) * snap, Math.round(p.z / snap) * snap)
  }
  mesh.userData.uniforms = uniforms
  return mesh
}
