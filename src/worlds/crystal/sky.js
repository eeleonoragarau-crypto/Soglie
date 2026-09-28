// Dawn over the salt. One analytic base (gradient, belt of Venus, sun glow)
// is baked into the sky LUT that tints the fog and every reflection, and the
// dome adds clouds, rays, moons and the disc on top of the very same base, so
// the horizon, the haze and the mirror of the salt always agree.

import * as THREE from 'three'
import { makeSkyDome } from '../../engine/skydome.js'
import { noise } from '../../lib/glsl.js'

export const skyBaseGLSL = /* glsl */ `
vec3 skyBase(vec3 d) {
  float y = clamp(d.y, 0.0, 1.0);
  vec3 S = uSunDir;
  float m = max(dot(d, S), 0.0);
  vec2 dh = d.xz / max(length(d.xz), 1e-4);
  vec2 sh = normalize(S.xz);
  float side = dot(dh, sh);            // 1 toward the sun, -1 away from it
  float w = 0.5 + 0.5 * side;
  float away = smoothstep(0.1, -0.9, side);

  vec3 horSun = vec3(1.05, 0.64, 0.44);
  vec3 horMid = vec3(0.72, 0.47, 0.5);
  vec3 horAway = vec3(0.36, 0.34, 0.5);
  vec3 hor = mix(horMid, horSun, smoothstep(0.35, 1.0, w));
  hor = mix(hor, horAway, away);
  vec3 mid = mix(vec3(0.3, 0.27, 0.48), vec3(0.56, 0.38, 0.46), smoothstep(0.3, 1.0, w));
  vec3 zen = vec3(0.1, 0.12, 0.3);

  vec3 col = mix(hor, mid, smoothstep(0.0, 0.2, y));
  col = mix(col, zen, smoothstep(0.14, 0.9, y));
  // the belt of Venus over the earth's shadow, opposite the sun
  float belt = exp(-pow((y - 0.12) / 0.07, 2.0));
  col = mix(col, vec3(0.66, 0.38, 0.5), belt * away * 0.8);
  col = mix(col, vec3(0.28, 0.28, 0.44), smoothstep(0.07, 0.0, y) * away * 0.5);
  // the aureole
  col += uSunColor * (0.018 * pow(m, 3.0) + 0.09 * pow(m, 14.0) + 0.3 * pow(m, 110.0));
  return col;
}
`

// Render skyBase into an equirect LUT with the mapping of skyUV() in glsl.js.
export function bakeSkyLUT(renderer, uniforms, w = 256, h = 128) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  })
  rt.texture.wrapS = THREE.RepeatWrapping
  rt.texture.wrapT = THREE.ClampToEdgeWrapping
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      in vec2 vUv;
      out vec4 fragColor;
      ${skyBaseGLSL}
      void main() {
        float a = (vUv.x - 0.5) * 6.2831853;
        float q = (vUv.y - 0.5) * 2.0;
        float y = sign(q) * q * q;
        float r = sqrt(max(0.0, 1.0 - y * y));
        vec3 d = vec3(cos(a) * r, max(y, 0.012), sin(a) * r);
        fragColor = vec4(skyBase(normalize(d)), 1.0);
      }
    `,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  quad.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(quad)
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const prev = renderer.getRenderTarget()
  renderer.setRenderTarget(rt)
  renderer.render(scene, cam)
  renderer.setRenderTarget(prev)
  quad.geometry.dispose()
  mat.dispose()
  return rt.texture
}

export function makeCrystalSky(env) {
  const u = {
    ...env.uniforms,
    uTime: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(-0.56, 0.3, -0.77).normalize() },
    uMoon2Dir: { value: new THREE.Vector3(0.6, 0.5, 0.62).normalize() },
  }
  const body = /* glsl */ `
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uTime;
    uniform vec3 uMoonDir;
    uniform vec3 uMoon2Dir;
    ${noise}
    ${skyBaseGLSL}

    // a pale moon: only its lit part adds to the sky
    vec3 moon(vec3 d, vec3 md, float r, float sharp, out float cover) {
      cover = 0.0;
      float b = dot(d, md);
      float disc = b * b - (1.0 - r * r);
      if (disc <= 0.0 || b <= 0.0) return vec3(0.0);
      float t = b - sqrt(disc);
      vec3 n = normalize(d * t - md);
      float lit = smoothstep(-0.02, sharp, dot(n, uSunDir));
      float maria = smoothstep(0.44, 0.64, fbm3(n * 2.4 + 1.7));
      vec3 alb = mix(vec3(1.0, 0.97, 0.99), vec3(0.74, 0.72, 0.84), maria * 0.75);
      alb *= 0.9 + 0.2 * vnoise3(n * 14.0);
      cover = smoothstep(0.0, 0.0025, disc);
      return alb * lit;
    }

    vec3 stars(vec3 d) {
      vec3 p = d * 260.0;
      vec3 c = floor(p);
      vec3 f = fract(p) - 0.5;
      float h = hash13(c);
      if (h < 0.985) return vec3(0.0);
      vec3 o = hash33(c + 3.1) - 0.5;
      float b = smoothstep(0.14, 0.0, length(f - o * 0.5)) * (h - 0.985) / 0.015;
      return vec3(0.9, 0.9, 1.0) * b * (0.7 + 0.3 * sin(uTime * (1.0 + h * 5.0) + h * 90.0));
    }

    vec3 skyColor(vec3 d) {
      float y = d.y;
      vec3 dd = normalize(vec3(d.x, max(y, 0.012), d.z));
      vec3 col = skyBase(dd);
      float m = max(dot(d, uSunDir), 0.0);
      float up = smoothstep(0.004, 0.05, y);
      vec2 dh = d.xz / max(length(d.xz), 1e-4);
      float side = dot(dh, normalize(uSunDir.xz));

      // faint stars still hanging over the dark side
      col += stars(d) * smoothstep(0.35, 0.85, y) * smoothstep(0.1, -0.7, side) * 0.35;

      // crepuscular rays fanning up from the low sun
      vec3 e1 = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
      vec3 e2 = cross(e1, uSunDir);
      vec2 q = vec2(dot(d, e1), dot(d, e2));
      vec2 qa = q / max(length(q), 1e-4);
      float rays = vnoise(qa * 6.0 + 3.0) * 0.55 + vnoise(qa * 17.0 + 11.0) * 0.45;
      float fan = pow(m, 4.0) * smoothstep(-0.2, 0.3, qa.y);
      col += uSunColor * 0.07 * (rays - 0.42) * fan * up;

      // moons
      float c1, c2;
      vec3 m1 = moon(d, uMoonDir, 0.052, 0.3, c1);
      col = mix(col, col * 0.93 + m1 * vec3(0.95, 0.9, 1.0) * 0.55, c1);
      vec3 m2 = moon(d, uMoon2Dir, 0.02, 0.06, c2);
      col = mix(col, col + m2 * 0.75, c2);

      // the sun, flattened a little by the horizon, veiled by haze
      vec3 sd = d - uSunDir;
      sd.y *= 1.18;
      float r = length(sd);
      float disc = smoothstep(0.0115, 0.0088, r);
      col += uSunColor * vec3(1.0, 0.86, 0.72) * (disc * 14.0 + pow(m, 1600.0) * 2.0) * smoothstep(0.0, 0.02, y);

      // cloud banks low over the horizon
      float t1 = 1.0 / (y + 0.04);
      vec2 p1 = d.xz * t1;
      vec2 wind = vec2(uTime * 0.0035, uTime * 0.0012);
      float n1 = fbm2(vec2(p1.x * 0.28, p1.y * 0.28) * mat2(0.9, -0.4, 0.4, 0.9) * vec2(1.0, 2.6) + wind + 4.0);
      float band = smoothstep(0.012, 0.045, y) * (1.0 - smoothstep(0.1, 0.24, y));
      float dens1 = smoothstep(0.5, 0.8, n1) * band;
      // high veils and ripples, lit from below by the low sun
      float t2 = 1.0 / (y + 0.16);
      vec2 p2 = d.xz * t2;
      float n2 = fbm2(p2 * vec2(0.9, 2.4) * mat2(0.8, -0.6, 0.6, 0.8) + wind * 3.0 + 9.0);
      float rip = 0.6 + 0.4 * sin(dot(p2, vec2(9.0, 5.0)) + n2 * 6.0);
      float dens2 = smoothstep(0.54, 0.86, n2) * rip * smoothstep(0.05, 0.2, y) * (1.0 - smoothstep(0.55, 0.95, y)) * 0.55;

      float fs = pow(m, 6.0);
      float away = smoothstep(0.1, -0.9, side);
      vec3 litC = mix(vec3(0.95, 0.56, 0.52), vec3(0.72, 0.45, 0.6), away);
      vec3 shdC = mix(vec3(0.46, 0.3, 0.38), vec3(0.3, 0.27, 0.44), away);
      vec3 c1c = mix(litC, shdC, smoothstep(0.55, 1.0, n1) * 0.8) + uSunColor * fs * (0.5 - 0.3 * dens1);
      vec3 c2c = mix(litC * 1.05, shdC * 1.1, 0.35) + uSunColor * fs * 0.4;
      col = mix(col, c2c, dens2);
      col = mix(col, c1c, dens1 * 0.85);
      return col;
    }
  `
  const dome = makeSkyDome({ uniforms: u, body })
  dome.userData.u = u
  return dome
}
