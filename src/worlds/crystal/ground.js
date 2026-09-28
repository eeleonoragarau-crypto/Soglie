// The salt flat. A camera-centred polar grid (dense at the feet, sparse at the
// horizon) displaced by saltH(); the fragment shader draws the polygonal
// crust: raised pale ridges between cells, a faint wet film that mirrors the
// dawn at grazing angles, sparkle at the feet, long coloured crystal shadows,
// light pools under the singing crystals and the cells your steps wake.

import * as THREE from 'three'
import { noise, fog } from '../../lib/glsl.js'
import { heightGLSL } from './layout.js'

export const NCAST = 28
export const NSTEP = 14
export const NPOOL = 4

function polarGrid(rings = 150, segs = 128, rMax = 5200, k = 7.6) {
  const pos = []
  const idx = []
  const c = rMax / (Math.exp(k) - 1)
  pos.push(0, 0, 0)
  for (let i = 1; i <= rings; i++) {
    const r = c * (Math.exp((k * i) / rings) - 1)
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs)
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r)
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j)
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs, a1 = 1 + i * segs
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs
      idx.push(a0 + j, a0 + j1, a1 + j)
      idx.push(a0 + j1, a1 + j1, a1 + j)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

export function makeGround(env, opts) {
  const casters = Array.from({ length: NCAST }, () => new THREE.Vector4(1e5, 1e5, 0, 0))
  const tints = Array.from({ length: NCAST }, () => new THREE.Vector3(1, 1, 1))
  const steps = Array.from({ length: NSTEP }, () => new THREE.Vector4(1e5, 1e5, -100, 0))
  const pools = Array.from({ length: NPOOL }, () => new THREE.Vector4(1e5, 1e5, 1, 0))
  const poolCol = Array.from({ length: NPOOL }, () => new THREE.Vector3(1, 1, 1))
  const u = {
    ...env.uniforms,
    uTime: { value: 0 },
    uCasters: { value: casters },
    uCastTint: { value: tints },
    uSteps: { value: steps },
    uPools: { value: pools },
    uPoolCol: { value: poolCol },
    uStepCol: { value: new THREE.Vector3(...(opts.stepColor || [1, 0.55, 0.8])) },
  }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: u,
    defines: { ...env.defines, NCAST, NSTEP, NPOOL },
    vertexShader: /* glsl */ `
      out vec3 vWorld;
      ${heightGLSL}
      void main() {
        vec2 xz = position.xz + cameraPosition.xz;
        vec3 w = vec3(xz.x, saltH(xz), xz.y);
        vWorld = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbHorizon;
      uniform vec3 uAmbGround;
      uniform vec4 uCasters[NCAST];
      uniform vec3 uCastTint[NCAST];
      uniform vec4 uSteps[NSTEP];
      uniform vec4 uPools[NPOOL];
      uniform vec3 uPoolCol[NPOOL];
      uniform vec3 uStepCol;
      in vec3 vWorld;
      out vec4 fragColor;
      ${noise}
      ${fog}
      ${heightGLSL}

      // polygonal cells: distance to the nearest border (IQ), its outward
      // direction and the cell id
      vec3 cells(vec2 x, out vec2 cid, out vec2 dir) {
        vec2 n = floor(x);
        vec2 f = fract(x);
        vec2 mg = vec2(0.0), mr = vec2(0.0);
        float md = 8.0;
        for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 o = hash22(n + g) * 0.94 + 0.03;
          vec2 r = g + o - f;
          float d = dot(r, r);
          if (d < md) { md = d; mr = r; mg = g; }
        }
        md = 8.0;
        dir = vec2(1.0, 0.0);
        for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) {
          vec2 g = mg + vec2(float(i), float(j));
          vec2 o = hash22(n + g) * 0.94 + 0.03;
          vec2 r = g + o - f;
          vec2 dd = r - mr;
          if (dot(dd, dd) > 1e-5) {
            vec2 nn = normalize(dd);
            float d = dot(0.5 * (mr + r), nn);
            if (d < md) { md = d; dir = nn; }
          }
        }
        cid = n + mg;
        return vec3(md, length(mr), 0.0);
      }

      void main() {
        vec3 P = vWorld;
        vec3 V0 = cameraPosition - P;
        float dist = length(V0);
        vec3 V = V0 / dist;
        vec3 L = uSunDir;
        vec2 fx = dFdx(P.xz), fy = dFdy(P.xz);
        float mppA = length(fx), mppB = length(fy);
        float mppMin = min(mppA, mppB) + 1e-5;   // across the view
        float mppMax = max(mppA, mppB) + 1e-5;   // along it (foreshortened)

        // macro normal of the undulations
        float e = 0.8;
        float hx = saltH(P.xz + vec2(e, 0.0)) - saltH(P.xz - vec2(e, 0.0));
        float hz = saltH(P.xz + vec2(0.0, e)) - saltH(P.xz - vec2(0.0, e));
        vec3 Nm = normalize(vec3(-hx, 2.0 * e, -hz));

        // ---- crust
        const float CELL = 1.25;
        vec2 cid, dir;
        vec2 cp = P.xz / CELL;
        float detail = 1.0 - smoothstep(0.22, 0.6, mppMin / CELL);
        float ridge = 0.0;
        vec2 grad = vec2(0.0);
        float cellTone = 0.0;
        float bd = 1.0;
        float shoulder = 0.0;
        vec2 cellC = vec2(1e5);
        if (detail > 0.0) {
          vec3 c = cells(cp, cid, dir);
          bd = c.x;
          float lump = vnoise(P.xz * 1.7) * 0.5 + vnoise(P.xz * 5.3) * 0.3 + vnoise(P.xz * 13.0) * 0.2;
          lump *= 0.5 + hash12(floor(P.xz * 0.9)) * 0.0 + 0.5 * vnoise(cid * 0.7);
          float wR = 0.022 + 0.026 * lump;                   // ridge half width (cells)
          // prefilter: a ridge never gets thinner than the pixel, it fades instead
          float wE = max(wR, mppMax / CELL * 0.55);
          float amp = wR / wE;
          float aR = (0.012 + 0.022 * lump) * detail * amp;  // height (m)
          float q = bd / wE;
          ridge = exp(-q * q) * amp;
          shoulder = exp(-q * q * 0.08) * amp;
          float dh = aR * exp(-q * q) * 2.0 * q / wE;
          grad = dir * dh / CELL;
          cellTone = hash12(cid) - 0.5;
          cellC = (cid + hash22(cid) * 0.94 + 0.03) * CELL;
          // shallow dish inside the cells, faint lumps
          float dish = smoothstep(0.0, 0.5, bd);
          float nearK = 1.0 - smoothstep(0.02, 0.1, mppMax);
          grad += (vec2(vnoise(P.xz * 3.1 + 7.0), vnoise(P.xz * 3.1 + 1.0)) - 0.5) * 0.06 * nearK * dish;
        }
        vec3 N = normalize(Nm + vec3(-grad.x, 0.0, -grad.y));

        // albedo: pale ridges, slightly greyer, damper cell floors
        float farTone = vnoise(P.xz * 0.02) * 0.5 + vnoise(P.xz * 0.11) * 0.5;
        float grain = 0.0, crack = 0.0;
        float nearT = 1.0 - smoothstep(0.015, 0.08, mppMax);
        if (nearT > 0.0) {
          grain = (vnoise(P.xz * 23.0) - 0.5) * 0.6 + (vnoise(P.xz * 61.0) - 0.5) * 0.4;
          vec2 c2 = P.xz * 3.1 + vec2(vnoise(P.xz * 2.0), vnoise(P.xz * 2.0 + 5.0)) * 0.8;
          vec2 i2 = floor(c2), f2 = fract(c2);
          float d1 = 8.0, d2 = 8.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 r = g + hash22(i2 + g + 31.0) - f2;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          crack = (1.0 - smoothstep(0.0, 0.05, sqrt(d2) - sqrt(d1))) * nearT * smoothstep(0.1, 0.4, bd);
        }
        vec3 floorA = vec3(0.74, 0.72, 0.78) * (1.0 + cellTone * 0.1 * detail + grain * 0.07 * nearT) * (0.92 + 0.12 * farTone);
        floorA *= 1.0 - crack * 0.1;
        vec3 ridgeA = vec3(0.95, 0.94, 0.95);
        float ridgeMix = mix(0.3, max(ridge, shoulder * 0.45), detail);
        vec3 alb = mix(floorA, ridgeA, ridgeMix);
        float wet = mix(0.42, 0.12, ridgeMix) * (0.8 + 0.4 * farTone);

        // ---- crystal shadows: long, soft, tinted by what they pass through
        vec2 Ld = normalize(L.xz);
        float tanE = L.y / length(L.xz);
        float sunVis = 1.0;
        vec3 sunTint = vec3(1.0);
        float caus = 0.0;
        for (int i = 0; i < NCAST; i++) {
          vec4 c = uCasters[i];
          if (c.w <= 0.0) continue;
          vec2 rel = c.xy - P.xz;
          float along = dot(rel, Ld);
          if (along <= 0.0) continue;
          float hAt = P.y + along * tanE;
          if (hAt > c.w + c.z) continue;
          float perp = abs(rel.x * Ld.y - rel.y * Ld.x);
          float rEff = c.z * clamp((c.w + c.z * 0.6 - hAt) / (c.z * 1.6), 0.0, 1.0);
          float pen = 0.3 + along * 0.045;
          float occ = smoothstep(rEff + pen, rEff - pen * 0.6, perp) * exp(-along / 260.0);
          if (occ <= 0.0) continue;
          sunVis *= 1.0 - occ * 0.62;
          sunTint = mix(sunTint, uCastTint[i], occ * 0.8);
          caus += occ * exp(-pow(perp / max(rEff * 0.22, 0.05), 2.0)) * smoothstep(4.0, 30.0, along);
        }

        // ---- light
        float ndl = max(dot(N, L), 0.0);
        vec3 sunC = uSunColor * sunVis * mix(vec3(1.0), sunTint, 1.0 - sunVis);
        vec3 amb = mix(uAmbHorizon, uAmbTop, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
        vec3 col = alb * (sunC * ndl + amb);
        col += alb * uSunColor * sunTint * caus * 0.35 * ndl * 4.0;

        // wet film: the dawn at grazing angles
        vec3 Nw = normalize(mix(Nm, N, 0.35));
        vec3 R = reflect(-V, Nw);
        float ndv = max(dot(Nw, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 envC = skyLUT(normalize(vec3(R.x, max(R.y, 0.012), R.z)));
        col = mix(col, envC, F * wet);
        // the sun's path on the film
        vec3 H = normalize(L + V);
        float ndh = max(dot(Nw, H), 0.0);
        float a2 = 0.028;
        float dd = ndh * ndh * (a2 - 1.0) + 1.0;
        float D = a2 / (3.14159 * dd * dd);
        col += uSunColor * sunVis * D * F * wet * 0.35;

        // sparkle: tiny facets catching the sun, two sizes
        float gl = 0.0;
        for (int k = 0; k < 2; k++) {
          float gcell = k == 0 ? 0.03 : 0.1;
          float gvis = 1.0 - smoothstep(0.45, 1.3, mppMax / gcell);
          if (gvis <= 0.0) continue;
          vec2 gp = P.xz / gcell;
          vec2 gi = floor(gp);
          vec2 gf = fract(gp) - 0.5;
          vec3 hr = hash33(vec3(gi, 7.0 + float(k) * 13.0));
          if (hr.z < (k == 0 ? 0.7 : 0.9)) continue;
          vec3 nr = normalize(vec3(hr.x - 0.5, 1.1, hr.y - 0.5));
          float s = pow(max(dot(reflect(-V, nr), L), 0.0), k == 0 ? 700.0 : 1400.0);
          float pt = smoothstep(0.42, 0.08, length(gf));
          gl += s * pt * gvis * (0.5 + ridgeMix) * (k == 0 ? 1.0 : 2.0);
        }
        col += uSunColor * sunVis * gl * 12.0;

        // coloured light around the singing crystals
        for (int i = 0; i < NPOOL; i++) {
          vec4 p = uPools[i];
          vec2 dp = P.xz - p.xy;
          float k = dot(dp, dp) / (p.z * p.z);
          col += uPoolCol[i] * p.w * (exp(-k) * 0.8 + exp(-k * 0.12) * 0.2) * alb * (0.6 + 0.8 * ridgeMix);
        }

        // cells remember your steps
        float glow = 0.0;
        for (int i = 0; i < NSTEP; i++) {
          vec4 s = uSteps[i];
          float age = uTime - s.z;
          if (age < 0.0 || age > 9.0) continue;
          vec2 ds = cellC - s.xy;
          float near = exp(-dot(ds, ds) * 0.35);
          glow += near * s.w * exp(-age * 0.55) * smoothstep(0.0, 0.25, age);
        }
        col += uStepCol * glow * (0.35 + 1.2 * ridge) * detail;

        col = applyFog(col, P);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(polarGrid(), mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  mesh.userData.u = u
  return mesh
}
