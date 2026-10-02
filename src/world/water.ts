import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { LAYER } from '../render/layers';
import { look, onLook } from '../render/look';

export interface Water {
  mesh: Reflector;
  setSize(width: number, height: number): void;
  /** A planar reflection at `scale` of the screen's resolution, or 'probe': a cube map caught once from the middle of the lake. */
  setReflection(mode: number | 'probe'): void;
  /** Redraw the probe (after the textures sharpen, say), leaving out `hide`: things that move, which a still reflection would freeze. Does nothing without a probe. */
  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hide: THREE.Object3D[]): void;
  update(time: number, fogDensity: number): void;
}

const VS = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = textureMatrix * vec4(position, 1.0);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FS = /* glsl */ `
  uniform sampler2D tDiffuse, tRipples;
  uniform samplerCube tProbe;
  uniform vec3 uProbeAt;
  uniform float uProbeRadius;
  uniform float uTime, uDensity, uReflect, uRipple, uScale, uDistort, uGlitter, uSharp;
  uniform vec3 uFog, uDeep, uTint, uMoonDir, uMoonColor;
  varying vec4 vUv;
  varying vec3 vWorld;
  vec2 slope(vec2 p) { return texture2D(tRipples, p).rg * 2.0 - 1.0; }
  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float d = length(toCam);
    vec3 V = toCam / d;
    // Three layers of ripples drifting different ways; the long swell slowest.
    vec2 p = vWorld.xz / uScale;
    vec2 s = slope(p + uTime * vec2(0.013, 0.008))
      + slope(p * 2.7 + uTime * vec2(-0.021, 0.017)) * 0.55
      + slope(p * 0.31 + uTime * vec2(0.004, -0.006)) * 0.8;
    vec3 N = normalize(vec3(-s.x * uRipple, 1.0, -s.y * uRipple));
    #ifdef PROBE
      // The probe saw the world from the lake's middle. Treating what it saw as lying on a sphere
      // around it, about as far off as the shores, puts each reflection near where it belongs
      // seen from here. The ripples bend it about as much as they bend the planar one, and
      // nothing reflects from below the horizon, where the probe saw only the lake bed.
      vec3 r = reflect(-V, normalize(vec3(N.x * uDistort, 1.0, N.z * uDistort)));
      r = normalize(vec3(r.x, max(r.y, 0.001), r.z));
      vec3 q = vWorld - uProbeAt;
      float b = dot(q, r);
      float t = -b + sqrt(max(b * b - dot(q, q) + uProbeRadius * uProbeRadius, 0.0));
      vec3 refl = textureCube(tProbe, q + r * t).rgb;
    #else
      // The ripples bend the reflection, more with distance, as the old sine ripple did.
      vec4 uv = vUv;
      uv.x += N.x * uDistort * uv.w;
      uv.y += N.z * uDistort * uv.w * (1.0 + d * 0.002);
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
    #endif
    float fres = uReflect + (1.0 - uReflect) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 c = mix(uDeep, refl * uTint, fres);
    // The moon's glitter path, only where the reflection shows open sky, so the castle's
    // reflection doesn't sparkle.
    float g = pow(max(dot(reflect(-V, N), uMoonDir), 0.0), uSharp);
    float open = smoothstep(0.015, 0.08, dot(refl, vec3(0.2126, 0.7152, 0.0722)));
    c += uMoonColor * g * uGlitter * open;
    float f = 1.0 - exp(-pow(uDensity * d, 2.0));
    gl_FragColor = vec4(mix(c, uFog, f), 1.0);
  }`;

/** Probe faces, in pixels. */
const PROBE_SIZE = 384;

/**
 * The lake: a planar reflection bent by scrolling ripple normals, Schlick fresnel over a
 * near-black base, the moon's glitter path, and its own fog. The reflection includes the late
 * layer (glows, ghosts) but not the mist, whose soft edges need a depth texture the reflection
 * doesn't have. The low tier swaps the planar reflection, which draws the scene a second time
 * every frame, for a probe drawn once: the castle still shows in the water, the creatures don't.
 */
export function makeWater(
  width: number,
  height: number,
  camera: THREE.Camera,
  fogColor: THREE.Color,
  ripples: THREE.Texture,
  moonDir: THREE.Vector3,
  /** Where the probe sits, and how far off the shores are from there. */
  probe: { at: THREE.Vector3; radius: number },
): Water {
  let scale = 0.5;
  const mesh = new Reflector(new THREE.PlaneGeometry(3000, 3000), {
    clipBias: 0.003,
    textureWidth: Math.floor(width * scale),
    textureHeight: Math.floor(height * scale),
    color: 0xffffff,
    multisample: 0,
    shader: {
      name: 'water',
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        tRipples: { value: null },
        tProbe: { value: null },
        uProbeAt: { value: probe.at },
        uProbeRadius: { value: probe.radius },
        uTime: { value: 0 },
        uDensity: { value: 0 },
        uReflect: { value: 0 },
        uRipple: { value: 0 },
        uScale: { value: 1 },
        uDistort: { value: 0 },
        uGlitter: { value: 0 },
        uSharp: { value: 1 },
        uFog: { value: null },
        uDeep: { value: new THREE.Color() },
        uTint: { value: new THREE.Vector3() },
        uMoonDir: { value: null },
        uMoonColor: { value: new THREE.Color() },
      },
      vertexShader: VS,
      fragmentShader: FS,
    },
  });
  mesh.name = 'water';
  mesh.rotation.x = -Math.PI / 2;
  mesh.getReflectionCamera(camera).layers.enable(LAYER.late);
  // Reflector clones its uniforms; share these so fog and moon follow the scene.
  const u = (mesh.material as THREE.ShaderMaterial).uniforms;
  u.tRipples.value = ripples;
  u.uFog.value = fogColor;
  u.uMoonDir.value = moonDir;
  onLook(() => {
    const w = look.water;
    u.uDeep.value.set(w.deep);
    u.uTint.value.set(...w.tint);
    u.uReflect.value = w.reflectivity;
    u.uRipple.value = w.ripple;
    u.uScale.value = w.scale;
    u.uDistort.value = w.distortion;
    u.uGlitter.value = w.glitter;
    u.uSharp.value = w.sharpness;
    u.uMoonColor.value.set(look.moonlight.color).multiplyScalar(look.moonlight.intensity);
  });
  const planar = mesh.material as THREE.ShaderMaterial;
  const reflect = mesh.onBeforeRender;
  let cube: { target: THREE.WebGLCubeRenderTarget; camera: THREE.CubeCamera; material: THREE.ShaderMaterial } | null = null;
  let size = { w: width, h: height };
  return {
    mesh,
    setSize(w, h) {
      size = { w, h };
      mesh.getRenderTarget().setSize(Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale)));
    },
    setReflection(mode) {
      if (mode === 'probe') {
        if (!cube) {
          const target = new THREE.WebGLCubeRenderTarget(PROBE_SIZE, { type: THREE.HalfFloatType });
          const cam = new THREE.CubeCamera(1, 9000, target);
          cam.position.copy(probe.at);
          for (const c of cam.children) c.layers.enable(LAYER.late);
          // Same uniforms, so the look panel and fog still reach it.
          const material = new THREE.ShaderMaterial({
            name: 'water-probe',
            uniforms: planar.uniforms,
            vertexShader: planar.vertexShader,
            fragmentShader: planar.fragmentShader,
            defines: { PROBE: '' },
          });
          u.tProbe.value = target.texture;
          cube = { target, camera: cam, material };
        }
        mesh.material = cube.material;
        mesh.onBeforeRender = () => {};
        // Let the planar target go while it isn't used.
        mesh.getRenderTarget().setSize(1, 1);
      } else {
        scale = mode;
        mesh.material = planar;
        mesh.onBeforeRender = reflect;
        this.setSize(size.w, size.h);
      }
    },
    capture(renderer, scene, hide) {
      if (!cube || mesh.material !== cube.material) return;
      const shown = [mesh, ...hide].filter((o) => o.visible);
      for (const o of shown) o.visible = false;
      cube.camera.update(renderer, scene);
      for (const o of shown) o.visible = true;
    },
    update(time, density) {
      u.uTime.value = time;
      u.uDensity.value = density;
    },
  };
}
