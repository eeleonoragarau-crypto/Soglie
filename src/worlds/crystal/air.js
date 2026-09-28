// What floats in the dawn air: glittering motes around the eye, soft shafts
// of low sunlight through the haze, the halos of the singing crystals and the
// shards the great crystal lets go of when it opens.

import * as THREE from 'three'
import { noise, fog } from '../../lib/glsl.js'

const quad = () => {
  const g = new THREE.InstancedBufferGeometry()
  const q = new THREE.PlaneGeometry(1, 1)
  g.index = q.index
  g.setAttribute('position', q.getAttribute('position'))
  g.setAttribute('uv', q.getAttribute('uv'))
  return g
}

// ------------------------------------------------------------ motes
export function makeMotes(env, count = 2600) {
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random()
    pos[i * 3 + 1] = Math.pow(Math.random(), 1.6)
    pos[i * 3 + 2] = Math.random()
    seed[i] = Math.random()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aS', new THREE.BufferAttribute(seed, 1))
  const u = { ...env.uniforms, uTime: { value: 0 }, uPx: { value: 1 } }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: u,
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      in float aS;
      uniform float uTime;
      uniform float uPx;
      uniform vec3 uSunDir;
      out float vA;
      out vec3 vWorld;
      out float vHue;
      void main() {
        vec3 B = vec3(110.0, 34.0, 110.0);
        vec3 drift = vec3(0.22, 0.04, 0.1) * uTime;
        vec3 p = position * B + drift;
        p.x += sin(uTime * 0.11 + aS * 40.0) * 1.3;
        p.z += cos(uTime * 0.09 + aS * 31.0) * 1.3;
        vec3 c = cameraPosition;
        p.xz = c.xz + mod(p.xz - c.xz + B.xz * 0.5, B.xz) - B.xz * 0.5;
        p.y = 0.15 + mod(p.y, B.y);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = max(-mv.z, 0.1);
        float ph = uTime * (0.5 + aS * 1.8) + aS * 60.0;
        vec3 fn = normalize(vec3(sin(ph), cos(ph * 0.73 + 1.0), sin(ph * 1.31 + 2.0)));
        vec3 V = normalize(c - p);
        float flash = pow(abs(dot(fn, normalize(uSunDir + V))), 80.0);
        float edgeFade = 1.0 - smoothstep(38.0, 55.0, length(p.xz - c.xz));
        vA = (0.035 + flash * 2.6) * edgeFade * smoothstep(0.3, 1.5, d);
        vHue = fract(aS * 7.3);
        vWorld = p;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * clamp(9.0 / d, 1.0, 3.2) * (0.8 + flash * 0.9);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vA;
      in vec3 vWorld;
      in float vHue;
      out vec4 fragColor;
      ${fog}
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, abs(q.x) + abs(q.y));
        vec3 tint = mix(vec3(1.0, 0.78, 0.9), vec3(0.95, 0.9, 1.0), vHue);
        vec3 rd;
        float f = fogFrom(vWorld, rd);
        fragColor = vec4(tint * a * vA * (1.0 - f), 1.0);
      }
    `,
  })
  const pts = new THREE.Points(g, mat)
  pts.frustumCulled = false
  pts.renderOrder = 22
  pts.userData.u = u
  return pts
}

// ------------------------------------------------------------ shafts
// ribbons along the sun's direction, always turned toward the eye
export function makeShafts(env, list) {
  const g = quad()
  const n = list.length
  const o = new Float32Array(n * 4)
  const p = new Float32Array(n * 4)
  list.forEach((s, i) => {
    o.set([s.x, s.y, s.z, s.w], i * 4)
    p.set([s.len, s.i, Math.random(), 0], i * 4)
  })
  g.setAttribute('aO', new THREE.InstancedBufferAttribute(o, 4))
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(p, 4))
  g.instanceCount = n
  const u = { ...env.uniforms, uTime: { value: 0 }, uAmp: { value: 1 } }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: u,
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      in vec4 aO;
      in vec4 aP;
      uniform vec3 uSunDir;
      out vec2 vUv;
      out float vI;
      out float vSeed;
      out vec3 vWorld;
      void main() {
        vec3 ax = -uSunDir;
        float y = position.y + 0.5;
        vec3 c = aO.xyz + ax * y * aP.x;
        vec3 toC = cameraPosition - c;
        vec3 side = cross(ax, toC);
        float sl = length(side);
        side = sl > 1e-3 ? side / sl : vec3(0.0, 1.0, 0.0);
        vec3 wp = c + side * position.x * aO.w;
        // edge-on ribbons fade: they would read as flat planes
        float face = sl / max(length(toC), 1e-3);
        vI = aP.y * smoothstep(0.05, 0.4, face) * smoothstep(6.0, 40.0, length(toC));
        vUv = vec2(position.x * 2.0, y);
        vSeed = aP.z;
        vWorld = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uAmp;
      in vec2 vUv;
      in float vI;
      in float vSeed;
      in vec3 vWorld;
      out vec4 fragColor;
      ${noise}
      ${fog}
      void main() {
        float across = exp(-vUv.x * vUv.x * 5.0) * (1.0 - smoothstep(0.7, 1.0, abs(vUv.x)));
        float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y)) * smoothstep(2.0, 14.0, vWorld.y);
        float fl = 0.65 + 0.35 * vnoise(vec2(vUv.x * 2.0 + vSeed * 20.0, vUv.y * 5.0 - uTime * 0.04));
        vec3 rd;
        float f = fogFrom(vWorld, rd);
        vec3 col = uSunColor * vec3(1.0, 0.86, 0.8) * 0.03 * vI * across * along * fl * uAmp * (1.0 - f * 0.55);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 20
  mesh.userData.u = u
  return mesh
}

// ------------------------------------------------------------ halos + columns
// kind 0: soft round glow, kind 1: thin vertical column of light
export function makeGlows(env, list) {
  const g = quad()
  const n = list.length
  const c = new Float32Array(n * 4)
  const s = new Float32Array(n * 4)
  const col = new Float32Array(n * 3)
  list.forEach((o, i) => {
    c.set([o.x, o.y, o.z, o.slot], i * 4)
    s.set([o.w, o.h, o.kind, 0], i * 4)
    col.set(o.color, i * 3)
  })
  g.setAttribute('aC', new THREE.InstancedBufferAttribute(c, 4))
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 4))
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3))
  g.instanceCount = n
  const u = { ...env.uniforms, uTime: { value: 0 }, uI: { value: new Array(8).fill(0) } }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: u,
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      in vec4 aC;
      in vec4 aS;
      in vec3 aCol;
      uniform float uI[8];
      out vec2 vUv;
      out float vKind;
      out float vA;
      out vec3 vCol;
      out vec3 vWorld;
      void main() {
        vec3 c = aC.xyz;
        vec3 toC = normalize(cameraPosition - c);
        vec3 wp;
        if (aS.z < 0.5) {
          vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toC));
          vec3 up = cross(toC, r);
          wp = c + r * position.x * aS.x + up * position.y * aS.y;
          wp += toC * aS.x * 0.35;
        } else {
          vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toC));
          wp = c + r * position.x * aS.x + vec3(0.0, (position.y + 0.5) * aS.y, 0.0);
        }
        vUv = position.xy * 2.0;
        vKind = aS.z;
        float dc = length(cameraPosition - c);
        vA = uI[int(aC.w + 0.5)] * (aS.z < 0.5 ? smoothstep(12.0, 60.0, dc) * (1.0 + dc / 150.0) : 1.0);
        vCol = aCol;
        vWorld = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv;
      in float vKind;
      in float vA;
      in vec3 vCol;
      in vec3 vWorld;
      out vec4 fragColor;
      ${fog}
      void main() {
        float a;
        if (vKind < 0.5) {
          float r2 = dot(vUv, vUv);
          a = exp(-r2 * 4.0) * 0.7 + exp(-r2 * 26.0) * 0.6;
          a *= 1.0 - smoothstep(0.8, 1.0, r2);
        } else {
          float y = vUv.y * 0.5 + 0.5;
          a = exp(-vUv.x * vUv.x * 9.0) * (1.0 - smoothstep(0.15, 1.0, y)) * smoothstep(0.0, 0.02, y);
        }
        vec3 rd;
        float f = fogFrom(vWorld, rd);
        fragColor = vec4(vCol * a * vA * (1.0 - f * 0.75), 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 21
  mesh.userData.u = u
  return mesh
}

// ------------------------------------------------------------ shards
// released by the dissolving front of the great crystal, drifting away; a
// few stay and circle the key for ever
export function makeShards(env, count, o) {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.9, 0, -0.16, -0.5, 0, 0.2, -0.45, 0], 3))
  const a = new Float32Array(count * 4)
  const b = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    a.set([Math.pow(Math.random(), 0.8), Math.random() * Math.PI * 2, 2 + Math.random() * 9, 7 + Math.random() * 9], i * 4)
    b.set([0.1 + Math.pow(Math.random(), 4) * 0.7, (Math.random() - 0.5) * 6, Math.random() < 0.09 ? 1 : 0, Math.random()], i * 4)
  }
  g.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4))
  g.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 4))
  g.instanceCount = count
  const u = {
    ...env.uniforms,
    uT: { value: -1 },
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3(o.x, o.y, o.z) },
    uKey: { value: new THREE.Vector3(o.x, o.keyY, o.z) },
    uR: { value: o.R },
    uH: { value: o.H },
    uSpeed: { value: o.speed },
    uCol: { value: new THREE.Vector3(...o.color) },
  }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: u,
    defines: { ...env.defines },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      in vec4 aA;
      in vec4 aB;
      uniform float uT;
      uniform float uTime;
      uniform vec3 uCenter;
      uniform vec3 uKey;
      uniform float uR;
      uniform float uH;
      uniform float uSpeed;
      uniform vec3 uSunDir;
      out float vA;
      out float vFlash;
      out vec3 vWorld;
      mat3 rotAxis(vec3 a, float ang) {
        float s = sin(ang), c = cos(ang), oc = 1.0 - c;
        return mat3(
          oc * a.x * a.x + c,       oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
          oc * a.x * a.y - a.z * s, oc * a.y * a.y + c,       oc * a.y * a.z + a.x * s,
          oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
      }
      void main() {
        float h = aA.x * uH;
        float age = uT - (uH - h) / uSpeed;
        if (age < 0.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); vA = 0.0; vFlash = 0.0; vWorld = uCenter; return; }
        float ang = aA.y;
        vec3 start = uCenter + vec3(cos(ang) * uR * 0.8, h, sin(ang) * uR * 0.8);
        vec3 dir = normalize(vec3(cos(ang), 0.2 + aB.w * 0.9, sin(ang)));
        float k = 0.45;
        vec3 p = start + dir * aA.z * (1.0 - exp(-age * k)) / k + vec3(0.0, age * 0.5, 0.0);
        float life = aA.w;
        float fade = smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(life * 0.55, life, age));
        if (aB.z > 0.5) {
          // the ring that stays around the key
          float oa = ang + uTime * (0.12 + aB.w * 0.1);
          float orr = 1.6 + aB.w * 2.2;
          vec3 ring = uKey + vec3(cos(oa) * orr, sin(uTime * 0.4 + aB.w * 9.0) * 0.6 + (aB.w - 0.5) * 2.0, sin(oa) * orr);
          float s = smoothstep(3.0, 9.0, age);
          p = mix(p, ring, s);
          fade = max(fade, s * 0.8);
        }
        vec3 ax = normalize(vec3(aB.w - 0.5, 1.0, fract(aB.w * 7.0) - 0.5));
        mat3 rot = rotAxis(ax, age * aB.y + aB.w * 6.0);
        vec3 lp = rot * (position * aB.x);
        vec3 n = rot * vec3(0.0, 0.0, 1.0);
        vec3 wp = p + lp;
        vec3 V = normalize(cameraPosition - wp);
        vFlash = pow(abs(dot(n, normalize(uSunDir + V))), 40.0);
        vA = fade;
        vWorld = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uCol;
      in float vA;
      in float vFlash;
      in vec3 vWorld;
      out vec4 fragColor;
      ${fog}
      void main() {
        vec3 rd;
        float f = fogFrom(vWorld, rd);
        vec3 col = (uCol * uCol * 0.5 + vec3(1.0, 0.92, 0.98) * vFlash * 4.0) * vA * (1.0 - f);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 23
  mesh.visible = false
  mesh.userData.u = u
  return mesh
}
