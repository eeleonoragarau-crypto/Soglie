// The walkable part of L'Abisso: hexagonal tiles of dark glass that exist only
// near you, the drifting shards around them, the trail of stars that hints the
// route, and a little dust that catches the light as you move.

import * as THREE from 'three'
import { fog } from '../../lib/glsl.js'
import { hexPrism, TILE_R, mulberry } from './layout.js'

export const STEPS = 8

const premul = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
}

export function makeTiles(env, U, tiles) {
  const geo = hexPrism()
  const n = tiles.length
  const info = new Float32Array(n * 4)
  const state = new Float32Array(n * 2)
  const mesh = new THREE.InstancedMesh(geo, null, n)
  const m = new THREE.Matrix4()
  tiles.forEach((t, i) => {
    m.makeTranslation(t.x, t.top, t.z)
    mesh.setMatrixAt(i, m)
    info.set([t.kind, t.seed, t.s, 0], i * 4)
  })
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4))
  const stateAttr = new THREE.InstancedBufferAttribute(state, 2)
  stateAttr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('aState', stateAttr)

  const u = {
    ...env.uniforms,
    uTime: U.uTime,
    uSteps: { value: Array.from({ length: STEPS }, () => new THREE.Vector4(1e5, 1e5, -100, 0)) },
    uRim: { value: new THREE.Vector3(0.86, 0.78, 1.0) },
    uKey: { value: new THREE.Vector4(0, -1e4, 0, 0) },
    uKeyColor: { value: new THREE.Vector3(0.62, 1.0, 0.45) },
    uTileR: { value: TILE_R },
  }
  mesh.material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: u,
    defines: { ...env.defines },
    ...premul,
    vertexShader: /* glsl */ `
      in vec4 aInfo;
      in vec2 aState;
      out vec3 vWorld;
      out vec3 vNormal;
      out vec3 vObj;
      out vec3 vCenter;
      out vec4 vInfo;
      out vec2 vState;
      void main() {
        mat4 M = modelMatrix * instanceMatrix;
        vec4 w = M * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(M) * normal);
        vObj = position;
        vCenter = M[3].xyz;
        vInfo = aInfo;
        vState = aState;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec4 uSteps[${STEPS}];
      uniform vec3 uRim;
      uniform vec4 uKey;
      uniform vec3 uKeyColor;
      uniform float uTileR;
      in vec3 vWorld;
      in vec3 vNormal;
      in vec3 vObj;
      in vec3 vCenter;
      in vec4 vInfo;
      in vec2 vState;
      out vec4 fragColor;
      ${fog}
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float seed = vInfo.y;
        // lit by your presence; through a door, by the eye that looks
        float camD = length(cameraPosition - vCenter);
        float lit = max(vState.x, smoothstep(9.0, 3.5, camD));
        float vis = max(lit, vState.y * 0.14);

        // the key lights the glass around it, even from afar
        vec3 kv = uKey.xyz - vWorld;
        float kd2 = dot(kv, kv);
        float kl = uKey.w * (0.2 + 0.8 * max(dot(N, kv * inversesqrt(kd2)), 0.0)) / (1.0 + kd2 * 1.1) * 0.5;
        if (vis < 0.003 && kl < 0.002) discard;

        float topF = step(0.95, N.y);
        float ri = uTileR * 0.8660254;
        vec2 o = vObj.xz;
        float hd = max(abs(o.x), 0.5 * abs(o.x) + 0.8660254 * abs(o.y));
        float e = ri - hd;
        // a thin line of light where the top meets the bevel, drawn on as it wakes
        float w = max(0.009, fwidth(e) * 1.3);
        float line = exp(-pow((e - 0.036) / w, 2.0)) * min(1.0, 0.011 / w) * step(0.3, N.y);
        float inner = exp(-max(e - 0.036, 0.0) / 0.14) * topF;
        float ang = fract(atan(o.y, o.x) * 0.15915494 + 0.5 + seed);
        float drawn = 1.0 - smoothstep(lit * 1.08 - 0.07, lit * 1.08, ang);

        // footfalls send rings of light through the glass
        float wave = 0.0;
        for (int i = 0; i < ${STEPS}; i++) {
          vec4 s = uSteps[i];
          float age = uTime - s.z;
          if (age < 0.0 || age > 3.5) continue;
          float dd = length(vWorld.xz - s.xy) - age * 3.3;
          wave += exp(-dd * dd * 4.0) * exp(-age * 1.25) * s.w;
        }

        vec3 R = reflect(-V, N);
        vec3 env = skyLUT(R);
        float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 tint = mix(vec3(0.9, 0.74, 1.0), vec3(0.72, 0.8, 1.0), fract(seed * 7.13));
        vec3 col = vec3(0.0025, 0.002, 0.006) + env * F * 1.15;
        float em = line * drawn * (1.0 + wave * 3.0) * 1.7 + inner * 0.06 + wave * topF * 0.3;
        col += uRim * tint * em * lit;
        vec3 keyC = uKeyColor * kl * (0.6 + 0.4 * inner + line * 2.0);
        float a = vis * mix(0.84, 0.74, topF);
        vec3 rd;
        float fo = fogFrom(vWorld, rd);
        fragColor = vec4((col * vis + keyC) * (1.0 - fo), max(a, min(kl * 0.6, 0.7)) * (1.0 - fo));
      }
    `,
  })
  mesh.frustumCulled = false
  mesh.renderOrder = 7
  return { mesh, state, stateAttr, u }
}

// shards of the same glass and far hexagonal columns, slowly tumbling
export function makeShards(env, U, shards) {
  const small = hexPrism()
  const tall = hexPrism({ r: 0.5, bevel: 0.02, side: 0.8, taper: 0.2, bottom: 0.55 })
  const out = []
  for (const kind of [0, 1]) {
    const list = shards.filter((s) => s.kind === kind)
    if (!list.length) continue
    const geo = (kind ? tall : small).clone()
    const spin = new Float32Array(list.length * 4)
    const mesh = new THREE.InstancedMesh(geo, null, list.length)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const rnd = mulberry(99 + kind)
    list.forEach((s, i) => {
      e.set((rnd() - 0.5) * (kind ? 0.5 : 3), rnd() * 6.28, (rnd() - 0.5) * (kind ? 0.5 : 3))
      q.setFromEuler(e)
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.sx, s.sy, s.sz))
      mesh.setMatrixAt(i, m)
      const ax = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize()
      if (kind) ax.set(0, 1, 0)
      spin.set([ax.x, ax.y, ax.z, s.speed * (rnd() < 0.5 ? -1 : 1)], i * 4)
    })
    geo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4))
    mesh.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...env.uniforms, uTime: U.uTime, uRim: { value: new THREE.Vector3(0.78, 0.62, 1.0) }, uRi: { value: (kind ? 0.48 : TILE_R - 0.045) * 0.8660254 } },
      defines: { ...env.defines },
      vertexShader: /* glsl */ `
        uniform float uTime;
        in vec4 aSpin;
        out vec3 vWorld;
        out vec3 vNormal;
        out vec3 vObj;
        out vec3 vObjN;
        mat3 axisAngle(vec3 a, float t) {
          float c = cos(t), s = sin(t), k = 1.0 - c;
          return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
                      a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
                      a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
        }
        void main() {
          mat3 im = mat3(instanceMatrix);
          mat3 Rm = axisAngle(aSpin.xyz, uTime * aSpin.w + float(gl_InstanceID) * 1.7);
          vec3 wp = instanceMatrix[3].xyz + Rm * (im * position);
          vWorld = wp;
          vNormal = normalize(Rm * (transpose(inverse(im)) * normal));
          vObj = position;
          vObjN = normal;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uRim;
        uniform float uRi;
        in vec3 vWorld;
        in vec3 vNormal;
        in vec3 vObj;
        in vec3 vObjN;
        out vec4 fragColor;
        ${fog}
        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 R = reflect(-V, N);
          float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 col = vec3(0.0018, 0.0015, 0.004) + skyLUT(R) * F * 1.2;
          vec3 H = normalize(uSunDir + V);
          col += uSunColor * pow(max(dot(N, H), 0.0), 380.0) * 2.5;
          col += uSunColor * max(dot(N, uSunDir), 0.0) * 0.004;
          // the same faint line of light around the cut faces
          float hd = max(abs(vObj.x), 0.5 * abs(vObj.x) + 0.8660254 * abs(vObj.z));
          float cap = step(0.95, abs(vObjN.y));
          float x = hd / uRi;
          float lw = max(0.012, fwidth(x) * 1.2);
          col += uRim * cap * exp(-pow((x - 0.985) / lw, 2.0)) * min(1.0, 0.02 / lw) * 0.9;
          col += uRim * F * 0.06;
          col = applyFog(col, vWorld);
          fragColor = vec4(col, 1.0);
        }
      `,
    })
    mesh.frustumCulled = false
    mesh.renderOrder = 6
    out.push(mesh)
  }
  return out
}

// the trail: star-like points above the tiles, a slow pulse running toward the hole
export function makeMarkers(env, U, markers, pixelRatio) {
  const n = markers.length
  const pos = new Float32Array(n * 3)
  const info = new Float32Array(n * 2)
  markers.forEach((mk, i) => {
    pos.set([mk.x, mk.y, mk.z], i * 3)
    info.set([mk.s, mk.seed], i * 2)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 2))
  const u = { ...env.uniforms, uTime: U.uTime, uPx: { value: pixelRatio }, uColor: { value: new THREE.Vector3(0.86, 0.8, 1.0) } }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: u,
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPx;
      in vec2 aInfo;
      out float vA;
      out float vSize;
      void main() {
        vec3 wp = position + vec3(0.0, sin(uTime * 0.45 + aInfo.y * 40.0) * 0.12, 0.0);
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = length(wp - cameraPosition);
        float near = smoothstep(2.2, 6.5, d);
        float pulse = pow(0.5 + 0.5 * sin(aInfo.x * 0.15 - uTime * 1.4), 16.0);
        float tw = 0.88 + 0.12 * sin(uTime * (1.1 + aInfo.y * 2.0) + aInfo.y * 30.0);
        float size = clamp(230.0 / d, 2.4, 20.0);
        gl_PointSize = size * uPx;
        vSize = size * uPx;
        vA = near * tw * (1.0 + pulse * 1.4) * clamp(pow(40.0 / d, 1.3), 0.07, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      in float vA;
      in float vSize;
      out vec4 fragColor;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(q, q);
        float px = 2.0 / vSize;
        float core = exp(-r2 / (px * px * 1.4 + 0.003));
        float halo = exp(-r2 * 6.0) * 0.07;
        float sx = exp(-abs(q.y) / (px * 0.6)) * pow(max(1.0 - abs(q.x), 0.0), 4.0);
        float sy = exp(-abs(q.x) / (px * 0.6)) * pow(max(1.0 - abs(q.y), 0.0), 4.0);
        vec3 col = uColor * (core * 2.6 + halo + (sx + sy) * 0.22) * vA;
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const pts = new THREE.Points(geo, mat)
  pts.frustumCulled = false
  pts.renderOrder = 9
  return pts
}

// motes around the eye: parallax, so you feel yourself move through the dark
export function makeDust(env, U, pixelRatio, count = 420) {
  const rnd = mulberry(5)
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count * 4; i++) seed[i] = rnd()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uTime: U.uTime, uPx: { value: pixelRatio } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPx;
      in vec4 aSeed;
      out float vA;
      void main() {
        float B = 24.0;
        vec3 p = aSeed.xyz * B + vec3(sin(uTime * 0.05 + aSeed.w * 20.0), sin(uTime * 0.04 + aSeed.x * 17.0), cos(uTime * 0.045 + aSeed.y * 13.0)) * 0.8;
        vec3 rel = mod(p - cameraPosition, B) - 0.5 * B;
        vec3 wp = cameraPosition + rel;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = length(rel);
        vA = smoothstep(0.5 * B, 0.25 * B, d) * smoothstep(0.4, 1.8, d) * (0.4 + 0.6 * aSeed.w);
        gl_PointSize = uPx * clamp(5.0 / d, 1.0, 3.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vA;
      out vec4 fragColor;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float a = exp(-dot(q, q) * 3.0) * vA;
        fragColor = vec4(vec3(0.75, 0.7, 1.0) * a * 0.35, 1.0);
      }
    `,
  })
  const pts = new THREE.Points(geo, mat)
  pts.frustumCulled = false
  pts.renderOrder = 10
  return pts
}
