// Hexagonal crystals. One unit geometry (a six-sided prism with a pointed
// termination at both ends) is shaped per instance in the vertex shader, so
// the tip keeps the angle of real quartz whatever the length. The fragment
// shader fakes a thick transparent body: a real two-interface refraction
// through the hexagonal slab (with total internal reflection), Beer tinting,
// ghost "phantom" crystals and moving caustic veins marched inside, a thin
// film on the faces, a fresnel rim and crisp lit edges.

import * as THREE from 'three'
import { noise, fog } from '../../lib/glsl.js'

// -------------------------------------------------------------- geometry
export function prismGeometry() {
  const pos = [], nrm = [], part = [], edge = []
  const corner = (i) => {
    const a = (i % 6) * (Math.PI / 3)
    return [Math.cos(a), Math.sin(a)]
  }
  const faceDir = (i) => {
    const a = (i % 6) * (Math.PI / 3) + Math.PI / 6
    return [Math.cos(a), 0, Math.sin(a)]
  }
  const push = (p, n, k, e) => { pos.push(...p); nrm.push(...n); part.push(k); edge.push(...e) }
  // add a triangle, fixing the winding so it faces along `out`
  const tri = (a, b, c, n, k, ea, eb, ec, out) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
    if (cr[0] * out[0] + cr[1] * out[1] + cr[2] * out[2] < 0) { push(a, n, k, ea); push(c, n, k, ec); push(b, n, k, eb) }
    else { push(a, n, k, ea); push(b, n, k, eb); push(c, n, k, ec) }
  }
  for (let i = 0; i < 6; i++) {
    const [x0, z0] = corner(i), [x1, z1] = corner(i + 1)
    const n = faceDir(i)
    // body quad: aEdge = (u, 1-u, v, 1-v)
    const b0 = [x0, 0, z0], b1 = [x1, 0, z1], t0 = [x0, 1, z0], t1 = [x1, 1, z1]
    tri(b0, b1, t1, n, 0, [0, 1, 0, 1], [1, 0, 0, 1], [1, 0, 1, 0], n)
    tri(b0, t1, t0, n, 0, [0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 1, 0], n)
    // top termination: ring at y=0 (+ H), apex at y=1 (x K R); aEdge = barycentric
    const up = [n[0], 0.8, n[2]]
    tri([x0, 0, z0], [x1, 0, z1], [0, 1, 0], n, 1, [1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1], up)
    // bottom termination (hidden under the salt, seen on floating crystals)
    const dn = [n[0], -0.8, n[2]]
    tri([x0, 0, z0], [x1, 0, z1], [0, -1, 0], n, 2, [1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1], dn)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1))
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 4))
  return g
}

// -------------------------------------------------------------- instancing
// Each crystal: { x, y, z, R, H, K, taper, yaw, tiltX, tiltZ, tint:[r,g,b],
//   glow, type, a, b, c, seed }
// type 0 static, 1 resonant (a = index), 2 petal (a,b = outward xz, c = lean),
// 3 floating (a = spin, b = bob phase, c = bob amplitude)
export function makeInstanced(geo, mat, list) {
  const n = list.length
  const ig = new THREE.InstancedBufferGeometry()
  ig.index = null
  for (const k of ['position', 'normal', 'aPart', 'aEdge']) ig.setAttribute(k, geo.getAttribute(k))
  const shape = new Float32Array(n * 4)
  const tint = new Float32Array(n * 4)
  const anim = new Float32Array(n * 4)
  const seed = new Float32Array(n)
  const mesh = new THREE.InstancedMesh(ig, mat, n)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const one = new THREE.Vector3(1, 1, 1)
  const p = new THREE.Vector3()
  list.forEach((c, i) => {
    shape.set([c.R, c.H, c.K ?? 1.1, c.taper ?? 0.94], i * 4)
    tint.set([...(c.tint || [1, 1, 1]), c.glow ?? 0], i * 4)
    anim.set([c.type ?? 0, c.a ?? 0, c.b ?? 0, c.c ?? 0], i * 4)
    seed[i] = c.seed ?? Math.random()
    if (c.q) q.copy(c.q)
    else q.setFromEuler(e.set(c.tiltX ?? 0, c.yaw ?? 0, c.tiltZ ?? 0, 'YXZ'))
    m.compose(p.set(c.x, c.y, c.z), q, one)
    mesh.setMatrixAt(i, m)
  })
  ig.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4))
  ig.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 4))
  ig.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 4))
  ig.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1))
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  return mesh
}

// -------------------------------------------------------------- material
const vertex = /* glsl */ `
  in float aPart;
  in vec4 aEdge;
  in vec4 aShape;
  in vec4 aTint;
  in vec4 aAnim;
  in float aSeed;
  uniform float uTime;
  uniform float uOpen;
  out vec3 vWorld;
  out vec3 vN;
  out vec3 vLocal;
  out vec3 vLocalCam;
  out vec3 vLocalN;
  out vec4 vEdge;
  flat out vec4 vShape;
  flat out vec4 vTint;
  flat out vec4 vAnim;
  flat out float vSeed;
  flat out vec3 vM0;
  flat out vec3 vM1;
  flat out vec3 vM2;

  mat3 rotAxis(vec3 a, float ang) {
    float s = sin(ang), c = cos(ang), oc = 1.0 - c;
    return mat3(
      oc * a.x * a.x + c,       oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
      oc * a.x * a.y - a.z * s, oc * a.y * a.y + c,       oc * a.y * a.z + a.x * s,
      oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
  }

  void main() {
    float R = aShape.x, H = aShape.y, K = aShape.z, tp = aShape.w;
    vec3 p = position;
    vec3 n = normal;
    vec3 lp, ln;
    if (aPart < 0.5) {
      float rad = R * mix(1.0, tp, p.y);
      lp = vec3(p.x * rad, p.y * H, p.z * rad);
      ln = normalize(n * H + vec3(0.0, R * (1.0 - tp) * 0.866, 0.0));
    } else if (aPart < 1.5) {
      float rt = R * tp;
      lp = vec3(p.x * rt, H + p.y * K * rt, p.z * rt);
      ln = normalize(n * K + vec3(0.0, 0.866, 0.0));
    } else {
      lp = vec3(p.x * R, p.y * K * R, p.z * R);
      ln = normalize(n * K - vec3(0.0, 0.866, 0.0));
    }
    mat3 IM = mat3(instanceMatrix);
    vec3 T = instanceMatrix[3].xyz;
    mat3 M = IM;
    float type = aAnim.x;
    if (type > 1.5 && type < 2.5) {
      // petal of the great crystal: leans outward about its root
      vec3 o = normalize(vec3(aAnim.y, 0.0, aAnim.z));
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), o));
      M = rotAxis(ax, uOpen * aAnim.w) * IM;
      T.y -= uOpen * R * 0.4;
    } else if (type > 2.5) {
      // floating: turns on its long axis, breathes up and down
      M = IM * rotAxis(vec3(0.0, 1.0, 0.0), uTime * aAnim.y + aSeed * 6.28);
      T.y += sin(uTime * 0.19 + aAnim.z * 6.28) * aAnim.w;
    }
    vec3 wp = T + M * lp;
    vWorld = (modelMatrix * vec4(wp, 1.0)).xyz;
    vN = normalize(M * ln);
    vLocal = lp;
    vLocalN = ln;
    vLocalCam = transpose(M) * (cameraPosition - T);
    vEdge = aEdge;
    vShape = aShape;
    vTint = aTint;
    vAnim = aAnim;
    vSeed = aSeed;
    vM0 = M[0]; vM1 = M[1]; vM2 = M[2];
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`

const fragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uSaltLit;
  uniform vec3 uAmbTop;
  uniform vec3 uAmbHorizon;
  uniform vec4 uWake[3];      // x: awake 0..1, y: breathing glow, z: flash
  uniform vec3 uWakeCol[3];
#ifdef HEART
  uniform vec3 uKeyPos;
  uniform vec3 uKeyCol;
  uniform float uFront;       // dissolve front, local y
  uniform float uHeartGlow;
#endif
  in vec3 vWorld;
  in vec3 vN;
  in vec3 vLocal;
  in vec3 vLocalCam;
  in vec3 vLocalN;
  in vec4 vEdge;
  flat in vec4 vShape;
  flat in vec4 vTint;
  flat in vec4 vAnim;
  flat in float vSeed;
  flat in vec3 vM0;
  flat in vec3 vM1;
  flat in vec3 vM2;
  out vec4 fragColor;
  ${noise}
  ${fog}

  vec3 envColor(vec3 d) {
    vec3 sky = skyLUT(normalize(vec3(d.x, max(d.y, 0.012), d.z)));
    return mix(sky, uSaltLit, smoothstep(0.0, -0.2, d.y));
  }

  // what the body sees through itself: the same world, more contrast
  vec3 envT(vec3 d) {
    vec3 sky = skyLUT(normalize(vec3(d.x, max(d.y, 0.012), d.z)));
    float up = smoothstep(0.0, 0.7, d.y);
    sky *= mix(1.0, 0.55, up);
    vec3 below = uSaltLit * mix(1.0, 0.35, smoothstep(-0.05, -0.6, d.y));
    vec3 c = mix(sky, below, smoothstep(0.0, -0.06, d.y));
    c += skyLUT(normalize(vec3(d.x, 0.02, d.z))) * exp(-abs(d.y) * 30.0) * 0.9;
    return c;
  }

  // hexagon with corners at 0, 60, ... degrees; 1.0 on a unit circumradius
  const vec2 HN0 = vec2(0.8660254, 0.5);
  const vec2 HN1 = vec2(0.0, 1.0);
  const vec2 HN2 = vec2(-0.8660254, 0.5);
  float hexD(vec2 q) {
    return max(max(abs(dot(q, HN0)), abs(dot(q, HN1))), abs(dot(q, HN2))) / 0.8660254;
  }

  vec3 thinFilm(float c, float d) {
    float n = 1.42;
    float st2 = (1.0 - c * c) / (n * n);
    float opd = 2.0 * n * d * sqrt(max(1.0 - st2, 0.0));
    return 0.5 + 0.5 * cos(6.2831853 * opd / vec3(650.0, 540.0, 450.0));
  }

  void main() {
    float R = vShape.x, H = vShape.y, K = vShape.z, tp = vShape.w;
    vec3 tint = vTint.rgb;
    float glow = vTint.w;
    vec3 gcol = tint;
    float wakeFlash = 0.0;
    if (vAnim.x > 0.5 && vAnim.x < 1.5) {
      int wi = int(vAnim.y + 0.5);
      vec4 w = uWake[wi];
      glow = glow * (0.35 + w.y * 2.2 + w.x * 3.2);
      wakeFlash = w.z + w.y * 0.25 + w.x * 0.2;
      gcol = uWakeCol[wi];
    }
    float front = 1e4;
#ifdef HEART
    front = uFront + (vnoise(vLocal.xz * 0.35 + vSeed * 9.0) - 0.5) * 3.0;
    if (vLocal.y > front) discard;
#endif

    vec3 N = normalize(vN);
    vec3 lN = normalize(vLocalN);
    if (!gl_FrontFacing) { N = -N; lN = -lN; }
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    mat3 M = mat3(vM0, vM1, vM2);
    vec3 L = uSunDir;

    // ---- two interfaces through the hexagonal slab
    vec3 lV = normalize(vLocal - vLocalCam);
    vec3 lT = refract(lV, lN, 1.0 / 1.55);
    if (dot(lT, lT) < 0.01) lT = lV;
    float yl = clamp(vLocal.y / H, 0.0, 1.0);
    float rad = R * mix(1.0, tp, yl);
    float ap = rad * 0.8660254;
    float tEx = 4.0 * R;
    vec3 nEx = vec3(0.0, 1.0, 0.0);
    for (int k = 0; k < 3; k++) {
      vec2 hn = k == 0 ? HN0 : (k == 1 ? HN1 : HN2);
      vec3 nk = vec3(hn.x, 0.0, hn.y);
      float dn = dot(lT, nk);
      if (abs(dn) < 1e-4) continue;
      float t = (sign(dn) * ap - dot(vLocal, nk)) / dn;
      if (t > 1e-3 && t < tEx) { tEx = t; nEx = sign(dn) * nk; }
    }
    float tipTop = H + K * R * tp;
    if (lT.y > 1e-4) {
      float t = (tipTop - vLocal.y) / lT.y;
      if (t > 1e-3 && t < tEx) { tEx = t; nEx = normalize(vec3(lT.x, 1.2, lT.z)); }
    }
    vec3 lE = refract(lT, -nEx, 1.55);
    float tir = 0.0;
    if (dot(lE, lE) < 0.01) { lE = reflect(lT, -nEx); tir = 1.0; }
    vec3 wE = normalize(M * lE);

    // Beer: thicker paths drink more of the complementary colour
    vec3 absorb = exp(-(1.0 - tint) * (tEx / R) * 2.4) * mix(1.0, 0.72, smoothstep(0.5, 2.0, tEx / R));
    vec3 trans = envT(wE) * absorb;
    trans += uSunColor * absorb * (pow(max(dot(wE, L), 0.0), 220.0) * 3.0 + pow(max(dot(wE, L), 0.0), 18.0) * 0.12);
    trans *= 1.0 + tir * 0.5;

    // ---- inside: phantoms and caustic veins along the refracted ray
    float ph = 0.0, vein = 0.0, core = 0.0;
    float t0 = uTime * 0.12 + vSeed * 20.0;
    for (int i = 0; i < 5; i++) {
      float t = (float(i) + 0.5) / 5.0 * tEx;
      vec3 q = vLocal + lT * t;
      float rq = R * mix(1.0, tp, clamp(q.y / H, 0.0, 1.0));
      float hd = hexD(q.xz / rq);
      float tipK = max(q.y - H * 0.78, 0.0) / (K * rq);
      float g1 = hd + tipK * 1.2;
      float g2 = hd + max(q.y - H * 0.9, 0.0) / (K * rq);
      ph += exp(-abs(g1 - 0.56) * 34.0) + 0.7 * exp(-abs(g2 - 0.8) * 46.0);
      float wv = vnoise3(q * (0.9 / R) + vec3(0.0, t0, vSeed * 7.0));
      float vmask = smoothstep(0.45, 0.75, vnoise3(q * (0.35 / R) + vSeed * 3.0));
      vein += pow(1.0 - abs(sin(q.y * (1.3 / R) + dot(q.xz, vec2(0.7, -0.4)) / R + wv * 3.0 - t0 * 2.0)), 48.0) * vmask;
      core += exp(-hd * hd * 5.0);
    }
    float seg = tEx / (5.0 * R);
    ph *= seg;
    vein *= seg;
    core *= seg;
    float fwd = pow(max(dot(-V, L), 0.0), 6.0);
    vec3 Lint = uAmbTop * 0.55 + uAmbHorizon * 0.25 + uSunColor * (0.05 + 0.5 * fwd);
    vec3 deep = mix(vec3(1.0), tint * tint, 0.8);
    vec3 inner = ph * 0.2 * Lint * mix(vec3(1.0), tint, 0.6);
    inner += vein * (Lint * 0.3 + uSunColor * (0.05 + 0.35 * fwd)) * deep;
    inner += gcol * core * glow * 0.9 * (0.5 + 0.8 * vein);
    if (vAnim.x > 0.5 && vAnim.x < 1.5) inner += gcol * gcol * glow * (0.18 + 0.5 * ph + 0.6 * vein);

    // ---- surface
    float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    vec3 Rw = reflect(-V, N);
    float film = 320.0 + 300.0 * vnoise3(vLocal * (0.5 / R) + vSeed * 13.0);
    vec3 irid = mix(vec3(1.0), thinFilm(ndv, film) * 1.5, 0.75);
    vec3 refl = envColor(Rw) * irid;
    float rs = max(dot(Rw, L), 0.0);
    vec3 spec = uSunColor * (pow(rs, 900.0) * 30.0 + pow(rs, 40.0) * 0.5) * irid;

    // crisp edges catching the light
    vec4 fw = fwidth(vEdge) + 1e-5;
    vec4 px = vEdge / fw;
    float ed = min(min(px.x, px.y), min(px.z, px.w));
    float mpp = length(fwidth(vWorld)) + 1e-5;
    float wpx = clamp(0.03 * R / mpp, 0.7, 2.6);
    float edge = 1.0 - smoothstep(wpx * 0.45, wpx, ed);
    vec3 edgeC = (envColor(normalize(N + vec3(0.0, 0.6, 0.0))) * 0.9 + uSunColor * (0.12 + 0.8 * fwd)) * mix(vec3(1.0), tint, 0.3);

    vec3 col = trans * (1.0 - F) + inner + (refl + spec) * F + spec * 0.08;
    col += edgeC * edge * (0.55 + 0.6 * F);
    col += gcol * wakeFlash * (0.6 + edge * 3.0);

#ifdef HEART
    // the key sleeps inside: a light on the ray, refracted a little
    vec3 rd = normalize(vWorld - cameraPosition);
    vec3 wT = normalize(M * lT);
    vec3 kp = uKeyPos - vWorld;
    float along = max(dot(kp, wT), 0.0);
    float kd = length(kp - wT * along);
    float halo = exp(-kd * kd * 0.018) * 0.7 + exp(-kd * kd * 0.25) * 0.55 + exp(-kd * 0.1) * 0.18;
    col += uKeyCol * halo * uHeartGlow * absorb;
    float band = exp(-abs(vLocal.y - front) * 0.9);
    col += (uKeyCol * 3.0 + vec3(2.0)) * band * step(front, 1e3);
    col = applyFog(col, vWorld);
    // see-through: more where the key is
    float a = clamp(0.24 + 0.55 * exp(-kd * kd * 0.05) * uHeartGlow, 0.0, 0.85) * (1.0 - F * 0.7);
    fragColor = vec4(col * (1.0 - a * 0.6), a);
#else
    col = applyFog(col, vWorld);
    fragColor = vec4(col, 1.0);
#endif
  }
`

export function makeCrystalMaterial(env, extra = {}, heart = false) {
  const uniforms = {
    ...env.uniforms,
    uTime: { value: 0 },
    uOpen: { value: 0 },
    uSaltLit: { value: new THREE.Vector3(0.9, 0.78, 0.82) },
    uWake: { value: [0, 1, 2].map(() => new THREE.Vector4(0, 1, 0, 0)) },
    uWakeCol: { value: [0, 1, 2].map(() => new THREE.Vector3(1, 1, 1)) },
    ...extra,
  }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    defines: { ...env.defines, ...(heart ? { HEART: 1 } : {}) },
    vertexShader: vertex,
    fragmentShader: fragment,
  })
  if (heart) {
    mat.transparent = true
    mat.blending = THREE.CustomBlending
    mat.blendEquation = THREE.AddEquation
    mat.blendSrc = THREE.OneFactor
    mat.blendDst = THREE.SrcAlphaFactor
    mat.depthWrite = true
    mat.side = THREE.DoubleSide
  }
  return mat
}
