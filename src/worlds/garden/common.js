// Shared GLSL for the garden: the heightfield (the same bilinear lookup the
// CPU does in groundAt), the breeze, the soft shadows of the floating islands,
// trees and clouds, and the meadow palette that blades and far ground share.

import * as THREE from 'three'
import { HF, SUN, WIND, DOOR } from './layout.js'

export const NISL = 12 // islands casting shadows
export const NTREE = 10 // ground trees casting shadows

export function makeGardenUniforms(heightTex, normTex) {
  return {
    uHeight: { value: heightTex },
    uGNorm: { value: normTex },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(...WIND) },
    uIsl: { value: Array.from({ length: NISL }, () => new THREE.Vector4(1e5, -1e5, 1e5, 1)) },
    uTreeS: { value: Array.from({ length: NTREE }, () => new THREE.Vector4(1e5, -1e5, 1e5, 1)) },
    uWaterY: { value: 0 },
    uPond: { value: new THREE.Vector4(0, 0, 0, 1) }, // x, z, r, calm
  }
}

export const gardenGLSL = /* glsl */ `
  precision highp sampler2D;
  uniform sampler2D uHeight;
  uniform sampler2D uGNorm;
  uniform float uTime;
  uniform vec2 uWind;
  uniform vec4 uIsl[${NISL}];
  uniform vec4 uTreeS[${NTREE}];
  uniform float uWaterY;
  uniform vec4 uPond;
  const int GN = ${HF.n};
  const float GS = ${HF.s.toFixed(4)};
  const float GHALF = ${HF.half.toFixed(4)};
  const vec2 DOORXZ = vec2(${DOOR.x.toFixed(2)}, ${DOOR.z.toFixed(2)});

  float gFetch(ivec2 i) { return texelFetch(uHeight, clamp(i, ivec2(0), ivec2(GN - 1)), 0).r; }
  float groundH(vec2 p) {
    vec2 g = clamp((p + GHALF) / GS, vec2(0.0), vec2(float(GN - 1)));
    vec2 f = floor(g);
    vec2 t = g - f;
    ivec2 i = ivec2(f);
    float a = gFetch(i), b = gFetch(i + ivec2(1, 0));
    float c = gFetch(i + ivec2(0, 1)), d = gFetch(i + ivec2(1, 1));
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  }
  // xyz: smooth normal, w: meadow patch value
  vec4 groundInfo(vec2 p) {
    vec2 uv = ((p + GHALF) / GS + 0.5) / float(GN);
    vec4 s = texture(uGNorm, uv);
    vec2 nxz = s.xy;
    return vec4(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y, s.w);
  }

  // the breeze: slow gusts rolling across the meadow, plus a fine rhythmic wave
  float gustAt(vec2 p) {
    vec2 q = p * 0.017 - uWind * uTime * 0.125;
    float g = vnoise(q) * 0.62 + vnoise(q * 2.6 + 7.3) * 0.38;
    return smoothstep(0.36, 0.82, g);
  }
  float waveAt(vec2 p) {
    return 0.5 + 0.5 * sin(dot(p, uWind) * 0.55 - uTime * 3.4 + vnoise(p * 0.05) * 5.0);
  }

  // soft sun occlusion by the floating islands (their top discs, projected)
  float islandShadow(vec3 p) {
    float s = 1.0;
    for (int i = 0; i < ${NISL}; i++) {
      vec4 I = uIsl[i];
      float up = I.y - p.y;
      if (up <= 0.5) continue;
      vec2 q = p.xz + uSunDir.xz * (up / uSunDir.y) - I.xz;
      float d = length(q);
      if (d > I.w * 1.6) continue;
      float a = atan(q.y, q.x);
      float edge = I.w * (0.8 + 0.07 * sin(a * 3.0 + float(i) * 1.7) + 0.05 * sin(a * 7.0 - float(i)));
      float pen = I.w * 0.1 + up * 0.012;
      s *= mix(0.2, 1.0, smoothstep(edge - pen, edge + pen, d));
    }
    return s;
  }
  // dappled shade under the ground trees
  float treeShadow(vec3 p) {
    float s = 1.0;
    for (int i = 0; i < ${NTREE}; i++) {
      vec4 T = uTreeS[i];
      float up = T.y - p.y;
      if (up <= 0.0) continue;
      vec3 c = T.xyz - uSunDir * (up / uSunDir.y);
      vec2 q = p.xz - c.xz;
      float d = length(q);
      if (d > T.w * 1.3) continue;
      float dapple = vnoise(p.xz * 1.3 + float(i) * 7.0) * 0.6 + vnoise(p.xz * 3.1) * 0.4;
      float core = 1.0 - smoothstep(T.w * 0.55, T.w * 1.05, d);
      s *= 1.0 - core * (0.78 - 0.45 * smoothstep(0.55, 0.85, dapple) * (1.0 - core * 0.5));
    }
    return s;
  }
  // big soft cloud shadows drifting over the hills
  float cloudShadow(vec3 p) {
    vec2 q = (p.xz + uSunDir.xz * ((1500.0 - p.y) / uSunDir.y)) * 0.0011 - uWind * uTime * 0.0075;
    float c = vnoise(q) * 0.64 + vnoise(q * 2.3 + 1.7) * 0.36;
    return 1.0 - 0.62 * smoothstep(0.52, 0.72, c);
  }
  float sunVis(vec3 p) {
    return islandShadow(p) * treeShadow(p) * cloudShadow(p);
  }

  // meadow palette in linear light. patch: 0..1 large-scale species mix
  vec3 grassTip(vec2 p, float pch, float r) {
    vec3 lush = vec3(0.045, 0.13, 0.012);
    vec3 fresh = vec3(0.11, 0.2, 0.018);
    vec3 dry = vec3(0.3, 0.25, 0.07);
    vec3 blue = vec3(0.035, 0.1, 0.04);
    vec3 c = mix(lush, fresh, smoothstep(0.25, 0.75, pch));
    c = mix(c, dry, smoothstep(0.7, 0.95, pch) * 0.75);
    c = mix(c, blue, smoothstep(0.3, 0.0, pch) * 0.6);
    // per-blade variation
    c *= 0.8 + 0.4 * r;
    c = mix(c, dry, step(0.94, r) * 0.6);
    return c;
  }
  vec3 grassRoot() { return vec3(0.012, 0.028, 0.006); }
`

// JS twins so we can place things on the ground and know the water level
export function packIslands(uniformArray, islands, offsets) {
  for (let i = 0; i < uniformArray.length; i++) {
    const I = islands[i]
    if (!I) { uniformArray[i].set(1e5, -1e5, 1e5, 1); continue }
    const o = offsets ? offsets[i] : 0
    uniformArray[i].set(I.x, I.y + o, I.z, I.r)
  }
}

export { SUN }
