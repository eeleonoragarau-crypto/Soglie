// Water in the garden: the still pond, and the waterfall that runs the wrong
// way, a luminous column climbing from the pond into the largest island,
// wrapped in droplets and mist that fall upward too.

import * as THREE from 'three'
import { gardenGLSL } from './common.js'
import { bobGLSL } from './islands.js'
import { noise, fog } from '../../lib/glsl.js'

export function makePond(env, gu, pond, water) {
  const geo = new THREE.CircleGeometry(pond.r + 3.2, 96).rotateX(-Math.PI / 2)
  geo.translate(pond.x, water, pond.z)
  const uniforms = { ...env.uniforms, ...gu, uCalm: { value: 0 } }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
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
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      uniform float uCalm;
      in vec3 vWorld;
      out vec4 fragColor;
      ${noise}
      ${fog}
      ${gardenGLSL}
      void main() {
        vec3 wp = vWorld;
        vec2 q = wp.xz - uPond.xy;
        float r = length(q) + 1e-4;
        float depth = uWaterY - groundH(wp.xz);
        // rings drawn inward, toward the foot of the rising water
        float ph = r * 2.2 + uTime * 2.6 * (1.0 - uCalm * 0.7);
        float amp = 0.05 * exp(-r * 0.09) + 0.012;
        float ring = cos(ph);
        vec2 g = (q / r) * (-sin(ph)) * amp * 2.2;
        // breeze ripples
        vec2 wq = wp.xz * 0.9 - uWind * uTime * 1.4;
        g += (vec2(vnoise(wq), vnoise(wq + 7.7)) - 0.5) * 0.08 * (0.3 + gustAt(wp.xz));
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - wp);
        vec3 R = reflect(-V, N);
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 refl = skyLUT(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
        // the column glows in its own pond
        float glowR = exp(-max(r - 2.5, 0.0) * 0.35);
        refl += vec3(0.4, 0.9, 1.0) * glowR * 0.9;
        // what is under the water: mud, stones, weed, fading with depth
        float sv = sunVis(vec3(wp.x, uWaterY, wp.z));
        vec3 bed = mix(vec3(0.06, 0.07, 0.03), vec3(0.14, 0.12, 0.07), vnoise(wp.xz * 0.6));
        vec3 lit = bed * (uSunColor * 0.6 * sv + uAmbTop);
        vec3 deep = vec3(0.004, 0.02, 0.025) + vec3(0.02, 0.1, 0.12) * glowR;
        vec3 below = mix(lit, deep, 1.0 - exp(-max(depth, 0.0) * 2.4));
        // caustics dancing on the shallow bed
        float ca = pow(abs(sin(vnoise(wp.xz * 1.3 + uTime * 0.3) * 9.0)), 12.0);
        below += uSunColor * ca * 0.04 * exp(-depth * 3.0) * sv;
        vec3 col = mix(below, refl, F);
        // foam at the foot of the column, and a wet line on the shore
        float foam = smoothstep(4.5, 2.4, r) * (0.5 + 0.5 * vnoise(vec2(atan(q.y, q.x) * 6.0, r * 2.0 - uTime * 3.0)));
        col = mix(col, vec3(0.9, 1.0, 1.0) * (uSunColor * 0.3 + uAmbTop), foam * 0.8);
        float shore = 1.0 - smoothstep(0.0, 0.06, depth);
        col = mix(col, bed * uAmbTop * 1.5, shore * 0.5);
        float sun = pow(max(dot(R, uSunDir), 0.0), 400.0) * sv;
        col += uSunColor * sun * 3.0;
        col = applyFog(col, wp);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.uniforms = uniforms
  return mesh
}

// radius of the rising column along its height (t: 0 at the pond, 1 in the rock)
function columnRadius(t) {
  const flare = Math.exp(-t * 26) * 2.2
  const top = Math.pow(Math.max(0, t - 0.82) / 0.18, 2) * 3.2
  return 2.1 - 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + flare + top
}

export function makeUpfall(env, gu, bobU, o) {
  const { x, z, y0, y1, isl } = o
  const H = y1 - y0
  const SA = 32, SH = 48
  const make = (scale, core, halo = false) => {
    const pos = [], uv = [], idx = []
    for (let j = 0; j <= SH; j++) {
      const t = j / SH
      const r = columnRadius(t) * scale
      for (let i = 0; i <= SA; i++) {
        const a = (i / SA) * Math.PI * 2
        pos.push(x + Math.cos(a) * r, y0 + t * H, z + Math.sin(a) * r)
        uv.push(i / SA, t)
      }
    }
    for (let j = 0; j < SH; j++) {
      for (let i = 0; i < SA; i++) {
        const a = j * (SA + 1) + i, b = a + 1, c = a + SA + 1, d = c + 1
        idx.push(a, c, b, b, c, d)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    const uniforms = { ...env.uniforms, ...gu, uBob: bobU, uIslI: { value: isl }, uH: { value: H }, uGlow: o.glow, uCenter: { value: new THREE.Vector2(x, z) } }
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      defines: { ...env.defines, CORE: core ? 1 : 0, HALO: halo ? 1 : 0 },
      transparent: true,
      depthWrite: false,
      blending: core ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float uIslI;
        uniform float uTime;
        out vec3 vWorld;
        out vec3 vN;
        out vec2 vUv;
        ${bobGLSL}
        void main() {
          vec3 p = position;
          // the top follows the island as it breathes
          p += bobOf(uIslI) * smoothstep(0.4, 1.0, uv.y);
          // a slow sway, as if the water hesitated on its way up
          p.x += sin(uv.y * 5.0 + uTime * 0.7) * 0.35 * sin(3.14159 * uv.y);
          p.z += cos(uv.y * 4.0 + uTime * 0.55) * 0.35 * sin(3.14159 * uv.y);
          vWorld = p;
          vN = normal;
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uAmbTop;
        uniform float uH;
        uniform float uGlow;
        uniform vec2 uCenter;
        uniform float uTime;
        in vec3 vWorld;
        in vec3 vN;
        in vec2 vUv;
        out vec4 fragColor;
        ${noise}
        ${fog}
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vec3(vWorld.x - uCenter.x, 0.0, vWorld.z - uCenter.y));
          float edge = 1.0 - abs(dot(N, V));
          float y = vUv.y * uH;
          float ang = vUv.x * 6.2831853 + y * 0.05 - uTime * 0.25;
          // streaks climbing, faster higher up
          float sp = 7.0 + y * 0.12;
          vec2 s1 = vec2(ang * 3.0, y * 0.09 - uTime * sp * 0.09);
          vec2 s2 = vec2(ang * 7.0 + 3.0, y * 0.25 - uTime * sp * 0.25);
          float st = vnoise(s1) * 0.6 + vnoise(s2) * 0.4;
          float streak = smoothstep(0.35, 0.85, st);
          float ends = smoothstep(0.0, 0.03, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
        #if HALO
          // a soft luminous air around the column, visible from far away
          float c = pow(1.0 - edge, 2.5);
          float dist = length(cameraPosition - vWorld);
          vec3 col = vec3(0.35, 0.85, 1.0) * c * uGlow * (0.05 + 0.1 * smoothstep(40.0, 300.0, dist)) * ends;
          vec3 rd;
          float f = fogFrom(vWorld, rd);
          fragColor = vec4(col * (1.0 - f * 0.7), 1.0);
        #elif CORE
          vec3 col = vec3(0.3, 0.8, 1.0) * (0.2 + 0.8 * streak) * (0.4 + 0.6 * (1.0 - edge)) * uGlow * 0.3;
          col *= ends * (0.6 + 0.4 * sin(y * 0.08 - uTime * 1.3));
          vec3 rd;
          float f = fogFrom(vWorld, rd);
          fragColor = vec4(col * (1.0 - f), 1.0);
        #else
          vec3 water = vec3(0.55, 0.85, 0.95);
          vec3 lit = water * (uSunColor * (0.25 + 0.5 * max(dot(N, uSunDir), 0.0)) + uAmbTop);
          vec3 foam = vec3(0.92, 0.97, 1.0) * (uSunColor * 0.3 + uAmbTop * 0.9);
          vec3 col = mix(lit * 0.5, foam, streak * 0.8 + edge * 0.3);
          col += vec3(0.25, 0.7, 0.9) * uGlow * 0.35 * (0.3 + streak);
          float a = (0.18 + 0.5 * streak + 0.3 * edge) * ends;
          col = applyFog(col, vWorld);
          fragColor = vec4(col, a);
        #endif
        }
      `,
    })
    const m = new THREE.Mesh(g, mat)
    m.frustumCulled = false
    m.renderOrder = core ? 12 : 11
    return m
  }
  return [make(1, false), make(0.55, true), make(3.2, true, true)]
}

// droplets and mist climbing around the column; mist sprites for falls too
export function makeSpray(env, gu, bobU, emitters, count) {
  const quad = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.setAttribute('uv', quad.getAttribute('uv'))
  const seed = new Float32Array(count * 4)
  const em = new Float32Array(count * 4)
  const em2 = new Float32Array(count * 4)
  let k = 0
  const total = emitters.reduce((a, e) => a + e.weight, 0)
  for (const e of emitters) {
    const n = Math.round((count * e.weight) / total)
    for (let i = 0; i < n && k < count; i++, k++) {
      for (let c = 0; c < 4; c++) seed[k * 4 + c] = Math.random()
      em.set([e.x, e.y, e.z, e.kind], k * 4)
      em2.set([e.h, e.r, e.isl ?? 23, e.size], k * 4)
    }
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
  geo.setAttribute('aEm', new THREE.InstancedBufferAttribute(em, 4))
  geo.setAttribute('aEm2', new THREE.InstancedBufferAttribute(em2, 4))
  geo.instanceCount = k
  const uniforms = { ...env.uniforms, ...gu, uBob: bobU }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      in vec4 aSeed;
      in vec4 aEm;  // origin xyz, kind (0 rising drop, 1 rising mist, 2 falling mist)
      in vec4 aEm2; // height, radius, island, size
      uniform float uTime;
      out vec2 vUv;
      out float vA;
      out vec3 vWorld;
      out float vKind;
      ${bobGLSL}
      void main() {
        float kind = aEm.w;
        float life = kind < 0.5 ? 5.0 + aSeed.z * 4.0 : 9.0 + aSeed.z * 6.0;
        float ph = fract(uTime / life + aSeed.w);
        float ang = aSeed.x * 6.2831853 + uTime * 0.2 * (aSeed.y - 0.5);
        vec3 p;
        float size;
        float a;
        if (kind < 0.5) {
          // droplets flung upward around the column
          float r = aEm2.y * (1.0 + aSeed.y * 1.6) + ph * 2.0;
          p = aEm.xyz + vec3(cos(ang) * r, ph * aEm2.x * (0.6 + 0.4 * aSeed.z), sin(ang) * r);
          size = aEm2.w * (0.5 + aSeed.y);
          a = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.7, 1.0, ph));
        } else if (kind < 1.5) {
          // mist climbing from the foot of the column
          float r = aEm2.y * (0.8 + aSeed.y) + ph * 5.0;
          p = aEm.xyz + vec3(cos(ang) * r, ph * aEm2.x, sin(ang) * r);
          size = aEm2.w * (0.6 + ph * 1.4) * (0.7 + 0.6 * aSeed.y);
          a = smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.5, 1.0, ph));
        } else {
          // mist unravelling from the bottom of a waterfall
          vec3 o = aEm.xyz + bobOf(aEm2.z);
          float r = aEm2.y * (0.4 + aSeed.y) + ph * 9.0;
          p = o + vec3(cos(ang) * r, -ph * aEm2.x * (0.5 + 0.5 * aSeed.z), sin(ang) * r);
          size = aEm2.w * (0.5 + ph * 1.8) * (0.7 + 0.6 * aSeed.y);
          a = smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.35, 1.0, ph));
        }
        vec3 toCam = cameraPosition - p;
        float d = length(toCam);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        vec3 up = normalize(cross(toCam, right));
        if (kind < 0.5) { up = vec3(0.0, 1.0, 0.0); size = max(size, d * 0.0035); }
        vec2 sz = kind < 0.5 ? vec2(size * 0.35, size * 3.0) : vec2(size);
        p += right * position.x * sz.x + up * position.y * sz.y;
        vUv = uv;
        vA = a * smoothstep(0.5, 3.0, d);
        vWorld = p;
        vKind = kind;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbTop;
      in vec2 vUv;
      in float vA;
      in vec3 vWorld;
      in float vKind;
      out vec4 fragColor;
      ${noise}
      ${fog}
      void main() {
        // clamp: on sub-pixel quads MSAA extrapolates the uv far outside
        vec2 q = clamp(vUv, 0.0, 1.0) * 2.0 - 1.0;
        float a;
        vec3 col;
        vec3 V = normalize(cameraPosition - vWorld);
        float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
        if (vKind < 0.5) {
          a = (1.0 - q.x * q.x) * smoothstep(1.0, 0.2, abs(q.y)) * 0.8;
          col = vec3(0.75, 0.95, 1.0) * (uSunColor * 0.3 + uAmbTop * 1.2) + vec3(0.3, 0.8, 1.0) * 0.25;
        } else {
          float n = vnoise(vUv * 3.0 + vWorld.xz * 0.05) * 0.6 + vnoise(vUv * 7.0 - vWorld.y * 0.1) * 0.4;
          a = smoothstep(1.0, 0.1, length(q)) * smoothstep(0.25, 0.75, n) * 0.16;
          col = vec3(0.95, 0.98, 1.0) * (uSunColor * (0.16 + 0.4 * back) + uAmbTop * 0.9);
          if (vKind < 1.5) col += vec3(0.1, 0.3, 0.4) * 0.4;
        }
        col = applyFog(col, vWorld);
        fragColor = vec4(col, clamp(a * vA, 0.0, 1.0));
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 13
  return mesh
}

// Waterfalls pouring off island rims: a sheet thrown outward on a parabola,
// streaming, fraying into spray and gone before it can reach the ground.
export function makeFalls(env, gu, bobU, falls) {
  const SEG = 36, ACR = 6
  const pos = [], uv = [], fa = [], idx = []
  let base = 0
  for (const f of falls) {
    const { x, y, z, ox, oz, w, len, isl } = f
    const tx = -oz, tz = ox // along the rim
    for (let j = 0; j <= SEG; j++) {
      const v = j / SEG
      const drop = len * v
      // time to fall `drop` metres, and how far it was thrown
      const tt = Math.sqrt((2 * drop) / 9.8)
      const out = 1.2 + 2.6 * tt
      const wid = w * (1 + v * 0.9)
      for (let i = 0; i <= ACR; i++) {
        const u = i / ACR - 0.5
        const bow = (u * u) * 0.8 * (0.3 + v)
        pos.push(x + ox * (out - bow) + tx * u * wid, y - drop, z + oz * (out - bow) + tz * u * wid)
        uv.push(i / ACR, v)
        fa.push(isl, len, w, f.seed)
      }
    }
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < ACR; i++) {
        const a = base + j * (ACR + 1) + i, b = a + 1, c = a + ACR + 1, d = c + 1
        idx.push(a, c, b, b, c, d)
      }
    }
    base += (SEG + 1) * (ACR + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('aFall', new THREE.Float32BufferAttribute(fa, 4))
  g.setIndex(idx)
  const uniforms = { ...env.uniforms, ...gu, uBob: bobU }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      in vec4 aFall; // island, length, width, seed
      out vec3 vWorld;
      out vec2 vUv;
      out vec4 vFall;
      ${bobGLSL}
      void main() {
        vec3 p = position + bobOf(aFall.x);
        vWorld = p;
        vUv = uv;
        vFall = aFall;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      in vec3 vWorld;
      in vec2 vUv;
      in vec4 vFall;
      uniform float uTime;
      out vec4 fragColor;
      ${noise}
      ${fog}
      void main() {
        vec2 uv = clamp(vUv, 0.0, 1.0);
        float s = uv.y * vFall.y;
        float x = (uv.x - 0.5) * vFall.z;
        // streaks accelerating as they fall
        float spd = 2.0 + sqrt(max(s, 0.0)) * 1.6;
        float a1 = vnoise(vec2(x * 2.2 + vFall.w, s * 0.12 - uTime * spd * 0.12));
        float a2 = vnoise(vec2(x * 5.5 - vFall.w, s * 0.3 - uTime * spd * 0.3));
        float st = a1 * 0.6 + a2 * 0.4;
        float edge = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x);
        // frays into spray, then is gone
        float fray = smoothstep(0.25, 1.0, uv.y);
        float body = smoothstep(0.2 + fray * 0.45, 0.6 + fray * 0.35, st);
        float a = body * edge * (1.0 - smoothstep(0.6, 1.0, uv.y)) * (0.95 - 0.35 * fray);
        a *= smoothstep(0.0, 0.02, uv.y);
        vec3 V = normalize(cameraPosition - vWorld);
        float back = pow(max(dot(-V, uSunDir), 0.0), 5.0);
        vec3 col = vec3(0.9, 0.96, 1.0) * (uSunColor * (0.32 + 0.9 * back) + uAmbTop * 1.1);
        col = mix(col * 0.75, col, st);
        col = applyFog(col, vWorld);
        fragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 10
  return mesh
}
