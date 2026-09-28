// Desert terrain: height mips on the GPU, a camera-centred geometry clipmap,
// one baked pass (normals, sun shadow, curvature) and the sand shader.

import * as THREE from 'three'
import { GRID, SUN, WIND } from './layout.js'
import { noise, fog } from '../../lib/glsl.js'

const LEVELS = 5
const RING = 80 // half-size of each level in its own cells

export function loadHeights(onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress?.(e.data.p)
      else {
        w.terminate()
        resolve(e.data)
      }
    }
    w.onerror = reject
    w.postMessage({ seed: 7 })
  })
}

export class Terrain {
  constructor(data) {
    this.mips = data.mips
    this.h0 = data.mips[0].data
    this.pans = data.pans
    this.min = data.min
    this.max = data.max

    const tex = new THREE.DataTexture(this.h0, GRID.nodes, GRID.nodes, THREE.RedFormat, THREE.FloatType)
    tex.mipmaps = data.mips
    tex.minFilter = THREE.NearestMipmapNearestFilter
    tex.magFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
    this.heightTex = tex
  }

  // CPU twin of heightL(p, 0) in the vertex shader
  heightAt(x, z) {
    const n = GRID.nodes
    const gx = (x + GRID.half) / GRID.spacing
    const gz = (z + GRID.half) / GRID.spacing
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const tx = gx - i
    const tz = gz - j
    const m = (k) => {
      const p = 2 * n - 2
      k = Math.abs(k) % p
      return k < n ? k : p - k
    }
    const i0 = m(i), i1 = m(i + 1), j0 = m(j), j1 = m(j + 1)
    const h = this.h0
    const a = h[j0 * n + i0], b = h[j0 * n + i1], c = h[j1 * n + i0], d = h[j1 * n + i1]
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = GRID.spacing
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z)
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e)
    return out.set(-hx, 2 * e, -hz).normalize()
  }

  // one-off GPU pass: normals, soft sun shadow, curvature, into a mipmapped half-float map
  bake(renderer) {
    const n = GRID.nodes
    const rt = new THREE.WebGLRenderTarget(n, n, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.MirroredRepeatWrapping,
      wrapT: THREE.MirroredRepeatWrapping,
    })
    rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uH: { value: this.heightTex },
        uS: { value: GRID.spacing },
        uSun: { value: new THREE.Vector3(...SUN) },
      },
      vertexShader: /* glsl */ `
        in vec3 position;
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        precision highp sampler2D;
        uniform sampler2D uH;
        uniform float uS;
        uniform vec3 uSun;
        out vec4 fragColor;
        const int N = ${n};
        float H(ivec2 i) { return texelFetch(uH, clamp(i, ivec2(0), ivec2(N - 1)), 0).r; }
        float Hb(vec2 g) {
          vec2 f = floor(g); vec2 t = g - f; ivec2 i = ivec2(f);
          return mix(mix(H(i), H(i + ivec2(1, 0)), t.x), mix(H(i + ivec2(0, 1)), H(i + ivec2(1, 1)), t.x), t.y);
        }
        void main() {
          ivec2 id = ivec2(gl_FragCoord.xy);
          float h = H(id);
          float hl = H(id + ivec2(-1, 0)), hr = H(id + ivec2(1, 0));
          float hd = H(id + ivec2(0, -1)), hu = H(id + ivec2(0, 1));
          vec3 nrm = normalize(vec3(hl - hr, 2.0 * uS, hd - hu));

          // soft shadow toward the sun: minimum angular clearance along the ray
          vec2 sd = normalize(uSun.xz);
          float tanE = uSun.y / length(uSun.xz);
          float clear = 1.0;
          float t = 1.2;
          for (int k = 0; k < 72; k++) {
            vec2 g = vec2(id) + sd * (t / uS);
            float hh = Hb(g);
            float ray = h + 0.25 + t * tanE;
            clear = min(clear, (ray - hh) / t);
            t = t * 1.075 + 0.9;
            if (t > 900.0) break;
          }
          float sh = smoothstep(-0.018, 0.035, clear);

          // curvature at two radii: > 0 crest, < 0 trough
          float a1 = 0.0, a2 = 0.0;
          for (int k = 0; k < 8; k++) {
            float ang = float(k) * 0.785398;
            vec2 d = vec2(cos(ang), sin(ang));
            a1 += Hb(vec2(id) + d * 4.0);
            a2 += Hb(vec2(id) + d * 16.0);
          }
          a1 /= 8.0; a2 /= 8.0;
          float curv = (h - a1) * 0.35 + (h - a2) * 0.06;
          fragColor = vec4(nrm.x, nrm.z, sh, curv);
        }
      `,
      depthTest: false,
      depthWrite: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    quad.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(quad)
    const cam = new THREE.Camera()
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(rt)
    renderer.render(scene, cam)
    renderer.setRenderTarget(prev)
    quad.geometry.dispose()
    mat.dispose()
    this.baked = rt
    return rt.texture
  }

  buildMesh(env) {
    const geo = buildClipmapGeometry()
    const pans = this.pans.filter((p) => p.r0 >= 20 && p.lift !== 1.5).slice(0, 8)
    while (pans.length < 8) pans.push({ x: 1e5, z: 1e5, r0: 0, r1: 1 })
    this.uniforms = {
      uHeight: { value: this.heightTex },
      uBaked: { value: this.baked.texture },
      uOrigin: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(...WIND) },
      uObjShadow: { value: null },
      uObjShadowMat: { value: new THREE.Matrix4() },
      uObjShadowOn: { value: 0 },
      uPrints: { value: Array.from({ length: 40 }, () => new THREE.Vector4(1e5, 1e5, 0, 0)) },
      uPans: { value: pans.map((p) => new THREE.Vector4(p.x, p.z, p.r0, p.r1)) },
      uStorm: { value: 0 },
      ...env.uniforms,
    }
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      defines: { FOG_SKYLUT: 1 },
      vertexShader: sandVertex,
      fragmentShader: sandFragment,
    })
    this.material = mat
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    const snap = GRID.spacing * 2 ** (LEVELS - 1)
    const u = this.uniforms
    // centre on whatever camera renders it: the player, or a portal's virtual eye
    mesh.onBeforeRender = (_r, _s, camera) => {
      const p = camera.getWorldPosition(_tmp)
      u.uOrigin.value.set(Math.round(p.x / snap) * snap, Math.round(p.z / snap) * snap)
    }
    this.mesh = mesh
    return mesh
  }
}

const _tmp = new THREE.Vector3()

function buildClipmapGeometry() {
  const pos = []
  const lev = []
  const morph = []
  const idx = []
  let base = 0
  const n = RING
  for (let l = 0; l < LEVELS; l++) {
    const s = GRID.spacing * 2 ** l
    const side = 2 * n + 1
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        pos.push(i * s, 0, j * s)
        lev.push(l)
        let mx = 0, mz = 0, f = 0
        if ((Math.abs(i) === n && (j & 1)) ) { mz = s; f = 1 }
        else if ((Math.abs(j) === n && (i & 1))) { mx = s; f = 1 }
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
        // alternate the diagonal so the mesh has no directional bias
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

// Height lookups shared by every shader that needs the ground (sand, dust, shadows).
export const heightGLSL = /* glsl */ `
  const int HN = ${GRID.nodes};
  const float S0 = ${GRID.spacing.toFixed(4)};
  const float HALF = ${GRID.half.toFixed(4)};
  const float NN = ${GRID.nodes.toFixed(1)};
  int mirrorI(int i, int n) {
    int p = 2 * n - 2;
    i = abs(i) % p;
    return i < n ? i : p - i;
  }
  float fetchH(ivec2 i, int lev) {
    int n = HN >> lev;
    return texelFetch(uHeight, ivec2(mirrorI(i.x, n), mirrorI(i.y, n)), lev).r;
  }
  float heightL(vec2 p, int lev) {
    float s = S0 * float(1 << lev);
    vec2 g = (p + HALF) / s;
    vec2 f = floor(g);
    vec2 t = g - f;
    ivec2 i = ivec2(f);
    float a = fetchH(i, lev), b = fetchH(i + ivec2(1, 0), lev);
    float c = fetchH(i + ivec2(0, 1), lev), d = fetchH(i + ivec2(1, 1), lev);
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  }
  vec2 bakedUV(vec2 xz) { return ((xz + HALF) / S0 + 0.5) / NN; }
`

const sandVertex = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  uniform sampler2D uHeight;
  uniform vec2 uOrigin;
  in float aLevel;
  in vec3 aMorph;
  out vec3 vWorld;
  const float RINGN = ${RING.toFixed(1)};
  ${heightGLSL}
  float heightM(vec2 p, int lev, float m) {
    float h = heightL(p, lev);
    if (m > 0.0) h = mix(h, heightL(p, lev + 1), m);
    return h;
  }
  void main() {
    int lev = int(aLevel + 0.5);
    float s = S0 * float(1 << lev);
    float R = RINGN * s;
    vec2 lp = position.xz;
    vec2 wp = lp + uOrigin;
    float m = smoothstep(0.7 * R, 0.97 * R, max(abs(lp.x), abs(lp.y)));
    float h;
    if (aMorph.z > 0.5) h = 0.5 * (heightM(wp + aMorph.xy, lev, m) + heightM(wp - aMorph.xy, lev, m));
    else h = heightM(wp, lev, m);
    vWorld = vec3(wp.x, h, wp.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`

const sandFragment = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  uniform sampler2D uBaked;
  uniform sampler2D uObjShadow;
  uniform mat4 uObjShadowMat;
  uniform float uObjShadowOn;
  uniform float uTime;
  uniform vec2 uWind;
  uniform vec4 uPrints[40];
  uniform vec4 uPans[8];
  uniform float uStorm;
  uniform vec3 uAmbTop;
  uniform vec3 uAmbHorizon;
  uniform vec3 uAmbGround;
  in vec3 vWorld;
  out vec4 fragColor;
  const float S0 = ${GRID.spacing.toFixed(4)};
  const float HALF = ${GRID.half.toFixed(4)};
  const float NN = ${GRID.nodes.toFixed(1)};
  ${noise}
  ${fog}

  vec4 baked(vec2 xz) {
    vec2 uv = ((xz + HALF) / S0 + 0.5) / NN;
    vec4 b = texture(uBaked, uv);
    vec2 par = mod(floor(uv), 2.0);
    b.xy *= 1.0 - 2.0 * par;
    return b;
  }

  float objShadow(vec3 p) {
    if (uObjShadowOn < 0.5) return 1.0;
    vec4 sc = uObjShadowMat * vec4(p, 1.0);
    vec3 c = sc.xyz / sc.w;
    if (any(lessThan(c.xy, vec2(0.0))) || any(greaterThan(c.xy, vec2(1.0)))) return 1.0;
    float s = 0.0;
    vec2 tx = vec2(1.0 / 4096.0);
    for (int k = 0; k < 12; k++) {
      float a = float(k) * 2.39996 + 0.3;
      float r = sqrt((float(k) + 0.5) / 12.0) * 2.2;
      vec2 o = vec2(cos(a), sin(a)) * r * tx;
      float d = texture(uObjShadow, c.xy + o).r;
      s += (c.z - 0.00006 > d) ? 0.0 : 1.0;
    }
    return s / 12.0;
  }

  // footprints: shallow elongated dents with a small rim, fading with age
  vec3 prints(vec3 p, out float dark) {
    vec2 g = vec2(0.0);
    dark = 0.0;
    for (int i = 0; i < 40; i++) {
      vec4 f = uPrints[i];
      vec2 d = p.xz - f.xy;
      if (dot(d, d) > 0.36) continue;
      float c = cos(f.z), s = sin(f.z);
      vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / vec2(0.075, 0.15);
      float r2 = dot(q, q);
      float fade = f.w;
      // h = -exp(-r2*2) + 0.35*exp(-(r-1.2)^2*6)
      float e = exp(-r2 * 1.6);
      float r = sqrt(r2) + 1e-4;
      float rim = exp(-(r - 1.25) * (r - 1.25) * 5.0);
      vec2 dq = q * (3.2 * e) + q / r * (-(r - 1.25) * 10.0 * rim * 0.35);
      dq /= vec2(0.075, 0.15);
      vec2 dw = vec2(c * dq.x + s * dq.y, -s * dq.x + c * dq.y);
      g += dw * 0.03 * fade;
      dark += (e - rim * 0.35) * fade;
    }
    return vec3(g.x, dark, g.y);
  }

  void main() {
    vec3 wp = vWorld;
    vec3 toCam = cameraPosition - wp;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    vec3 L = uSunDir;

    vec4 b = baked(wp.xz);
    vec3 N = normalize(vec3(b.x, sqrt(max(1.0 - dot(b.xy, b.xy), 0.0)), b.y));
    float sl = length(N.xz);
    float shadow = b.z;
    float curv = b.w;

    // --- pans (hard cracked ground under the gates) ---
    float pan = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 pp = uPans[i];
      float d = length(wp.xz - pp.xy);
      pan = max(pan, smoothstep(pp.w * 0.75, pp.z * 0.9, d));
    }

    // --- wind ripples, two scales, faded by slope, crest and pixel footprint ---
    vec2 w = vec2(dot(wp.xz, uWind), dot(wp.xz, vec2(-uWind.y, uWind.x)));
    // ripples: ~11 cm crests, sinuous, with the odd fork; a longer swell under them
    // phase warped by about a wavelength every metre or two: sinuous crests that fork
    float warpA = vnoise(wp.xz * 0.55) * 7.0 + vnoise(wp.xz * 1.9 + 4.0) * 2.2;
    float phA = (w.x + w.y * 0.04) * 52.0 + warpA;
    float phB = (w.x * 0.9 + w.y * 0.1) * 11.0 + vnoise(wp.xz * 0.4) * 3.0;
    float aaA = 1.0 - smoothstep(0.5, 1.6, fwidth(phA));
    float aaB = 1.0 - smoothstep(0.5, 1.6, fwidth(phB));
    float dA = cos(phA + 0.55 * sin(phA)) * (1.0 + 0.55 * cos(phA));
    float dB = cos(phB + 0.3 * sin(phB)) * (1.0 + 0.3 * cos(phB));
    float rmask = smoothstep(0.58, 0.28, sl) * (1.0 - smoothstep(0.2, 0.9, curv)) * (1.0 - pan);
    float patchy = smoothstep(0.25, 0.75, vnoise(wp.xz * 0.08 + 3.0));
    float ampA = 0.0011 * aaA * rmask * (0.3 + 0.7 * patchy);
    float ampB = 0.0045 * aaB * rmask;
    vec2 grad = uWind * (dA * ampA * 52.0 + dB * ampB * 11.0);

    float pdark = 0.0;
    vec3 pr = vec3(0.0);
    if (dist < 40.0) pr = prints(wp, pdark);
    grad += pr.xz;

    vec3 Nd = normalize(N + vec3(-grad.x, 0.0, -grad.y));

    // --- albedo ---
    vec3 crest = vec3(0.9, 0.54, 0.27);
    vec3 mid = vec3(0.8, 0.42, 0.17);
    vec3 trough = vec3(0.6, 0.27, 0.1);
    float k = clamp(curv * 0.9 + 0.5, 0.0, 1.0);
    vec3 alb = mix(trough, mid, smoothstep(0.1, 0.5, k));
    alb = mix(alb, crest, smoothstep(0.55, 0.95, k));
    float big = fbm2(wp.xz * 0.004);
    alb *= 0.86 + 0.28 * big;
    // mineral streaks along the wind
    float streak = vnoise(vec2(w.x * 0.02, w.y * 0.35));
    alb = mix(alb, alb * vec3(0.78, 0.7, 0.66), smoothstep(0.62, 0.9, streak) * 0.6);
    // grain
    float grain = vnoise(wp.xz * 22.0) * (1.0 - smoothstep(4.0, 18.0, dist));
    alb *= 0.93 + 0.14 * grain;
    // ripple troughs slightly darker
    alb *= 1.0 - 0.025 * (0.5 - 0.5 * dA) * rmask * aaA;
    alb *= 1.0 - pdark * 0.2;

    // cracked clay in the pans, half buried under drifting sand
    if (pan > 0.001) {
      vec2 cp = wp.xz * 1.9;
      vec2 ip = floor(cp);
      vec2 fp = fract(cp);
      float d1 = 8.0, d2 = 8.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 r = o + hash22(ip + o) - fp;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
      float edge = sqrt(d2) - sqrt(d1);
      float crack = 1.0 - smoothstep(0.015, 0.05, edge);
      float drift = smoothstep(0.3, 0.62, fbm2(wp.xz * 0.11) + (1.0 - pan) * 0.7);
      float clayK = pan * (1.0 - drift);
      vec3 clay = vec3(0.8, 0.62, 0.45) * (0.92 + 0.14 * hash12(ip));
      clay = mix(clay, vec3(0.5, 0.34, 0.22), crack * 0.45 * (1.0 - smoothstep(8.0, 35.0, dist)));
      alb = mix(alb, clay, clayK);
      Nd = normalize(mix(Nd, N, clayK));
      pan = clayK;
    }

    // --- lighting ---
    float osh = objShadow(wp);
    float sh = min(shadow, osh);
    float ndl = dot(Nd, L);
    float diff = clamp(ndl * 1.05 + 0.05, 0.0, 1.0);
    // Journey-style contrast on the macro form
    float form = clamp(dot(N * vec3(1.0, 0.35, 1.0), L) * 3.0, 0.0, 1.0);
    diff = mix(diff, diff * form, 0.35);
    float ao = clamp(0.62 + curv * 0.35, 0.35, 1.0);
    vec3 amb = mix(uAmbHorizon, uAmbTop, Nd.y * 0.5 + 0.5) * ao;
    // light bounced off the sunlit sand around
    amb += uAmbGround * (0.35 + 0.65 * (1.0 - Nd.y)) * 0.6;
    vec3 col = alb * (uSunColor * diff * sh + amb * (0.55 + 0.45 * alb));

    vec3 H = normalize(L + V);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
    float spec = pow(max(dot(Nd, H), 0.0), 60.0);
    col += uSunColor * spec * (0.02 + 0.05 * fres) * sh;
    // backlit crests glowing at grazing angles
    float back = pow(max(dot(-V, L), 0.0), 6.0);
    float rim = pow(1.0 - clamp(dot(Nd, V), 0.0, 1.0), 3.0);
    col += uSunColor * alb * back * rim * 0.35 * sh * smoothstep(0.1, 0.6, curv + 0.3);

    // glitter: rare micro-facets catching the sun, only up close
    if (dist < 16.0) {
      vec3 cell = floor(wp * 80.0);
      vec3 rnd = hash33(cell) * 2.0 - 1.0;
      vec3 gn = normalize(Nd * 1.3 + rnd);
      float gl = smoothstep(0.9975, 0.9997, max(dot(gn, H), 0.0));
      float keep = step(0.93, hash13(cell + 7.7));
      col += uSunColor * gl * keep * 2.2 * sh * (1.0 - smoothstep(3.0, 14.0, dist)) * (1.0 - pan);
    }

    col = applyFog(col, wp);
    fragColor = vec4(col, 1.0);
  }
`
