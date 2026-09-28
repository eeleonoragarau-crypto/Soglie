import * as THREE from 'three'

// Per-world lighting + fog uniforms, shared by reference with every material
// in that world so a single write updates the whole scene.
export function makeEnv(o) {
  const v3 = (a) => new THREE.Vector3(...a)
  const uniforms = {
    uSunDir: { value: v3(o.sunDir).normalize() },
    uSunColor: { value: v3(o.sunColor) },
    uAmbTop: { value: v3(o.ambTop) },
    uAmbHorizon: { value: v3(o.ambHorizon) },
    uAmbGround: { value: v3(o.ambGround || [0.1, 0.08, 0.06]) },
    uFogColor: { value: v3(o.fogColor) },
    uFogDensity: { value: o.fogDensity },
    uFogBase: { value: o.fogBase ?? 0 },
    uFogFalloff: { value: o.fogFalloff ?? 0.02 },
    uFogSun: { value: o.fogSun ?? 0.5 },
    uSkyLUT: { value: o.skyLUT || null },
    uFogClip: { value: new THREE.Vector4(0, 0, 0, 0) },
    uWater: { value: new THREE.Vector2(o.water ? 1 : 0, o.water ?? 1) },
  }
  return {
    uniforms,
    defines: o.skyLUT ? { FOG_SKYLUT: 1 } : {},
    // GLSL defining float worldShadow(vec3 p); worlds can override
    shadowGLSL: o.shadowGLSL || 'float worldShadow(vec3 p) { return 1.0; }',
    extraUniforms: o.extraUniforms || {},
  }
}
