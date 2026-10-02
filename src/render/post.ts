import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Bloom tuned against the emissive levels in world/materials.ts. */
const BLOOM = { strength: 0.7, radius: 0.5, threshold: 1.0 };

/**
 * Exposure, ACES, a mild S-curve, cool-shadow/warm-highlight split tone, the phase effect,
 * vignette, grain and edge chromatic aberration. Does its own sRGB conversion.
 */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2() },
    uExposure: { value: 1.35 },
    uPhase: { value: 0 },
    uGrain: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uExposure, uPhase, uGrain;
    uniform vec2 uRes;
    varying vec2 vUv;
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      uv += vec2(sin(uv.y * 38.0 + uTime * 6.0), cos(uv.x * 31.0 + uTime * 5.0)) * 0.006 * uPhase;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      float ca = 0.0016 + 0.006 * uPhase;
      vec3 c = vec3(texture2D(tDiffuse, uv + d * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ca).b);
      c *= uExposure;
      c = aces(c);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.3);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c * vec3(0.9, 0.97, 1.12), c * vec3(1.06, 1.0, 0.9), smoothstep(0.08, 0.6, l));
      c += vec3(1.0, 0.72, 0.42) * uPhase * 0.18 * (1.0 - r2 * 2.0);
      c *= 1.0 - 0.72 * smoothstep(0.1, 0.62, r2);
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      c += (hash(uv * uRes + fract(uTime) * 91.7) - 0.5) * 0.04 * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * Make three's current bloom behave like the r147 one the mockup was tuned with. The bloom and
 * emissive constants only mean what the design doc says under these three behaviours:
 * - 8-bit blur targets, so each bright pixel clamps at 1.0 before it spreads;
 * - short normalised kernels (radii 3..11, sigma = radius), not radii 6..22 at sigma r/3;
 * - a composite added once at `strength`, where newer three scales it by 3 and then
 *   additively blends it by its own alpha again.
 * Without these the hall interior blooms into the white mush the doc warns about.
 */
function matchMockupBloom(bloom: UnrealBloomPass) {
  // Before first use, so the targets are allocated as 8-bit.
  for (const target of [bloom.renderTargetBright, ...bloom.renderTargetsHorizontal, ...bloom.renderTargetsVertical]) {
    target.texture.type = THREE.UnsignedByteType;
  }
  const pdf = (x: number, sigma: number) => (0.39894 * Math.exp((-0.5 * x * x) / (sigma * sigma))) / sigma;
  bloom.separableBlurMaterials = bloom.separableBlurMaterials.map((old, i) => {
    const k = [3, 5, 7, 9, 11][i] ?? 11;
    const c = Array.from({ length: k }, (_, j) => pdf(j, k));
    const total = c[0] + 2 * c.slice(1).reduce((a, b) => a + b, 0);
    // The newer shader samples taps in bilinear pairs; merge ours the same way.
    const offsets: number[] = [];
    const weights: number[] = [];
    for (let j = 1; j < k; j += 2) {
      const wa = c[j];
      const wb = j + 1 < k ? c[j + 1] : 0;
      offsets.push((j * wa + (j + 1) * wb) / (wa + wb));
      weights.push((wa + wb) / total);
    }
    const m = old.clone();
    m.defines.KERNEL_PAIRS = offsets.length;
    m.uniforms.centerWeight.value = c[0] / total;
    m.uniforms.gaussianOffsets.value = offsets;
    m.uniforms.gaussianWeights.value = weights;
    old.dispose();
    return m;
  });
  bloom.strength /= 3;
  bloom.blendMaterial.blending = THREE.CustomBlending;
  bloom.blendMaterial.blendSrc = THREE.OneFactor;
  bloom.blendMaterial.blendDst = THREE.OneFactor;
}

export interface Post {
  bloom: UnrealBloomPass;
  render(dt: number, time: number, phase: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
}

/** HDR half-float target with 4x MSAA → bloom → grade. */
export function makePost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, reduceMotion: boolean): Post {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // Full resolution: the mockup's bloom was tuned at the size EffectComposer gives its passes.
  const bloom = new UnrealBloomPass(size.clone(), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  matchMockupBloom(bloom);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uGrain.value = reduceMotion ? 0 : 1;
  composer.addPass(grade);
  return {
    bloom,
    render(dt, time, phase) {
      grade.uniforms.uTime.value = time;
      // Reduced motion gets a softer phase effect.
      grade.uniforms.uPhase.value = reduceMotion ? phase * 0.3 : phase;
      composer.render(dt);
    },
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      grade.uniforms.uRes.value.set(Math.floor(width * pixelRatio), Math.floor(height * pixelRatio));
    },
  };
}
