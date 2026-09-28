// The garden sky: a clean single-scattering atmosphere, and fair-weather
// cumulus raymarched once at load into an equirect texture (flat bases,
// sunlit cauliflower tops, blue-grey bellies, silver edges toward the sun).

import * as THREE from 'three'
import { makeAtmosphere, bakeSkyLUT, skyAmbient } from '../../lib/atmosphere.js'
import { makeSkyDome } from '../../engine/skydome.js'
import { noise, fog } from '../../lib/glsl.js'
import { SUN } from './layout.js'

export function makeGardenAtmosphere() {
  const atmo = makeAtmosphere({ mie: 8e-6, shM: 1.1e3, g: 0.8, mieAbs: [0.86, 0.95, 1.0] })
  const T = atmo.sunTransmittance(...SUN)
  const lut = bakeSkyLUT(atmo, SUN, 256, 128, [0.18, 0.26, 0.12])
  const amb = skyAmbient(atmo, SUN)
  return { atmo, T, lut, amb }
}

const W = 3072
const H = 960

// v in [0,1] maps elevation 0..90 degrees, denser near the horizon
export const skyTexGLSL = /* glsl */ `
  uniform sampler2D uSkyTex;
  vec4 skyTex(vec3 d) {
    float e = asin(clamp(d.y, 0.0, 1.0));
    float v = pow(e / 1.5707963, 0.6667);
    float u = atan(d.z, d.x) * 0.15915494 + 0.5;
    return texture(uSkyTex, vec2(u, v));
  }
`

export function bakeCloudSky(renderer, env) {
  const rt = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...env.uniforms, uRes: { value: new THREE.Vector2(W, H) } },
    defines: { ...env.defines },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec2 uRes;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      out vec4 fragColor;
      ${noise}
      ${fog}
      const float CB = 1350.0;
      const float CT = 3600.0;

      float worley(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        float d = 1.0;
        for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 o = vec3(float(x), float(y), float(z));
          vec3 r = o + hash33(i + o) - f;
          d = min(d, dot(r, r));
        }
        return sqrt(d);
      }

      float coverage(vec2 q) {
        float c = vnoise(q / 3300.0) * 0.55 + vnoise(q / 1300.0 + 7.0) * 0.3 + vnoise(q / 600.0 - 3.0) * 0.15;
        return smoothstep(0.56, 0.86, c);
      }

      float density(vec3 p, bool detail) {
        float hf = (p.y - CB) / (CT - CB);
        if (hf < 0.0 || hf > 1.0) return 0.0;
        float cov = coverage(p.xz);
        if (cov < 0.01) return 0.0;
        // flat base, domed top whose height follows the coverage
        float top = 0.25 + 0.75 * cov;
        float grad = smoothstep(0.0, 0.05, hf) * (1.0 - smoothstep(top * 0.55, top, hf));
        vec3 q = p + vec3(0.0, 0.0, 0.0);
        float shape = fbm3(q / 1100.0);
        float d = cov * grad * 1.25 - (1.0 - shape) * 0.62;
        if (d <= 0.0) return 0.0;
        if (detail) {
          float w = worley(q / 380.0) * 0.6 + worley(q / 150.0) * 0.4;
          d -= w * 0.28 * (0.6 + 0.4 * hf);
        }
        return max(d, 0.0) * 2.4;
      }

      float hg(float mu, float g) {
        float gg = g * g;
        return (1.0 - gg) / (4.0 * 3.14159 * pow(1.0 + gg - 2.0 * g * mu, 1.5));
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        float e = pow(uv.y, 1.5) * 1.5707963;
        float a = (uv.x - 0.5) * 6.2831853;
        vec3 d = vec3(cos(a) * cos(e), sin(e), sin(a) * cos(e));
        vec3 sky = skyLUT(d);
        vec3 ro = vec3(0.0, 30.0, 0.0);
        vec3 L = uSunDir;
        if (d.y < 0.012) { fragColor = vec4(sky, 1.0); return; }
        float t0 = (CB - ro.y) / d.y;
        float t1 = min((CT - ro.y) / d.y, 42000.0);
        if (t0 > 40000.0) { fragColor = vec4(sky, 1.0); return; }
        const int STEPS = 56;
        float dt = (t1 - t0) / float(STEPS);
        float jit = hash12(gl_FragCoord.xy);
        float T = 1.0;
        vec3 acc = vec3(0.0);
        float mu = dot(d, L);
        float ph = mix(hg(mu, 0.72), hg(mu, -0.25), 0.35);
        vec3 horizon = skyLUT(normalize(vec3(d.x, 0.02, d.z)));
        float tFirst = -1.0;
        for (int i = 0; i < STEPS; i++) {
          float t = t0 + (float(i) + jit) * dt;
          vec3 p = ro + d * t;
          float den = density(p, true);
          if (den <= 0.001) continue;
          if (tFirst < 0.0) tFirst = t;
          // light march toward the sun
          float od = 0.0;
          float ls = 70.0;
          vec3 lp = p;
          for (int k = 0; k < 6; k++) {
            lp += L * ls;
            od += density(lp, k < 3) * ls;
            ls *= 1.6;
          }
          float hf = (p.y - CB) / (CT - CB);
          float sig = den * 0.012;
          // multiple scattering by octaves
          vec3 sun = vec3(0.0);
          float aa = 1.0, bb = 1.0, cc = 1.0;
          for (int o = 0; o < 3; o++) {
            sun += aa * uSunColor * exp(-od * 0.012 * bb) * mix(hg(mu, 0.72 * cc), hg(mu, -0.25 * cc), 0.35);
            aa *= 0.5; bb *= 0.4; cc *= 0.5;
          }
          float powder = 1.0 - exp(-den * 2.0);
          vec3 amb = mix(uAmbHorizon * 0.55 + vec3(0.02, 0.03, 0.01), uAmbTop * 1.25, smoothstep(0.0, 0.8, hf));
          vec3 S = (sun * 3.14159 * (0.35 + 0.65 * powder) + amb) * sig;
          float ex = exp(-sig * dt);
          acc += T * (S - S * ex) / max(sig, 1e-6);
          T *= ex;
          if (T < 0.01) break;
        }
        // distant clouds melt into the horizon haze
        float haze = tFirst > 0.0 ? 1.0 - exp(-tFirst / 26000.0) : 0.0;
        vec3 col = sky * T + acc;
        col = mix(col, mix(sky, horizon, 0.6), haze * (1.0 - T) * 0.85);
        fragColor = vec4(col, T);
      }
    `,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  quad.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(quad)
  const cam = new THREE.Camera()
  const prev = renderer.getRenderTarget()
  renderer.setRenderTarget(rt)
  // strips, so no single draw keeps the GPU busy for too long
  const strips = 6
  renderer.setScissorTest(true)
  for (let s = 0; s < strips; s++) {
    const y0 = Math.floor((s / strips) * H)
    const y1 = Math.floor(((s + 1) / strips) * H)
    rt.scissor.set(0, y0, W, y1 - y0)
    rt.scissorTest = true
    renderer.setRenderTarget(rt)
    renderer.render(scene, cam)
  }
  rt.scissorTest = false
  renderer.setScissorTest(false)
  renderer.setRenderTarget(prev)
  quad.geometry.dispose()
  mat.dispose()
  return rt
}

export function makeGardenSky(env, skyRT) {
  const uniforms = {
    ...env.uniforms,
    uSkyTex: { value: skyRT.texture },
    uTime: { value: 0 },
  }
  const body = /* glsl */ `
    uniform float uTime;
    ${noise}
    ${fog}
    ${skyTexGLSL}
    vec3 skyColor(vec3 d) {
      vec3 col;
      float T = 1.0;
      if (d.y >= 0.0) {
        vec4 s = skyTex(d);
        col = s.rgb;
        T = s.a;
      } else {
        col = skyLUT(d);
      }
      float mu = dot(d, uSunDir);
      float disk = smoothstep(0.99983, 0.99991, mu);
      col += uSunColor * (disk * 34.0 + pow(max(mu, 0.0), 1200.0) * 3.0) * T;
      col += uSunColor * pow(max(mu, 0.0), 30.0) * 0.06;
      return col;
    }
  `
  const dome = makeSkyDome({ uniforms, body, defines: { ...env.defines } })
  dome.userData.uniforms = uniforms
  return dome
}
