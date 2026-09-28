// Tall meadow grass, entirely on the GPU. Three nested camera-centred fields
// of world-locked blades (dense at your feet, sparser and broader further
// out, each ring dithered into the next), bent by the breeze with a
// length-preserving curl, parted around whoever is looking at them.

import * as THREE from 'three'
import { gardenGLSL } from './common.js'
import { noise, fog } from '../../lib/glsl.js'

// segs: segments along the blade; box: wrap size; rIn/rOut: the ring this layer covers
export const GRASS_LAYERS = [
  { count: 26000, segs: 3, box: 25, rIn: 0, rOut: 11.5, width: 0.016, band: 2.0 },
  { count: 26000, segs: 2, box: 66, rIn: 9.5, rOut: 31, width: 0.04, band: 3.0 },
  { count: 22000, segs: 1, box: 152, rIn: 27, rOut: 74, width: 0.16, band: 6.0 },
]

function bladeGeometry(segs, count) {
  const pos = []
  const idx = []
  for (let s = 0; s < segs; s++) {
    const v = s / segs
    pos.push(-1, v, 0, 1, v, 0)
  }
  pos.push(0, 1, 0)
  for (let s = 0; s < segs - 1; s++) {
    const a = s * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const a = (segs - 1) * 2
  idx.push(a, a + 1, a + 2)
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count * 4; i++) seed[i] = Math.random()
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
  geo.instanceCount = count
  return geo
}

const vertex = /* glsl */ `
  precision highp float;
  uniform float uBox;
  uniform float uRIn;
  uniform float uROut;
  uniform float uBand;
  uniform float uWidth;
  uniform float uFar;
  in vec4 aSeed;
  out vec3 vWorld;
  out vec3 vN;
  out vec3 vCol;
  out float vV;
  out float vSun;
  out float vGust;
  out float vThin;
  ${noise}
  ${fog}
  ${gardenGLSL}
  void cull() { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); }
  void main() {
    vec2 c = cameraPosition.xz;
    vec2 p = c + mod(aSeed.xy * uBox - c + 0.5 * uBox, uBox) - 0.5 * uBox;
    float r = distance(p, c);
    float rj = r + (aSeed.z - 0.5) * uBand;
    if (rj < uRIn || rj > uROut) { cull(); return; }
    float ground = groundH(p);
    float wet = ground - uWaterY;
    float pr = length(p - uPond.xy);
    float reed = (1.0 - smoothstep(0.1, 0.45, wet)) * (1.0 - smoothstep(uPond.z + 2.0, uPond.z + 5.0, pr));
    if (wet < -0.32 && pr < uPond.z + 3.0) { cull(); return; }

    // quick frustum rejection before any of the expensive work
    vec4 cp = projectionMatrix * viewMatrix * vec4(p.x, ground + 0.5, p.y, 1.0);
    if (cp.w < -1.5 || abs(cp.x) > cp.w + 2.0 || cp.y > cp.w + 2.0 || cp.y < -cp.w - 3.0) { cull(); return; }

    vec4 gi = groundInfo(p);
    float pch = gi.w;
    float h1 = hash12(p * 7.13 + aSeed.w * 13.0);
    float h2 = hash12(p * 3.71 - 5.0);
    // patches of tall and short grass
    float tall = smoothstep(0.25, 0.75, vnoise(p * 0.07 + 3.0)) * 0.7 + smoothstep(0.3, 0.8, pch) * 0.3;
    float H = mix(0.4, 1.15, tall) * (0.55 + 0.9 * aSeed.w * aSeed.w);
    // one blade in eight is a flowering stem: thin, tall, with a seed head
    float stem = step(0.91, h2);
    H *= 1.0 + stem * 0.35;
    // a clearing of short grass around the door
    float dd = length(p - DOORXZ);
    H *= mix(0.3 + 0.2 * h1, 1.0, smoothstep(7.0, 21.0, dd + (h2 - 0.5) * 5.0));
    H = mix(H, 1.35 + 0.8 * h1, reed);
    // fade in and out at the ring edges by shrinking
    float edgeIn = smoothstep(uRIn, uRIn + uBand, rj);
    float edgeOut = 1.0 - smoothstep(uROut - uBand * 1.2, uROut, rj);
    if (uRIn <= 0.0) edgeIn = 1.0;
    H *= edgeIn * edgeOut;

    // the breeze
    float g = gustAt(p);
    float wv = waveAt(p);
    float sway = sin(uTime * (1.6 + aSeed.w * 1.3) + aSeed.x * 40.0 + dot(p, uWind) * 0.35);
    float yaw = aSeed.z * 6.2831853 + h2 * 3.0;
    vec2 lean = vec2(cos(yaw * 1.7 + 1.0), sin(yaw * 1.7 + 1.0)) * (0.12 + 0.35 * h2);
    vec2 bend = uWind * (0.12 + 0.62 * g + 0.14 * wv) + vec2(-uWind.y, uWind.x) * sway * (0.05 + 0.08 * g) + lean;
    bend *= mix(1.0, 0.35, reed);
    // part around whoever stands here (the eye, a portal's eye too)
    vec2 away = p - cameraPosition.xz;
    float da = length(away);
    float feet = (1.0 - smoothstep(0.25, 1.2, da)) * (1.0 - smoothstep(2.2, 3.4, cameraPosition.y - ground));
    bend += away / max(da, 1e-3) * feet * 1.1;
    float a = clamp(length(bend) * 1.35, 0.02, 1.9);
    vec2 bd = normalize(bend + 1e-5);

    // constant-curvature curl: the blade keeps its length as it bends
    float v = position.y;
    float av = a * v;
    vec3 root = vec3(p.x, ground - 0.03, p.y);
    vec3 P = root + vec3(bd.x, 0.0, bd.y) * H * (1.0 - cos(av)) / a + vec3(0.0, H * sin(av) / a, 0.0);
    vec3 T = normalize(vec3(bd.x * sin(av), cos(av), bd.y * sin(av)));
    vec2 wd2 = vec2(cos(yaw), sin(yaw));
    vec3 W = vec3(wd2.x, 0.0, wd2.y);
    W = normalize(W - T * dot(W, T));
    // a little wider when seen edge-on, and wider far away
    vec3 toC = normalize(cameraPosition - P);
    vec3 Nf = normalize(cross(W, T));
    float edge = 1.0 - abs(dot(Nf, toC));
    float w = uWidth * (0.7 + 0.6 * h1) * (1.0 + edge * 0.8) * (1.0 + r * 0.004) * mix(1.0, 0.6, reed);
    w *= uFar > 0.9 ? 1.0 - v : 1.0 - v * v * v;
    // stems: a thread with a spindle of seeds on its last segment
    if (stem > 0.5 && uFar < 0.9) w *= v > 0.6 ? 2.2 : 0.3;
    P += W * position.x * w;

    // lighting inputs
    vec3 N = normalize(Nf + W * position.x * 0.45);
    vec3 up = vec3(gi.x, gi.y, gi.z);
    N = normalize(mix(N, up, uFar * 0.6 + 0.25));
    vN = N;
    vWorld = P;
    vV = v;
    vGust = g * (0.6 + 0.4 * wv);
    vSun = sunVis(vec3(p.x, ground + H * 0.7, p.y));
    vec3 tip = grassTip(p, pch, h1);
    vec3 reedC = vec3(0.12, 0.17, 0.05) * (0.8 + 0.4 * h1);
    vCol = mix(tip, reedC, reed);
    vec3 seedC = mix(vec3(0.36, 0.29, 0.14), vec3(0.24, 0.2, 0.1), fract(h1 * 11.0));
    vCol = mix(vCol, seedC, stem * step(0.6, v) * (1.0 - reed));
    // value variation blade to blade, and some dry straw
    vCol *= 0.65 + 0.7 * fract(h1 * 7.31);
    vCol = mix(vCol, vec3(0.33, 0.27, 0.12), step(0.9, fract(h1 * 3.7)) * 0.7);
    vThin = h1;
    gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  }
`

const fragment = /* glsl */ `
  precision highp float;
  uniform vec3 uAmbTop;
  uniform vec3 uAmbHorizon;
  uniform float uFar;
  in vec3 vWorld;
  in vec3 vN;
  in vec3 vCol;
  in float vV;
  in float vSun;
  in float vGust;
  in float vThin;
  out vec4 fragColor;
  ${fog}
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vN);
    float facing = dot(N, V);
    vec3 Nv = facing < 0.0 ? -N : N;
    vec3 L = uSunDir;
    // canopy self-shade: the bottom of a blade lives in the shade of the others
    float canopy = mix(0.18, 1.0, smoothstep(0.0, 0.85, vV));
    float ao = mix(0.3, 1.0, smoothstep(0.0, 0.7, vV));
    float ndl = dot(Nv, L);
    float diff = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
    // sunlight through the blade when it stands between us and the sun
    float through = pow(max(dot(-V, L), 0.0), 3.0) * (0.35 + 0.65 * vV);
    float trans = max(-ndl, 0.0) * 0.5 + through;
    vec3 alb = mix(vec3(0.03, 0.07, 0.015), vCol, smoothstep(0.0, 0.55, vV));
    // gusts bend the blades and show their paler, glossier side
    alb = mix(alb, alb * vec3(1.3, 1.28, 1.05) + vec3(0.03, 0.035, 0.0), vGust * 0.6 * vV);
    vec3 amb = mix(uAmbHorizon, uAmbTop, 0.55);
    vec3 sunL = uSunColor * vSun * canopy;
    vec3 col = alb * (sunL * diff + amb * ao);
    col += alb * sunL * trans * vec3(1.1, 1.25, 0.45) * 1.3;
    vec3 H = normalize(L + V);
    float sp = pow(max(dot(Nv, H), 0.0), 24.0) * (0.15 + 0.5 * vGust);
    col += uSunColor * sp * 0.06 * vSun * vV;
    col = applyFog(col, vWorld);
    fragColor = vec4(col, 1.0);
  }
`

export function makeGrass(env, gu) {
  const meshes = []
  GRASS_LAYERS.forEach((L, i) => {
    const uniforms = {
      ...env.uniforms,
      ...gu,
      uBox: { value: L.box },
      uRIn: { value: L.rIn },
      uROut: { value: L.rOut },
      uBand: { value: L.band },
      uWidth: { value: L.width },
      uFar: { value: i / (GRASS_LAYERS.length - 1) },
    }
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      defines: { ...env.defines },
      side: THREE.DoubleSide,
      vertexShader: vertex,
      fragmentShader: fragment,
    })
    const mesh = new THREE.Mesh(bladeGeometry(L.segs, L.count), mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    meshes.push(mesh)
  })
  return meshes
}

// Wildflowers in drifts: small camera-facing corollas held above the grass,
// white daisies, buttercups, a few blues and poppies. The same drift noise
// tints the far ground, so the colour carries on past the last flower.
export function makeFlowers(env, gu, count = 7000, box = 70) {
  const quad = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.setAttribute('uv', quad.getAttribute('uv'))
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count * 4; i++) seed[i] = Math.random()
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
  geo.instanceCount = count
  const uniforms = { ...env.uniforms, ...gu, uBox: { value: box } }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uBox;
      in vec4 aSeed;
      out vec2 vUv;
      out vec3 vCol;
      out vec3 vWorld;
      out float vSun;
      out float vKind;
      ${noise}
      ${fog}
      ${gardenGLSL}
      void main() {
        vec2 c = cameraPosition.xz;
        vec2 p = c + mod(aSeed.xy * uBox - c + 0.5 * uBox, uBox) - 0.5 * uBox;
        float r = distance(p, c);
        float drift = smoothstep(0.5, 0.86, vnoise(p * 0.045 + 11.0)) * 0.9 + 0.06;
        float dd = length(p - DOORXZ);
        drift = max(drift, (1.0 - smoothstep(6.0, 16.0, dd)) * 0.22);
        if (aSeed.z > drift || r > uBox * 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        float ground = groundH(p);
        if (ground < uWaterY + 0.15) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        vec4 cp = projectionMatrix * viewMatrix * vec4(p.x, ground + 0.5, p.y, 1.0);
        if (cp.w < -1.0 || abs(cp.x) > cp.w + 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        // each drift has a leading species, mixed with a few others
        float kindN = vnoise(p * 0.013 - 4.0) * 0.7 + fract(aSeed.w * 7.13) * 0.3;
        float k = kindN < 0.42 ? 0.0 : (kindN < 0.6 ? 1.0 : (kindN < 0.72 ? 2.0 : 3.0));
        if (k == 3.0 && fract(aSeed.x * 9.7) > 0.35) k = 0.0;
        float tall = smoothstep(0.25, 0.75, vnoise(p * 0.07 + 3.0));
        float H = mix(0.3, 0.8, tall) * (0.8 + 0.4 * aSeed.w);
        if (dd < 16.0) H *= mix(0.45, 1.0, smoothstep(7.0, 16.0, dd));
        float g = gustAt(p);
        vec2 sway = uWind * (0.1 + 0.3 * g) * H + vec2(sin(uTime * 2.1 + aSeed.x * 50.0), cos(uTime * 1.7 + aSeed.y * 40.0)) * 0.03;
        vec3 head = vec3(p.x + sway.x, ground + H, p.y + sway.y);
        vec3 toC = cameraPosition - head;
        float d = length(toC);
        vec3 f = normalize(mix(toC / d, vec3(0.0, 1.0, 0.0), 0.45));
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), f + vec3(0.0001)));
        vec3 up = normalize(cross(f, right));
        float size = (k == 1.0 ? 0.05 : (k == 3.0 ? 0.08 : 0.065)) * (0.8 + 0.5 * aSeed.w);
        size = max(size, d * 0.0022) * (1.0 - smoothstep(uBox * 0.38, uBox * 0.5, r));
        vec3 P = head + (right * position.x + up * position.y) * size * 1.35;
        vUv = uv;
        vKind = k;
        vec3 cols[4] = vec3[4](vec3(0.8, 0.8, 0.74), vec3(0.8, 0.55, 0.03), vec3(0.28, 0.26, 0.7), vec3(0.6, 0.04, 0.02));
        vCol = cols[int(k)] * (0.85 + 0.3 * aSeed.x);
        vSun = sunVis(head);
        vWorld = P;
        gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbTop;
      in vec2 vUv;
      in vec3 vCol;
      in vec3 vWorld;
      in float vSun;
      in float vKind;
      out vec4 fragColor;
      ${fog}
      void main() {
        vec2 q = clamp(vUv, 0.0, 1.0) * 2.0 - 1.0;
        float r = length(q);
        float a = atan(q.y, q.x);
        float petals = vKind == 1.0 ? 5.0 : (vKind == 3.0 ? 4.0 : (vKind == 2.0 ? 5.0 : 11.0));
        float shape = 0.62 + 0.36 * abs(cos(a * petals * 0.5));
        if (vKind == 3.0) shape = 0.9;
        if (r > shape) discard;
        vec3 alb = vCol;
        float eye = 1.0 - smoothstep(0.16, 0.24, r);
        alb = mix(alb, vKind == 3.0 ? vec3(0.03) : vec3(0.85, 0.6, 0.05), eye);
        alb *= 0.75 + 0.25 * r;
        vec3 V = normalize(cameraPosition - vWorld);
        float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
        vec3 col = alb * (uSunColor * (0.55 + 0.5 * back) * vSun + uAmbTop * 0.9);
        col = applyFog(col, vWorld);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return mesh
}

// Pollen and seed fluff drifting on the breeze, lit up when they cross the sun.
export function makePollen(env, gu, count = 1400, box = 46) {
  const quad = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.setAttribute('uv', quad.getAttribute('uv'))
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count * 4; i++) seed[i] = Math.random()
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
  geo.instanceCount = count
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...env.uniforms, ...gu, uBox: { value: box } },
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uBox;
      in vec4 aSeed;
      out vec2 vUv;
      out float vA;
      out vec3 vWorld;
      ${noise}
      ${fog}
      ${gardenGLSL}
      void main() {
        vec3 c = cameraPosition;
        vec3 s = aSeed.xyz * uBox;
        vec3 drift = vec3(uWind.x, 0.0, uWind.y) * uTime * (0.8 + aSeed.w * 1.2);
        drift += vec3(sin(uTime * 0.3 + aSeed.w * 30.0), 0.0, cos(uTime * 0.23 + aSeed.x * 20.0)) * 1.5;
        vec3 p = c + mod(s + drift - c + 0.5 * uBox, uBox) - 0.5 * uBox;
        float ground = groundH(p.xz);
        p.y = ground + 0.4 + aSeed.y * 7.0 + sin(uTime * 0.5 + aSeed.z * 40.0) * 0.4;
        float d = distance(p, c);
        vec3 toC = normalize(c - p);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toC));
        vec3 up = cross(toC, right);
        float size = (0.02 + 0.03 * aSeed.w) * max(1.0, d * 0.06);
        p += (right * position.x + up * position.y) * size;
        vUv = uv;
        vA = (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d)) * smoothstep(0.6, 2.0, d) / max(1.0, d * 0.06);
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbTop;
      in vec2 vUv;
      in float vA;
      in vec3 vWorld;
      out vec4 fragColor;
      ${fog}
      void main() {
        vec2 q = clamp(vUv, 0.0, 1.0) * 2.0 - 1.0;
        float a = exp(-dot(q, q) * 3.0) * vA;
        vec3 V = normalize(cameraPosition - vWorld);
        float back = pow(max(dot(-V, uSunDir), 0.0), 6.0);
        vec3 col = vec3(1.0, 0.95, 0.8) * (uSunColor * (0.06 + 0.8 * back) + uAmbTop * 0.1) * a;
        vec3 rd;
        float f = fogFrom(vWorld, rd);
        fragColor = vec4(col * (1.0 - f), 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 14
  return mesh
}
