import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export interface Water {
  mesh: Reflector;
  setSize(width: number, height: number): void;
  update(time: number, fogDensity: number): void;
}

/** The lake: a half-resolution planar reflection with ripple distortion, fresnel and its own fog. */
export function makeWater(width: number, height: number, fogColor: THREE.Color, fogDensity: number, scale = 0.5): Water {
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
        uTime: { value: 0 },
        uFog: { value: fogColor },
        uDensity: { value: fogDensity },
      },
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = textureMatrix * vec4(position, 1.0);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec3 uFog;
        uniform float uDensity;
        varying vec4 vUv;
        varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz * 0.06;
          float n = sin(p.x * 3.1 + uTime * 0.7) * sin(p.y * 2.3 - uTime * 0.5)
            + 0.5 * sin((p.x + p.y) * 5.7 + uTime * 1.1)
            + 0.25 * sin(p.x * 11.0 - p.y * 7.0 + uTime * 1.7);
          float d = length(cameraPosition - vWorld);
          // Ripple distortion grows with distance.
          vec4 uv = vUv;
          uv.x += n * 0.012 * uv.w;
          uv.y += n * 0.02 * uv.w * (1.0 + d * 0.002);
          vec3 refl = texture2DProj(tDiffuse, uv).rgb;
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = 0.3 + 0.7 * pow(1.0 - max(V.y, 0.0), 4.0);
          vec3 c = mix(vec3(0.004, 0.006, 0.01), refl * vec3(0.72, 0.8, 0.92), fres);
          float f = 1.0 - exp(-pow(uDensity * d, 2.0));
          gl_FragColor = vec4(mix(c, uFog, f), 1.0);
        }`,
    },
  });
  mesh.name = 'water';
  mesh.rotation.x = -Math.PI / 2;
  const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
  return {
    mesh,
    setSize(w, h) {
      mesh.getRenderTarget().setSize(Math.floor(w * scale), Math.floor(h * scale));
    },
    update(time, density) {
      uniforms.uTime.value = time;
      uniforms.uDensity.value = density;
    },
  };
}
