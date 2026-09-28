// Far blue mountains all around the valley: a ring of ridged ranges a few
// kilometres out, forested at the foot, snow on the high shoulders, left to
// the haze to turn them blue.

import * as THREE from 'three'
import { makeNoise2D } from '../../lib/noise.js'
import { noise, fog } from '../../lib/glsl.js'

export function makeMountains(env) {
  const A = 360, RR = 12
  const r0 = 1700, r1 = 6000
  const n1 = makeNoise2D(211), n2 = makeNoise2D(223), n3 = makeNoise2D(227)
  const ridge = (n, x, y) => 1 - Math.abs(n(x, y))
  const pos = [], idx = []
  for (let j = 0; j <= RR; j++) {
    const t = j / RR
    const r = r0 + (r1 - r0) * Math.pow(t, 0.85)
    for (let i = 0; i < A; i++) {
      const a = (i / A) * Math.PI * 2
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      // envelope: rises from under the plain, peaks mid-ring, falls away behind
      const env0 = Math.sin(Math.PI * Math.min(1, t * 1.25)) * (t < 0.08 ? t / 0.08 : 1)
      let h = 0
      h += Math.pow(ridge(n1, x / 2600, z / 2600), 1.5) * 420
      h += Math.pow(ridge(n2, x / 1100, z / 1100), 1.6) * 150
      h += n3(x / 420, z / 420) * 35
      // a nobler range behind the upward fall
      const toward = Math.max(0, Math.cos(a - Math.PI / 2 - 0.25))
      h *= 0.6 + 0.5 * Math.pow(toward, 2)
      h = h * env0 - 60 + 40 * t
      pos.push(x, h, z)
    }
  }
  for (let j = 0; j < RR; j++) {
    for (let i = 0; i < A; i++) {
      const i1 = (i + 1) % A
      const a = j * A + i, b = j * A + i1, c = (j + 1) * A + i, d = (j + 1) * A + i1
      idx.push(a, c, b, b, c, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...env.uniforms },
    defines: { ...env.defines },
    vertexShader: /* glsl */ `
      out vec3 vWorld;
      out vec3 vN;
      void main() {
        vWorld = position;
        vN = normal;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      in vec3 vWorld;
      in vec3 vN;
      out vec4 fragColor;
      ${noise}
      ${fog}
      void main() {
        vec3 N = normalize(vN);
        float n = vnoise(vWorld.xz * 0.012) * 0.6 + vnoise(vWorld.xz * 0.05) * 0.4;
        float h = vWorld.y + n * 50.0;
        vec3 forest = vec3(0.03, 0.06, 0.03);
        vec3 rock = vec3(0.16, 0.15, 0.15);
        vec3 snow = vec3(0.8, 0.83, 0.88);
        vec3 alb = mix(forest, rock, smoothstep(140.0, 300.0, h));
        float snowK = smoothstep(330.0, 420.0, h + N.y * 90.0) * smoothstep(0.35, 0.65, N.y + n * 0.2);
        alb = mix(alb, snow, snowK);
        float ndl = max(dot(N, uSunDir), 0.0);
        vec3 col = alb * (uSunColor * ndl + mix(uAmbHorizon, uAmbTop, N.y * 0.5 + 0.5) * 0.8);
        col = applyFog(col, vWorld);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  return mesh
}
