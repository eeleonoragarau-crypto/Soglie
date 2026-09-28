// Custom lit materials that speak the same lighting language as the terrain:
// sun * worldShadow, hemispherical sky ambient, sky reflections, height fog.

import * as THREE from 'three'
import { noise, fog } from '../lib/glsl.js'

export const litVertex = /* glsl */ `
  out vec3 vWorld;
  out vec3 vNormal;
  out vec3 vObj;
  void main() {
    vec4 p = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      n = mat3(instanceMatrix) * n;
    #endif
    vObj = position;
    vec4 w = modelMatrix * p;
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

// opts: color, color2, rough, metal, bump, scale, emissive, carve (glowing grooves)
export function makeStoneMaterial(env, opts = {}) {
  const o = {
    color: [0.09, 0.075, 0.065],
    color2: [0.16, 0.12, 0.09],
    rough: 0.62,
    bump: 0.35,
    scale: 1.3,
    spec: 0.5,
    emissive: [0, 0, 0],
    sandLine: 0, // warm sand dusting on up-facing surfaces
    ...opts,
  }
  const uniforms = {
    ...env.uniforms,
    ...env.extraUniforms,
    uColor: { value: new THREE.Vector3(...o.color) },
    uColor2: { value: new THREE.Vector3(...o.color2) },
    uRough: { value: o.rough },
    uBump: { value: o.bump },
    uScale: { value: o.scale },
    uSpec: { value: o.spec },
    uEmissive: { value: new THREE.Vector3(...o.emissive) },
    uSandDust: { value: o.sandLine },
  }
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    vertexShader: litVertex,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform vec3 uColor2;
      uniform float uRough;
      uniform float uBump;
      uniform float uScale;
      uniform float uSpec;
      uniform vec3 uEmissive;
      uniform float uSandDust;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      uniform vec3 uAmbGround;
      in vec3 vWorld;
      in vec3 vNormal;
      in vec3 vObj;
      out vec4 fragColor;
      ${noise}
      ${fog}
      ${env.shadowGLSL}

      float tri(vec3 p, vec3 n) {
        vec3 w = abs(n); w /= (w.x + w.y + w.z);
        return vnoise(p.yz) * w.x + vnoise(p.xz) * w.y + vnoise(p.xy) * w.z;
      }
      void main() {
        vec3 N = normalize(vNormal);
        vec3 p = vWorld * uScale;
        // detail fades with distance so big faces stay calm instead of shimmering
        float camD = length(cameraPosition - vWorld);
        float near1 = 1.0 - smoothstep(30.0, 140.0, camD);
        float near2 = 1.0 - smoothstep(8.0, 40.0, camD);
        float n1 = tri(p, N);
        float n2 = mix(0.5, tri(p * 4.1 + 3.0, N), near1);
        float n3 = mix(0.5, tri(p * 17.0 + 9.0, N), near2);
        // bump from screen-space derivatives of a height made of the noises
        float hgt = n1 * 0.6 + n2 * 0.3 + n3 * 0.1;
        vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
        float hx = dFdx(hgt), hy = dFdy(hgt);
        vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
        float det = dot(dpx, r1);
        vec3 grad = sign(det) * (hx * r1 + hy * r2);
        N = normalize(abs(det) * N - grad * uBump * 0.6 * near1);

        vec3 alb = mix(uColor, uColor2, smoothstep(0.25, 0.8, n1 * 0.7 + n2 * 0.3));
        alb *= 0.85 + 0.3 * n3;
        // wind-blown sand settling on up-facing faces
        float dust = smoothstep(0.55, 0.95, N.y) * uSandDust * smoothstep(0.35, 0.65, n2);
        alb = mix(alb, vec3(0.72, 0.45, 0.24), dust);

        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = uSunDir;
        vec3 H = normalize(L + V);
        float sh = worldShadow(vWorld);
        float ndl = max(dot(N, L), 0.0);
        float r = clamp(uRough, 0.05, 1.0);
        float a2 = r * r * r * r;
        float ndh = max(dot(N, H), 0.0);
        float dd = ndh * ndh * (a2 - 1.0) + 1.0;
        float D = a2 / (3.14159 * dd * dd);
        float F = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
        vec3 spec = uSunColor * D * F * ndl * 0.25 * uSpec;
        vec3 amb = N.y > 0.0 ? mix(uAmbHorizon, uAmbTop, N.y) : mix(uAmbHorizon, uAmbGround, -N.y);
        vec3 col = alb * (uSunColor * ndl * sh + amb) + spec * sh;
        float fr = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
      #ifdef FOG_SKYLUT
        vec3 envC = skyLUT(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
      #else
        vec3 envC = mix(uAmbHorizon, uAmbTop, max(R.y, 0.0));
      #endif
        envC = mix(uAmbGround, envC, smoothstep(-0.25, 0.05, R.y));
        col += envC * (0.02 + 0.5 * fr) * (1.0 - r) * uSpec;
        col += uEmissive;
        col = applyFog(col, vWorld);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
}

// Unlit glowing material, fogged, with an optional vertical fade.
export function makeGlowMaterial(env, { color = [1, 0.8, 0.5], intensity = 4, additive = false, fade = 0, opacity = 1 } = {}) {
  const uniforms = {
    ...env.uniforms,
    uGlow: { value: new THREE.Vector3(...color) },
    uIntensity: { value: intensity },
    uFade: { value: fade },
    uOpacity: { value: opacity },
  }
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines },
    transparent: additive || opacity < 1,
    depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: litVertex,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uGlow;
      uniform float uIntensity;
      uniform float uFade;
      uniform float uOpacity;
      in vec3 vWorld;
      in vec3 vNormal;
      in vec3 vObj;
      out vec4 fragColor;
      ${fog}
      void main() {
        vec3 col = uGlow * uIntensity;
        float f = 1.0;
        if (uFade > 0.0) f = 1.0 - smoothstep(0.0, uFade, vObj.y);
        vec3 rd;
        float fa = fogFrom(vWorld, rd);
        fragColor = vec4(col * (1.0 - fa) * f * uOpacity * mirrorDim(vWorld), uOpacity * f);
      }
    `,
  })
}
