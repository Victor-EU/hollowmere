import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { LAYER } from '../render/layers';
import { look, onLook } from '../render/look';

export interface Water {
  mesh: Reflector;
  setSize(width: number, height: number): void;
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
    // The ripples bend the reflection, more with distance, as the old sine ripple did.
    vec4 uv = vUv;
    uv.x += N.x * uDistort * uv.w;
    uv.y += N.z * uDistort * uv.w * (1.0 + d * 0.002);
    vec3 refl = texture2DProj(tDiffuse, uv).rgb;
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

/**
 * The lake: a half-resolution planar reflection bent by scrolling ripple normals, Schlick
 * fresnel over a near-black base, the moon's glitter path, and its own fog. The reflection
 * includes the late layer (glows, ghosts) but not the mist, whose soft edges need a depth texture
 * the reflection doesn't have.
 */
export function makeWater(
  width: number,
  height: number,
  camera: THREE.Camera,
  fogColor: THREE.Color,
  ripples: THREE.Texture,
  moonDir: THREE.Vector3,
  scale = 0.5,
): Water {
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
  return {
    mesh,
    setSize(w, h) {
      mesh.getRenderTarget().setSize(Math.floor(w * scale), Math.floor(h * scale));
    },
    update(time, density) {
      u.uTime.value = time;
      u.uDensity.value = density;
    },
  };
}
