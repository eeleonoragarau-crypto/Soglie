// Wind-blown sand: streaks hugging the ground near the player, and soft
// spray lifting off the crests further out. All on the GPU, centred on
// whichever camera renders them.

import * as THREE from 'three'
import { heightGLSL } from './terrain.js'
import { noise, fog } from '../../lib/glsl.js'

export function makeDust(terrain, env, { count = 5200, box = 90, wisps = false } = {}) {
  const quad = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.setAttribute('uv', quad.getAttribute('uv'))
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count * 4; i++) seed[i] = Math.random()
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
  geo.instanceCount = count

  const uniforms = {
    ...env.uniforms,
    uHeight: { value: terrain.heightTex },
    uBaked: { value: terrain.baked.texture },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(...terrain.wind) },
    uBox: { value: box },
    uGust: { value: 1 },
    uStorm: { value: 0 },
  }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines, WISPS: wisps ? 1 : 0 },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      precision highp float;
      precision highp sampler2D;
      uniform sampler2D uHeight;
      uniform sampler2D uBaked;
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uBox;
      uniform float uGust;
      uniform float uStorm;
      in vec4 aSeed;
      out vec2 vUv;
      out float vAlpha;
      out vec3 vWorld;
      out float vLift;
      ${heightGLSL}
      ${noise}
      void main() {
        float speed = mix(3.0, 9.0, aSeed.z) * (1.0 + uStorm * 1.5);
        vec2 start = (aSeed.xy - 0.5) * uBox;
        vec2 p = start + uWind * speed * uTime;
        // gusts wander sideways
        p += vec2(-uWind.y, uWind.x) * sin(uTime * 0.7 + aSeed.w * 30.0) * 1.5;
        vec2 c = cameraPosition.xz;
        p = c + mod(p - c + uBox * 0.5, uBox) - uBox * 0.5;
        float h = heightL(p, 0);
        vec4 b = texture(uBaked, bakedUV(p));
        float crest = smoothstep(0.15, 0.9, b.w);
        float lift = pow(aSeed.w, 3.0) * (0.6 + crest * 2.8) + 0.03;
        vec3 wp = vec3(p.x, h + lift, p.y);

        float d = distance(wp, cameraPosition);
        float edge = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d);
        float near = smoothstep(0.8, 3.0, d);
        float gust = smoothstep(0.35, 0.8, vnoise(p * 0.02 - uWind * uTime * 0.18)) * uGust;
        vAlpha = edge * near * mix(0.25, 1.0, crest) * (0.25 + 0.75 * gust + uStorm);

        // stretched along the wind, facing the camera
        vec3 along = normalize(vec3(uWind.x, 0.12 * (aSeed.z - 0.5), uWind.y));
        vec3 toCam = normalize(cameraPosition - wp);
        vec3 side = normalize(cross(along, toCam));
      #if WISPS
        float len = mix(3.0, 9.0, aSeed.z);
        float wid = mix(0.6, 1.6, aSeed.w);
        vAlpha *= 0.12;
      #else
        float len = mix(0.25, 1.4, aSeed.z) * (1.0 + uStorm);
        float wid = mix(0.006, 0.018, aSeed.w) * (1.0 + d * 0.03);
      #endif
        wp += along * position.x * len + side * position.y * wid;
        vUv = uv;
        vWorld = wp;
        vLift = lift;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv;
      in float vAlpha;
      in vec3 vWorld;
      in float vLift;
      out vec4 fragColor;
      uniform float uTime;
      ${fog}
      void main() {
        float x = vUv.x * 2.0 - 1.0;
        float y = vUv.y * 2.0 - 1.0;
        float a = (1.0 - x * x) * (1.0 - y * y);
      #if WISPS
        a *= a;
      #else
        a *= smoothstep(1.0, 0.0, abs(y));
      #endif
        vec3 V = normalize(cameraPosition - vWorld);
        float back = pow(max(dot(-V, uSunDir), 0.0), 5.0);
        vec3 col = vec3(0.86, 0.6, 0.38) * (uSunColor * (0.35 + 2.8 * back) + vec3(0.25, 0.28, 0.35));
        col = applyFog(col, vWorld);
        fragColor = vec4(col, a * vAlpha * 0.55);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 10
  mesh.userData.uniforms = uniforms
  return mesh
}
