import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LAYER, sceneDepth } from './layers';
import { displayRGB, look, onLook } from './look';

/**
 * Exposure, ACES, an S-curve, saturation, cool-shadow/warm-highlight split tone, the phase
 * effect, vignette, a lifted black, grain and edge chromatic aberration. Values come from
 * data/look.json (grade). Does its own sRGB conversion.
 */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2() },
    uPhase: { value: 0 },
    uExposure: { value: 1 },
    uContrast: { value: 0 },
    uSaturation: { value: 1 },
    uShadows: { value: new THREE.Vector3(1, 1, 1) },
    uHighlights: { value: new THREE.Vector3(1, 1, 1) },
    uBlacks: { value: new THREE.Vector3() },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uAberration: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uPhase, uExposure, uContrast, uSaturation, uVignette, uGrain, uAberration;
    uniform vec3 uShadows, uHighlights, uBlacks;
    uniform vec2 uRes;
    varying vec2 vUv;
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      uv += vec2(sin(uv.y * 38.0 + uTime * 6.0), cos(uv.x * 31.0 + uTime * 5.0)) * 0.006 * uPhase;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      float ca = uAberration + 0.006 * uPhase;
      vec3 c = vec3(texture2D(tDiffuse, uv + d * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ca).b);
      c *= uExposure;
      c = aces(c);
      c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, uSaturation), 0.0);
      c = mix(c * uShadows, c * uHighlights, smoothstep(0.08, 0.6, l));
      c += vec3(1.0, 0.72, 0.42) * uPhase * 0.18 * (1.0 - r2 * 2.0);
      c *= 1.0 - uVignette * smoothstep(0.1, 0.62, r2);
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      // Black lifts to a deep blue-grey after the vignette, so even the corners keep the night's colour.
      c = uBlacks + c * (1.0 - uBlacks);
      c += (hash(uv * uRes + fract(uTime) * 91.7) - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * Draws the scene into the HDR target in two goes: layer 0 (everything that writes depth, and the
 * sky), then the late layers (see render/layers.ts). three resolves the MSAA colour and depth at
 * the end of each render, so by the second the depth texture holds the opaque scene for the mist.
 * (Without MSAA the depth texture would be attached to the target it's read in; the low tier in M6
 * will need a copy.)
 */
class ScenePass extends Pass {
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const { camera, scene } = this;
    const autoClear = renderer.autoClear;
    const mask = camera.layers.mask;
    renderer.autoClear = false;
    renderer.setRenderTarget(read);
    renderer.clear();
    camera.layers.set(0);
    renderer.render(scene, camera);
    sceneDepth.tDepth.value = read.depthTexture;
    sceneDepth.uNear.value = camera.near;
    sceneDepth.uFar.value = camera.far;
    camera.layers.set(LAYER.late);
    camera.layers.enable(LAYER.mist);
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    renderer.autoClear = autoClear;
  }
}

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
  bloom.blendMaterial.blending = THREE.CustomBlending;
  bloom.blendMaterial.blendSrc = THREE.OneFactor;
  bloom.blendMaterial.blendDst = THREE.OneFactor;
}

export interface Post {
  bloom: UnrealBloomPass;
  render(dt: number, time: number, phase: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
}

/** HDR half-float target with 4x MSAA and a depth texture → scene in two goes → bloom → grade. */
export function makePost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, reduceMotion: boolean): Post {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new ScenePass(scene, camera));
  // Full resolution: the mockup's bloom was tuned at the size EffectComposer gives its passes.
  const bloom = new UnrealBloomPass(size.clone(), look.bloom.strength, look.bloom.radius, look.bloom.threshold);
  matchMockupBloom(bloom);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  onLook(() => {
    const g = look.grade;
    const u = grade.uniforms;
    u.uExposure.value = g.exposure;
    u.uContrast.value = g.contrast;
    u.uSaturation.value = g.saturation;
    u.uShadows.value.set(...g.shadows);
    u.uHighlights.value.set(...g.highlights);
    displayRGB(g.blacks, u.uBlacks.value);
    u.uVignette.value = g.vignette;
    // No grain under reduced motion.
    u.uGrain.value = reduceMotion ? 0 : g.grain;
    u.uAberration.value = g.aberration;
    // matchMockupBloom's composite adds once at strength, where three would add 3x.
    bloom.strength = look.bloom.strength / 3;
    bloom.radius = look.bloom.radius;
    bloom.threshold = look.bloom.threshold;
  });
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
