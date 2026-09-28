// Portals: a tall door whose front face shows another world, live, from the
// matching eye. Seen from behind it is just a door. Walk through the front
// and you are there.
//
// Local frame of a portal: origin at the threshold centre on the ground,
// +Z = front normal, the opening spans x in [-w/2, w/2], y in [0, h].

import * as THREE from 'three'
import { noise, fog } from '../lib/glsl.js'

const ROT_PI = new THREE.Matrix4().makeRotationY(Math.PI)
const _m = new THREE.Matrix4()
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _plane = new THREE.Plane()
const _q = new THREE.Vector4()
const _c = new THREE.Vector4()
const _frustum = new THREE.Frustum()
const _box = new THREE.Box3()

export const SURFACE_DEPTH = 0.45

export class Portal {
  constructor(world, o) {
    this.world = world
    this.id = o.id
    this.w = o.width ?? 2.6
    this.h = o.height ?? 10.5
    this.color = new THREE.Color(...(o.color || [1, 0.7, 0.4]))
    this.palette = (o.palette || [[0.1, 0.1, 0.2], [0.4, 0.5, 0.8]]).map((c) => new THREE.Vector3(...c))
    this.locked = !!o.locked
    this.keyId = o.keyId || null
    this.open = this.locked ? 0 : 1 // dissolve of the veil
    this.charge = 0 // 0..1 glow of the inlays (have the key / open)
    this.dest = null
    this.liveRange = o.liveRange ?? 150

    this.group = new THREE.Group()
    this.group.position.set(o.x, o.y, o.z)
    this.group.rotation.y = o.yaw || 0
    this.group.updateMatrixWorld(true)
    this.matrix = this.group.matrixWorld.clone()
    this.inv = this.matrix.clone().invert()
    this.normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion)
    this.yaw = o.yaw || 0

    this.virtualCam = new THREE.PerspectiveCamera()
    this.virtualCam.matrixAutoUpdate = true

    const env = world.env
    this.uniforms = {
      ...env.uniforms,
      tView: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uLive: { value: 0 },
      uOpen: { value: this.open },
      uCharge: { value: 0 },
      uColor: { value: this.color },
      uPalB: { value: this.palette[0] },
      uPalT: { value: this.palette[1] },
      uTime: { value: 0 },
      uSize: { value: new THREE.Vector2(this.w, this.h) },
      uNested: { value: 0 },
      uFront: { value: this.normal.clone() },
    }
    const geo = new THREE.BoxGeometry(this.w - 0.02, this.h - 0.01, SURFACE_DEPTH)
    geo.translate(0, this.h / 2, -SURFACE_DEPTH / 2)
    this.surface = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      defines: { ...env.defines },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        out vec3 vLocal;
        out vec3 vWorld;
        void main() {
          vLocal = position;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: surfaceFragment,
    }))
    this.surface.frustumCulled = false
    this.surface.renderOrder = 5
    this.group.add(this.surface)
  }

  link(other) {
    this.dest = other
    other.dest = this
  }

  // one-way: this opening looks into (and leads to) `other`, which keeps its own link
  viewInto(other) {
    this.dest = other
  }

  // where a point in front of this portal maps to behind the destination
  get transfer() {
    return _m.multiplyMatrices(this.dest.matrix, ROT_PI).multiply(this.inv)
  }

  local(p, out = _v) {
    return out.copy(p).applyMatrix4(this.inv)
  }

  // front side and roughly facing the opening
  inFront(p) {
    return this.local(p, _v2).z > 0
  }

  distanceTo(p) {
    return this.local(p, _v2).length()
  }

  onScreen(camera) {
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_m)
    _box.set(_v.set(-this.w / 2, 0, -SURFACE_DEPTH), _v2.set(this.w / 2, this.h, 0.01))
    _box.applyMatrix4(this.matrix)
    return _frustum.intersectsBox(_box)
  }

  // did the eye pass through the opening from front to back?
  crossed(prevEye, eye) {
    if (this.locked || this.open < 0.99 || !this.dest) return false
    const a = this.local(prevEye, _v).clone()
    const b = this.local(eye, _v2)
    if (a.z > 0 && b.z <= 0) {
      const t = a.z / (a.z - b.z)
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      return Math.abs(x) < this.w / 2 && y > -1.5 && y < this.h
    }
    return false
  }

  // render the destination world as seen through this opening
  renderView(renderer, camera, rt, onBefore) {
    const dest = this.dest
    const vc = this.virtualCam
    vc.fov = camera.fov
    vc.aspect = camera.aspect
    vc.near = camera.near
    vc.far = camera.far
    vc.projectionMatrix.copy(camera.projectionMatrix)
    const M = this.transfer
    _m.multiplyMatrices(M, camera.matrixWorld)
    _m.decompose(vc.position, vc.quaternion, vc.scale)
    vc.updateMatrixWorld(true)

    // oblique near plane on the destination threshold
    _plane.setFromNormalAndCoplanarPoint(dest.normal, dest.group.position)
    const distToPlane = _plane.distanceToPoint(vc.position)
    const envU = dest.world.env.uniforms
    envU.uFogClip.value.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant)
    if (distToPlane < -0.06) {
      _plane.applyMatrix4(vc.matrixWorldInverse)
      _c.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant)
      const p = vc.projectionMatrix.elements
      _q.x = (Math.sign(_c.x) + p[8]) / p[0]
      _q.y = (Math.sign(_c.y) + p[9]) / p[5]
      _q.z = -1.0
      _q.w = (1.0 + p[10]) / p[14]
      _c.multiplyScalar(2.0 / _c.dot(_q))
      p[2] = _c.x
      p[6] = _c.y
      p[10] = _c.z + 1.0
      p[14] = _c.w
      vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert()
    }

    dest.surface.visible = false
    const nested = dest.world.portals
    for (const p of nested) p.uniforms.uNested.value = 1
    onBefore?.(dest.world, vc)
    renderer.setRenderTarget(rt)
    renderer.clear()
    renderer.render(dest.world.scene, vc)
    for (const p of nested) p.uniforms.uNested.value = 0
    dest.surface.visible = true
    envU.uFogClip.value.set(0, 0, 0, 0)
  }

  update(dt, t) {
    this.uniforms.uTime.value = t
    this.uniforms.uOpen.value = this.open
    this.uniforms.uCharge.value = this.charge
  }
}

const surfaceFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tView;
  uniform vec2 uRes;
  uniform float uLive;
  uniform float uOpen;
  uniform float uCharge;
  uniform vec3 uColor;
  uniform vec3 uPalB;
  uniform vec3 uPalT;
  uniform float uTime;
  uniform vec2 uSize;
  uniform float uNested;
  uniform vec3 uFront;
  in vec3 vLocal;
  in vec3 vWorld;
  out vec4 fragColor;
  ${noise}
  ${fog}

  void main() {
    vec2 suv = gl_FragCoord.xy / uRes;
    vec2 p = vec2(vLocal.x / uSize.x, vLocal.y / uSize.y); // x -0.5..0.5, y 0..1
    float live = uLive * (1.0 - uNested);

    // far / nested stand-in: the destination's palette, softly luminous
    float g = fbm2(vec2(p.x * 3.0, p.y * 6.0 - uTime * 0.05));
    vec3 stand = mix(uPalB, uPalT, smoothstep(0.0, 1.0, p.y + (g - 0.5) * 0.25));
    stand *= 0.8 + 0.4 * g;

    vec3 view = live > 0.001 ? mix(stand, texture(tView, suv).rgb, live) : stand;

    // the veil: black liquid glass, rippling, the other side barely showing
    vec2 q = vec2(p.x * uSize.x, p.y * uSize.y);
    float n1 = fbm2(q * vec2(0.9, 0.35) + vec2(0.0, uTime * 0.12));
    float n2 = fbm2(q * vec2(1.7, 0.7) - vec2(uTime * 0.07, 0.0) + n1 * 2.0);
    vec2 wob = (vec2(n1, n2) - 0.5) * 0.045;
    vec3 peek = live > 0.001 ? mix(stand, texture(tView, suv + wob).rgb, live) : stand;
    float sheen = pow(smoothstep(0.35, 0.95, n2), 3.0);
    vec3 veil = peek * (live > 0.001 ? 0.14 : 0.05) + vec3(0.003, 0.003, 0.005);
    // liquid black glass: the world in front of it slides across the surface
    vec3 Vv = normalize(cameraPosition - vWorld);
    vec3 Fv = uFront * sign(dot(Vv, uFront) + 1e-4);
    vec3 Tv = normalize(cross(vec3(0.0, 1.0, 0.0), uFront));
    vec3 Nv = normalize(Fv + Tv * (n1 - 0.5) * 0.22 + vec3(0.0, 1.0, 0.0) * (n2 - 0.5) * 0.1);
    vec3 Rv = reflect(-Vv, Nv);
    float fv = 0.04 + 0.96 * pow(1.0 - max(dot(Nv, Vv), 0.0), 5.0);
  #ifdef FOG_SKYLUT
    vec3 envV = skyLUT(normalize(vec3(Rv.x, max(Rv.y, 0.01), Rv.z)));
  #else
    vec3 envV = uFogColor;
  #endif
    envV = mix(uFogColor * 0.2, envV, smoothstep(-0.2, 0.05, Rv.y));
    veil += envV * fv * 0.55;
    veil += uColor * sheen * (0.04 + 0.5 * uCharge);
    // engraved rings around the lock
    vec2 lp = vec2(q.x, q.y - 1.55);
    float lr = length(lp);
    float rings = smoothstep(0.035, 0.0, abs(fract(lr * 1.3 - uTime * 0.12 * uCharge) - 0.5) - 0.44);
    veil += uColor * rings * smoothstep(3.5, 0.2, lr) * (0.08 + 1.6 * uCharge);
    veil += uColor * smoothstep(0.26, 0.0, lr) * (0.3 + 3.0 * uCharge);

    // dissolve from the lock outwards
    float front = uOpen * 14.0 - 1.0;
    float d = lr + (n1 - 0.5) * 1.6;
    float veiled = uOpen >= 0.999 ? 0.0 : smoothstep(front - 0.4, front, d);
    vec3 col = mix(view, veil, veiled);
    float edge = exp(-abs(d - front) * 2.5) * step(0.001, uOpen) * step(uOpen, 0.999);
    col += uColor * edge * 3.5;

    // the air of this world still sits between us and the door
    col = applyFog(col, vWorld);
    fragColor = vec4(col, 1.0);
  }
`
