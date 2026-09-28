// Shared GLSL chunks. Every world composes its shaders from these so the
// fog, the lighting vocabulary and the noise are the same everywhere.

export const hash = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
`

// value noise with analytic-free smooth interpolation (cheap, good enough for detail)
export const noise = /* glsl */ `
${hash}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0));
  float n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1));
  float n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1));
  float n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.07 + 11.3; a *= 0.5; }
  return s;
}
`

// Height fog with sun inscatter. Expects cameraPosition (three built-in) and
// the uniforms declared here. A world may provide a sky LUT for the fog tint.
export const fog = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogBase;
uniform float uFogFalloff;
uniform float uFogSun;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uFogClip; // when rendering through a portal: fog only beyond this plane
uniform vec2 uWater; // x: a still mirror-sea at y = 0, y: reflectance of what lies under it
float mirrorDim(vec3 wp) { return (uWater.x > 0.5 && wp.y < -0.002) ? uWater.y : 1.0; }
#ifdef FOG_SKYLUT
uniform sampler2D uSkyLUT;
vec2 skyUV(vec3 d) {
  float u = atan(d.z, d.x) * 0.15915494 + 0.5;
  float y = clamp(d.y, -1.0, 1.0);
  float v = 0.5 + 0.5 * sign(y) * sqrt(abs(y));
  return vec2(u, v);
}
vec3 skyLUT(vec3 d) { return texture(uSkyLUT, skyUV(d)).rgb; }
#endif
vec3 fogTint(vec3 dir) {
#ifdef FOG_SKYLUT
  vec3 c = skyLUT(normalize(vec3(dir.x, max(dir.y, 0.015), dir.z))) * uFogColor;
#else
  vec3 c = uFogColor;
#endif
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * uFogSun * (pow(s, 6.0) * 0.6 + pow(s, 48.0) * 1.4);
  return c;
}
float fogAmount(vec3 ro, vec3 rd, float t) {
  float b = uFogFalloff;
  float h = max(ro.y - uFogBase, -40.0);
  float k = rd.y * b * t;
  float g = abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
  float od = uFogDensity * exp(-b * h) * t * g;
  return 1.0 - exp(-od);
}
float fogFrom(vec3 wp, out vec3 rd) {
  vec3 ro = cameraPosition;
  vec3 v = wp - ro;
  float t = length(v);
  rd = v / max(t, 1e-4);
  if (dot(uFogClip.xyz, uFogClip.xyz) > 0.5) {
    float den = dot(uFogClip.xyz, rd);
    float tc = abs(den) > 1e-5 ? -(dot(uFogClip.xyz, ro) + uFogClip.w) / den : -1.0;
    if (tc > 0.0) {
      if (tc >= t) return 0.0;
      ro += rd * tc;
      t -= tc;
    }
  }
  return fogAmount(ro, rd, t);
}
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 rd;
  col *= mirrorDim(wp);
  float f = fogFrom(wp, rd);
  return mix(col, fogTint(rd), f);
}
`
