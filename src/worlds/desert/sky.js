// Desert sky: baked atmosphere, the low sun, drifting cirrus and a pale ringed
// planet hanging over the dunes in broad daylight.

import * as THREE from 'three'
import { noise, fog } from '../../lib/glsl.js'
import { makeSkyDome } from '../../engine/skydome.js'

export function makeDesertSky(env) {
  const uniforms = {
    ...env.uniforms,
    uTime: { value: 0 },
    uPlanetDir: { value: new THREE.Vector3(0.3, 0.24, -0.92).normalize() },
    uPlanetR: { value: Math.sin((4.6 * Math.PI) / 180) },
    uRingN: { value: new THREE.Vector3(0.32, 0.92, 0.22).normalize() },
    uCloud: { value: 1 },
    uStorm: { value: 0 },
  }
  const body = /* glsl */ `
    uniform float uTime;
    uniform vec3 uPlanetDir;
    uniform float uPlanetR;
    uniform vec3 uRingN;
    uniform float uCloud;
    uniform float uStorm;
    ${noise}
    ${fog}

    vec3 planet(vec3 d, vec3 col) {
      vec3 P = uPlanetDir;
      float r = uPlanetR;
      float b = dot(d, P);
      float disc = b * b - (1.0 - r * r);
      float tP = 1e9;
      vec3 add = vec3(0.0);
      vec3 up = normalize(vec3(0.15, 1.0, 0.25));
      if (disc > 0.0) {
        tP = b - sqrt(disc);
        vec3 n = normalize(d * tP - P);
        float lat = dot(n, up);
        float lon = atan(dot(n, normalize(cross(up, vec3(1, 0, 0)))), dot(n, vec3(1, 0, 0)));
        float bands = sin(lat * 18.0 + fbm2(vec2(lat * 7.0, lon * 1.2)) * 2.5);
        float fine = fbm2(vec2(lat * 60.0, lon * 3.0 + uTime * 0.002));
        vec3 alb = mix(vec3(0.82, 0.72, 0.6), vec3(0.62, 0.42, 0.3), smoothstep(-0.3, 0.8, bands));
        alb = mix(alb, vec3(0.9, 0.86, 0.8), smoothstep(0.55, 0.8, fine) * 0.5);
        float ndl = dot(n, uSunDir);
        float lit = smoothstep(-0.08, 0.35, ndl);
        // ring shadow across the disc
        vec3 S = d * tP;
        float dn = dot(uSunDir, uRingN);
        float ringSh = 1.0;
        if (abs(dn) > 1e-4) {
          float ts = dot(P - S, uRingN) / dn;
          if (ts > 0.0) {
            float rs = length(S + uSunDir * ts - P) / r;
            ringSh = 1.0 - 0.6 * smoothstep(1.3, 1.42, rs) * (1.0 - smoothstep(2.3, 2.45, rs));
          }
        }
        float limb = pow(1.0 - max(dot(n, -d), 0.0), 2.5);
        add = alb * lit * ringSh * uSunColor * 0.16 + vec3(0.5, 0.62, 0.8) * limb * lit * 0.12;
      }
      // rings
      float den = dot(d, uRingN);
      if (abs(den) > 1e-4) {
        float tR = dot(P, uRingN) / den;
        if (tR > 0.0) {
          vec3 h = d * tR;
          float rr = length(h - P) / r;
          if (rr > 1.3 && rr < 2.45 && tR < tP) {
            float band = 0.55 + 0.45 * sin(rr * 90.0) * sin(rr * 23.0 + 1.3);
            band *= smoothstep(1.3, 1.42, rr) * (1.0 - smoothstep(2.3, 2.45, rr));
            band *= 1.0 - 0.8 * smoothstep(1.86, 1.88, rr) * (1.0 - smoothstep(1.93, 1.95, rr));
            // planet shadow on the ring
            vec3 toP = P - h;
            float bb = dot(uSunDir, toP);
            float sh = 1.0;
            if (bb > 0.0 && length(toP - uSunDir * bb) < r) sh = 0.15;
            add += vec3(0.86, 0.8, 0.72) * band * sh * uSunColor * 0.09;
          }
        }
      }
      // sky in front of the body still scatters; the body adds its own light
      return col + add;
    }

    vec3 skyColor(vec3 d) {
      vec3 col = skyLUT(d);
      float mu = dot(d, uSunDir);
      // sun: disc, limb darkening, tight corona
      float disk = smoothstep(0.99985, 0.99993, mu);
      col += uSunColor * disk * 60.0;
      col += uSunColor * pow(max(mu, 0.0), 900.0) * 3.5;
      col = planet(d, col);
      // cirrus
      if (d.y > 0.0 && uCloud > 0.0) {
        vec2 p = d.xz / (d.y + 0.1);
        vec2 wind = vec2(-0.94, 0.34);
        mat2 rot = mat2(wind.x, -wind.y, wind.y, wind.x);
        vec2 q = rot * p;
        q += vec2(uTime * 0.004, 0.0);
        float c = fbm2(q * vec2(0.9, 3.4) + fbm2(q * 1.3) * 0.8);
        float sheet = smoothstep(0.52, 0.86, c) * smoothstep(0.02, 0.22, d.y) * (1.0 - smoothstep(0.55, 0.9, d.y));
        float fw = pow(max(mu, 0.0), 6.0);
        vec3 cl = skyLUT(vec3(d.x, d.y * 0.3 + 0.1, d.z)) * 0.9 + uSunColor * (0.18 + 1.6 * fw);
        col = mix(col, cl, sheet * 0.55 * uCloud);
      }
      // the storm at the edge of the world swallows the sky
      if (uStorm > 0.0) {
        float hb = dot(skyLUT(normalize(vec3(d.x, 0.04, d.z))), vec3(0.3333));
        vec3 dust = vec3(1.0, 0.64, 0.36) * hb * 1.1;
        dust += uSunColor * 0.25 * pow(max(dot(d, uSunDir), 0.0), 4.0);
        col = mix(col, dust, clamp(uStorm * 1.3, 0.0, 1.0) * (1.0 - 0.35 * max(d.y, 0.0)));
      }
      return col;
    }
  `
  const dome = makeSkyDome({ uniforms, body, defines: { FOG_SKYLUT: 1 } })
  dome.userData.uniforms = uniforms
  return dome
}
