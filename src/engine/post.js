import * as THREE from 'three'
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  Effect,
  EffectAttribute,
} from 'postprocessing'

// Grade + vignette + grain + fade-to-colour + optional heat shimmer, in one pass.
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform float uTime;
      uniform float uExposure;
      uniform float uSaturation;
      uniform float uContrast;
      uniform vec3 uLift;
      uniform vec3 uGain;
      uniform float uVignette;
      uniform float uGrain;
      uniform vec4 uFade;
      uniform float uHaze;

      float gHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

      void mainUv(inout vec2 uv) {
        if (uHaze > 0.0) {
          // shimmer only far away, strongest around the horizon line
          float z = -getViewZ(readDepth(uv));
          float far = smoothstep(120.0, 600.0, z);
          float band = exp(-pow((uv.y - 0.47) * 6.0, 2.0)) * far;
          float w = sin(uv.y * 190.0 + uTime * 5.0) * sin(uv.x * 37.0 - uTime * 2.3);
          uv.x += w * band * uHaze * 0.0012;
          uv.y += sin(uv.x * 61.0 + uTime * 3.1) * band * uHaze * 0.0007;
        }
      }

      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        c *= uExposure;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        c = (c - 0.5) * uContrast + 0.5;
        c = c * uGain + uLift * (1.0 - c);
        vec2 q = uv - 0.5;
        c *= 1.0 - uVignette * dot(q, q) * 1.6;
        float g = gHash(uv * vec2(1733.0, 977.0) + fract(uTime * 7.13)) - 0.5;
        c += g * uGrain * (0.25 + 0.75 * smoothstep(0.0, 0.25, l));
        c = mix(c, uFade.rgb, uFade.a);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }
    `, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uTime', new THREE.Uniform(0)],
        ['uExposure', new THREE.Uniform(1)],
        ['uSaturation', new THREE.Uniform(1.02)],
        ['uContrast', new THREE.Uniform(1.04)],
        ['uLift', new THREE.Uniform(new THREE.Vector3(0.01, 0.008, 0.012))],
        ['uGain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uVignette', new THREE.Uniform(0.55)],
        ['uGrain', new THREE.Uniform(0.035)],
        ['uFade', new THREE.Uniform(new THREE.Vector4(0, 0, 0, 1))],
        ['uHaze', new THREE.Uniform(0)],
      ]),
    })
  }
}

export function createPost(renderer, scene, camera, { samples = 4 } = {}) {
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: samples,
  })
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)
  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 1.1,
    luminanceSmoothing: 0.25,
    intensity: 0.7,
    radius: 0.78,
    levels: 7,
  })
  const tm = new URLSearchParams(location.search).get('tm') || 'aces'
  const modes = { aces: ToneMappingMode.ACES_FILMIC, agx: ToneMappingMode.AGX, neutral: ToneMappingMode.NEUTRAL }
  const tone = new ToneMappingEffect({ mode: modes[tm] ?? ToneMappingMode.ACES_FILMIC })
  const grade = new GradeEffect()
  composer.addPass(new EffectPass(camera, bloom, tone, grade))
  const u = grade.uniforms
  return {
    composer,
    renderPass,
    bloom,
    grade,
    u: {
      time: u.get('uTime'),
      exposure: u.get('uExposure'),
      saturation: u.get('uSaturation'),
      contrast: u.get('uContrast'),
      lift: u.get('uLift'),
      gain: u.get('uGain'),
      vignette: u.get('uVignette'),
      grain: u.get('uGrain'),
      fade: u.get('uFade'),
      haze: u.get('uHaze'),
    },
    setScene(s) { renderPass.mainScene = s },
  }
}
