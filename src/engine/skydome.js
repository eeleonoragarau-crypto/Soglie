import * as THREE from 'three'

// Camera-centred sky sphere pinned to the far plane. `body` must define
// vec3 skyColor(vec3 dir). Works for any camera, including portal eyes.
export function makeSkyDome({ uniforms, body, defines = {} }) {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      out vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 1000.0, 1.0);
        gl_Position = p.xyww;
        gl_Position.z = p.w * 0.99999;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vDir;
      out vec4 fragColor;
      ${body}
      void main() { fragColor = vec4(skyColor(normalize(vDir)), 1.0); }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  return mesh
}
