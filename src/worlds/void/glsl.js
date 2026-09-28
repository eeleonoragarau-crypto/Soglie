// GLSL shared by every surface of L'Abisso. One sky, one galaxy, one hole:
// the sky dome, the galaxy, the tile reflections and the black hole itself all
// read the same functions, so what the hole bends is exactly what is behind it.
//
// Lensing is layered. Far from the hole every material applies the weak-field
// (thin lens) deflection analytically; inside a sphere of uBHR rs the black
// hole shader integrates the photon path through Schwarzschild space, and it
// adds back the weak bending gathered outside that sphere, so the two agree
// where they meet.

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec4 uBH;        // xyz centre (m), w Schwarzschild radius (m)
uniform vec3 uBHn;       // accretion disk normal
uniform vec3 uBHe1;      // disk plane basis
uniform vec3 uBHe2;
uniform float uBHR;      // radius of the traced sphere, in rs
uniform vec3 uGalC;      // galaxy centre, frame and radius
uniform vec3 uGalN;
uniform vec3 uGalX;
uniform vec3 uGalZ;
uniform float uGalR;
uniform float uGalRot;
uniform float uGalGain;

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// weak-field bending gathered along a ray from ro to infinity (thin lens)
vec3 lensDir(vec3 ro, vec3 rd) {
  vec3 c = uBH.xyz - ro;
  float ts = dot(c, rd);
  vec3 perp = ro + rd * ts - uBH.xyz;
  float pl = length(perp);
  float b = max(pl, uBH.w * 2.0);
  float a = (uBH.w / b) * (1.0 + ts / sqrt(b * b + ts * ts));
  return normalize(rd - perp / max(pl, 1e-3) * a);
}

// image of a point source seen from the camera (primary image of a point lens)
vec3 lensPoint(vec3 wp) {
  vec3 c = uBH.xyz - cameraPosition;
  float Dl = length(c);
  vec3 hd = c / Dl;
  vec3 s = wp - cameraPosition;
  float Ds = length(s);
  vec3 sd = s / Ds;
  float cb = dot(sd, hd);
  float Dls = Ds * cb - Dl;
  if (Dls <= 0.0) return wp;
  float beta = acos(clamp(cb, -1.0, 1.0));
  float e2 = 2.0 * uBH.w * Dls / (Dl * Ds);
  float th = 0.5 * (beta + sqrt(beta * beta + 4.0 * e2));
  vec3 ax = sd - hd * cb;
  float al = length(ax);
  if (al < 1e-6) return wp;
  ax /= al;
  return cameraPosition + (hd * cos(th) + ax * sin(th)) * Ds;
}
`

// the sky at infinity: baked nebula, stars, a ringed giant
export const COSMOS = /* glsl */ `
uniform sampler2D uNeb;

vec3 nebula(vec3 d) {
  vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  return textureLod(uNeb, uv, 0.0).rgb;
}

// px: angular size of a pixel (radians), keeps stars round and unaliased
vec3 stars(vec3 d, float px) {
  vec3 col = vec3(0.0);
  for (int l = 0; l < 3; l++) {
    float sc = l == 0 ? 90.0 : (l == 1 ? 165.0 : 290.0);
    float th = l == 0 ? 0.984 : (l == 1 ? 0.962 : 0.925);
    vec3 p = d * sc;
    vec3 c = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(c + float(l) * 41.3);
    if (h > th) {
      float k = (h - th) / (1.0 - th);
      float r0 = 0.07;
      float rad = max(r0, px * sc * 0.75);
      vec3 o = (hash33(c + 5.7) - 0.5) * max(0.0, 0.9 - rad * 4.0);
      vec3 q = f - o;
      float dd = dot(q, q);
      float e = (r0 * r0) / (rad * rad);
      float b = pow(k, 2.4) * e;
      float t = fract(h * 97.13);
      vec3 tint = t < 0.3 ? vec3(0.62, 0.74, 1.0) : (t < 0.78 ? vec3(1.0, 0.95, 0.9) : vec3(1.0, 0.74, 0.5));
      col += tint * exp(-dd / (rad * rad)) * b * (l == 0 ? 26.0 : (l == 1 ? 7.0 : 2.4));
      if (l == 0) col += tint * exp(-dd * 30.0) * pow(k, 3.0) * 0.12;
    }
  }
  return col;
}

// a ringed giant, lit from behind and to the right: a thick crescent
const vec3 PL_DIR = vec3(-0.6155, 0.3694, 0.6961);
const float PL_R = 0.074;
const vec3 PL_LIGHT = vec3(0.8165, 0.1633, 0.5534);
const vec3 RING_N = vec3(0.2873, 0.9097, -0.2994);

float ringDensity(float rr) {
  float x = (rr - 1.32) / (2.3 - 1.32);
  if (x < 0.0 || x > 1.0) return 0.0;
  float bands = 0.55 + 0.45 * sin(x * 61.0) * sin(x * 23.0 + 1.0);
  float gap = 1.0 - 0.85 * exp(-pow((x - 0.62) * 34.0, 2.0));
  return bands * gap * smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.8, x) * (0.6 + 0.4 * sin(x * 7.0 + 2.0));
}

vec3 planet(vec3 d, out float cover) {
  cover = 0.0;
  vec3 col = vec3(0.0);
  float tp = 1e9;
  float b = dot(d, PL_DIR);
  float disc = b * b - (1.0 - PL_R * PL_R);
  if (b > 0.0 && disc > 0.0) {
    tp = b - sqrt(disc);
    vec3 hp = d * tp;
    vec3 n = normalize(hp - PL_DIR);
    float ndl = dot(n, PL_LIGHT);
    float lit = smoothstep(-0.05, 0.35, ndl) * max(ndl, 0.0) * 1.4;
    float lat = dot(n, RING_N);
    float bands = 0.5 + 0.5 * sin(lat * 34.0 + 1.6 * sin(lat * 9.0));
    vec3 alb = mix(vec3(0.56, 0.47, 0.4), vec3(0.8, 0.73, 0.64), bands);
    // shadow of the rings on the globe
    float tr = dot(PL_DIR - hp, RING_N) / dot(PL_LIGHT, RING_N);
    float rsh = tr > 0.0 ? 1.0 - 0.7 * ringDensity(length(hp + PL_LIGHT * tr - PL_DIR) / PL_R) : 1.0;
    float limb = pow(1.0 - max(dot(n, -d), 0.0), 2.5);
    col = alb * lit * rsh * 0.42 + vec3(0.5, 0.58, 0.9) * limb * smoothstep(-0.2, 0.3, ndl) * 0.1;
    col += alb * 0.0015;
    cover = smoothstep(0.0, 1e-5, disc);
  }
  float den = dot(d, RING_N);
  if (abs(den) > 1e-4) {
    float tr = dot(PL_DIR, RING_N) / den;
    if (tr > 0.0) {
      vec3 rp = d * tr;
      float rr = length(rp - PL_DIR) / PL_R;
      float rd = ringDensity(rr);
      if (rd > 0.0) {
        vec3 oc = rp - PL_DIR;
        float bb = dot(oc, PL_LIGHT);
        float cc = dot(oc, oc) - PL_R * PL_R;
        float shadow = (bb < 0.0 && bb * bb - cc > 0.0) ? 0.04 : 1.0;
        vec3 rc = vec3(0.78, 0.7, 0.6) * (0.06 + 0.3 * abs(dot(RING_N, PL_LIGHT))) * shadow;
        float ra = rd * 0.85;
        if (tr < tp) { col = mix(col, rc, ra); cover = max(cover, ra); }
        else if (cover < 0.5) { col += rc * ra; cover = max(cover, ra); }
      }
    }
  }
  return col;
}

vec3 cosmos(vec3 d, float px) {
  float cover;
  vec3 pl = planet(d, cover);
  vec3 col = (nebula(d) + stars(d, px)) * (1.0 - cover) + pl;
  return col + vec3(0.0003, 0.00025, 0.0007);
}
`

// the spiral galaxy under the path, as a surface brightness in its own frame
export const GALAXY = /* glsl */ `
const float GAL_K = 3.6;
float galWarp(float lr) { return 0.35 * sin(3.1 * lr + 1.3) + 0.12 * sin(7.3 * lr + 0.4); }

vec3 galaxyGlow(vec2 lp) {
  vec2 p = rot2(uGalRot) * lp / uGalR;
  float r = length(p);
  if (r > 1.3) return vec3(0.0);
  float th = atan(p.y, p.x);
  float lr = log(max(r, 1e-3));
  float ph = th - GAL_K * lr - galWarp(lr);
  float c2 = 0.5 + 0.5 * cos(2.0 * ph);
  float arm = c2 * c2 * c2;
  float ridge = pow(c2, 16.0);
  float lane = pow(0.5 + 0.5 * cos(2.0 * (ph + 0.42)), 10.0);
  float fl = fbm2(p * 9.0 + 3.7);
  float fine = vnoise(p * 70.0);
  float disk = exp(-r / 0.26) * (1.0 - smoothstep(0.8, 1.25, r));
  float bulge = exp(-r * r / 0.0032) * 2.4 + exp(-r / 0.05) * 0.8;
  float armed = smoothstep(0.04, 0.17, r);
  vec3 young = vec3(0.5, 0.64, 1.0);
  vec3 old = vec3(1.0, 0.78, 0.55);
  vec3 col = old * bulge;
  col += mix(old, young, armed * 0.8) * disk * (0.2 + armed * (1.25 * arm + 0.9 * ridge) * (0.5 + 0.9 * fl));
  float knots = smoothstep(0.64, 0.84, fbm2(p * 26.0 + 11.0)) * ridge * armed;
  col += vec3(1.0, 0.5, 0.64) * knots * disk * 1.6;
  float dust = lane * armed * smoothstep(1.1, 0.3, r) * (0.55 + 0.45 * fl) + smoothstep(0.55, 0.8, fl) * 0.25 * armed;
  col *= 1.0 - 0.86 * clamp(dust, 0.0, 1.0);
  col *= 0.82 + 0.36 * fine;
  return col * uGalGain;
}

vec3 galaxyAt(vec3 o, vec3 d) {
  float den = dot(d, uGalN);
  if (abs(den) < 1e-5) return vec3(0.0);
  float t = dot(uGalC - o, uGalN) / den;
  if (t <= 0.0) return vec3(0.0);
  vec3 h = o + d * t - uGalC;
  return galaxyGlow(vec2(dot(h, uGalX), dot(h, uGalZ)));
}
`

// Schwarzschild photon paths (units of rs, the horizon at r = 1). The path of
// light obeys x'' = -1.5 h^2 x / r^5 with h = |x cross x'| conserved; that
// reproduces the exact orbit equation u'' + u = 1.5 u^2.
export const HOLE = /* glsl */ `
const float RIN = 2.7;
const float ROUT = 12.0;
const int BH_STEPS = 96;

vec3 bbColor(float t) {
  vec3 c = vec3(1.0, 0.16, 0.02);
  c = mix(c, vec3(1.0, 0.46, 0.13), smoothstep(0.12, 0.42, t));
  c = mix(c, vec3(1.0, 0.76, 0.5), smoothstep(0.38, 0.8, t));
  c = mix(c, vec3(1.0, 0.93, 0.86), smoothstep(0.75, 1.15, t));
  c = mix(c, vec3(0.78, 0.86, 1.0), smoothstep(1.15, 1.9, t));
  return c;
}

// light and opacity of the disk where a ray crosses it; v = ray direction
vec4 diskAt(vec3 q, vec3 v) {
  float r = length(q);
  if (r < RIN * 0.9 || r > ROUT) return vec4(0.0);
  float phi = atan(dot(q, uBHe2), dot(q, uBHe1));
  float a = phi - uTime * 1.7 * pow(r, -1.5);
  float lr = log(r);
  vec2 cs = vec2(cos(a), sin(a));
  float n1 = vnoise3(vec3(cs * 1.8, lr * 9.0));
  float n2 = vnoise3(vec3(cs * 4.5, lr * 24.0) + 7.3);
  float n3 = vnoise3(vec3(cs * 11.0, lr * 61.0) + 2.1);
  float streak = n1 * 0.5 + n2 * 0.33 + n3 * 0.17;
  float inner = smoothstep(RIN * 0.9, RIN * 1.1, r);
  float outer = 1.0 - smoothstep(ROUT * 0.5, ROUT, r);
  float dens = inner * outer * (0.25 + 1.2 * streak * streak);
  // relativistic beaming of the orbiting gas and gravitational redshift
  vec3 u = normalize(cross(uBHn, q));
  float beta = sqrt(0.5 / r);
  float g = sqrt(1.0 - beta * beta) / (1.0 + beta * dot(u, v));
  g *= sqrt(max(1.0 - 1.0 / r, 0.0));
  float ge = mix(1.0, g, 0.85);
  float T = pow(RIN / r, 0.75);
  vec3 col = bbColor(T * ge * 1.2) * pow(ge, 3.0) * T * T * 7.5 * (0.45 + streak);
  return vec4(col, clamp(dens * 1.3, 0.0, 0.97));
}

// Trace a camera ray through the hole. Returns the disk light gathered on the
// way (rgb, already weighted) and its opacity (a). esc = 1 when the ray
// escapes: dirOut / posOut are then the ray that carries on to the sky, with
// the outer weak bending added. fade = coverage near the rim of the sphere.
vec4 traceHole(vec3 ro, vec3 rd, out vec3 dirOut, out vec3 posOut, out float esc, out float fade) {
  float rs = uBH.w;
  float R = uBHR;
  vec3 p = (ro - uBH.xyz) / rs;
  vec3 v = rd;
  esc = 0.0; fade = 0.0; dirOut = rd; posOut = ro;
  float bq = dot(p, v);
  float disc = bq * bq - (dot(p, p) - R * R);
  if (disc <= 0.0 || -bq + sqrt(disc) < 0.0) return vec4(0.0);
  float t0 = -bq - sqrt(disc);
  vec3 cp = p - v * bq;
  float b0 = length(cp);
  fade = 1.0 - smoothstep(0.8 * R, 0.985 * R, b0);
  if (t0 > 0.0) {
    float ts = -bq;
    float z0 = sqrt(max(R * R - b0 * b0, 0.0));
    float ap = (ts / sqrt(b0 * b0 + ts * ts) - z0 / R) / max(b0, 1.0);
    p += v * t0;
    v = normalize(v - cp / max(b0, 1e-3) * max(ap, 0.0));
  }
  vec3 L = cross(p, v);
  float h2 = dot(L, L);
  vec3 col = vec3(0.0);
  float A = 0.0;
  float r2 = dot(p, p);
  vec3 acc = -1.5 * h2 * p / (r2 * r2 * sqrt(r2));
  float captured = 0.0;
  for (int i = 0; i < BH_STEPS; i++) {
    float r = sqrt(r2);
    float dt = clamp(0.07 * r2, 0.04, 2.4);
    vec3 pn = p + v * dt + 0.5 * acc * dt * dt;
    float rn2 = dot(pn, pn);
    vec3 accn = -1.5 * h2 * pn / (rn2 * rn2 * sqrt(rn2));
    v += 0.5 * (acc + accn) * dt;
    acc = accn;
    float s0 = dot(p, uBHn), s1 = dot(pn, uBHn);
    if (s0 * s1 < 0.0) {
      vec3 q = mix(p, pn, s0 / (s0 - s1));
      vec4 dk = diskAt(q, normalize(v));
      col += (1.0 - A) * dk.a * dk.rgb;
      A += (1.0 - A) * dk.a;
    }
    p = pn;
    r2 = rn2;
    if (r2 < 1.0) { captured = 1.0; break; }
    if (A > 0.985) { captured = 1.0; break; }
    if (r2 > R * R && dot(p, v) > 0.0) { esc = 1.0; break; }
  }
  if (esc > 0.5) {
    vec3 vd = normalize(v);
    float z0 = dot(p, vd);
    vec3 cp2 = p - vd * z0;
    float b = max(length(cp2), 1.0);
    float ap = (1.0 - z0 / length(p)) / b;
    dirOut = normalize(vd - cp2 / b * max(ap, 0.0));
    posOut = uBH.xyz + p * rs;
  }
  return vec4(col, A);
}
`

// the nebula, rendered once into an equirect texture
export const NEBULA_HQ = /* glsl */ `
vec3 nebulaHQ(vec3 d) {
  vec3 q = d * 1.7;
  vec3 w = vec3(fbm3(q + 1.7), fbm3(q + 9.2), fbm3(q + 4.4));
  vec3 q2 = q * 2.0 + (w - 0.5) * 2.6;
  float n = fbm3(q2);
  float m = fbm3(q2 * 1.9 + 3.0);
  float fil = fbm3(q2 * 4.2 - 2.0);
  // where the clouds live: a great veil up and to the left, a glow behind the
  // hole (so its bending shows), a cold wisp behind you
  float reg1 = smoothstep(0.25, 0.95, dot(d, normalize(vec3(-0.55, 0.5, 0.65))));
  float reg2 = smoothstep(0.62, 0.98, dot(d, normalize(vec3(0.12, 0.1, 1.0))));
  float reg3 = smoothstep(0.3, 0.95, dot(d, normalize(vec3(0.75, 0.45, -0.5))));
  float reg4 = smoothstep(0.4, 1.0, dot(d, normalize(vec3(0.9, -0.1, 0.4))));
  float dens = pow(smoothstep(0.32, 0.86, n), 2.2);
  float wisp = pow(smoothstep(0.45, 0.75, fil), 3.0);
  vec3 violet = mix(vec3(0.16, 0.05, 0.3), vec3(0.62, 0.15, 0.4), smoothstep(0.35, 0.75, m));
  vec3 teal = mix(vec3(0.03, 0.12, 0.26), vec3(0.18, 0.4, 0.6), smoothstep(0.35, 0.75, m));
  vec3 rose = mix(vec3(0.3, 0.07, 0.12), vec3(0.95, 0.42, 0.3), smoothstep(0.4, 0.8, m));
  vec3 col = violet * (dens * 1.1 + wisp * 0.5) * reg1;
  col += rose * (dens * 0.8 + wisp * 0.6) * reg2;
  col += teal * (dens + wisp * 0.4) * reg3;
  col += mix(violet, teal, 0.5) * dens * reg4 * 0.5;
  float dust = smoothstep(0.52, 0.74, fbm3(q2 * 3.1 - 5.0));
  col *= 1.0 - 0.82 * dust;
  // a faint veil everywhere so no direction is quite empty
  col += vec3(0.012, 0.008, 0.022) * (0.3 + fbm3(q * 3.0)) * (1.0 - 0.6 * dust);
  return col * 0.085;
}
`
