import * as THREE from 'three';
import type { MistBank } from '../data';
import { LAYER, sceneDepth } from '../render/layers';
import { look, onLook } from '../render/look';
import type { Heights } from './heights';
import { range, rng } from './math';

export interface Mist {
  mesh: THREE.Mesh;
  update(time: number): void;
}

const VS = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec4 aShape; // width, height, spin phase, opacity
  attribute vec3 aDrift; // phase, speed, tint
  uniform float uTime, uSpin;
  varying vec2 vUv;
  varying float vAlpha, vTint, vDepth;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    // Slow wander round each bank's home, and a slower turn of its texture.
    vec3 c = aCenter;
    c.x += sin(uTime * aDrift.y + aDrift.x) * 12.0;
    c.z += cos(uTime * aDrift.y * 0.8 + aDrift.x) * 10.0;
    float a = aShape.z + uTime * 0.004 * uSpin;
    vUv = mat2(cos(a), sin(a), -sin(a), cos(a)) * (uv - 0.5) + 0.5;
    vec4 mvPosition = viewMatrix * vec4(c, 1.0);
    mvPosition.xy += position.xy * aShape.xy;
    vWorld = c + (vec4(position.xy * aShape.xy, 0.0, 0.0) * viewMatrix).xyz;
    vAlpha = aShape.w;
    vTint = aDrift.z;
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FS = /* glsl */ `
  #include <packing>
  uniform sampler2D uMap, tDepth;
  uniform float uNear, uFar, uOpacity, uSoft, uMoonGlow;
  uniform vec2 uFade;
  uniform vec3 uColor, uMoonDir;
  varying vec2 vUv;
  varying float vAlpha, vTint, vDepth;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(uMap, vUv).a * vAlpha * uOpacity;
    // Soft particles: fade out where the mist meets whatever is behind it, so a bank sitting on the
    // lake or against the cliff never shows a hard line.
    float scene = -perspectiveDepthToViewZ(texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).x, uNear, uFar);
    a *= clamp((scene - vDepth) / uSoft, 0.0, 1.0);
    // And near the camera, so flying through a bank thins it instead of filling the screen.
    a *= smoothstep(uFade.x, uFade.y, vDepth);
    if (a < 0.002) discard;
    vec3 v = normalize(vWorld - cameraPosition);
    vec3 col = uColor * vTint * (1.0 + uMoonGlow * pow(max(dot(v, uMoonDir), 0.0), 6.0));
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }`;

/**
 * Mist banks as soft billboards in one instanced draw, on the mist layer: drawn after the opaque
 * scene so they can read its depth (render/layers.ts). Banks may now sit right on the water.
 */
export function makeMist(banks: MistBank[], heights: Heights, map: THREE.Texture, moonDir: THREE.Vector3, reduceMotion: boolean): Mist {
  const rand = rng(777);
  const rr = (a: number, b: number) => range(rand, a, b);
  const centers: number[] = [];
  const shapes: number[] = [];
  const drifts: number[] = [];
  for (const b of banks) {
    for (let i = 0; i < b.count; i++) {
      let x: number;
      let y: number;
      let z: number;
      if ('ring' in b) {
        const a = rand() * Math.PI * 2;
        const r = rr(b.ring[0], b.ring[1]);
        x = Math.cos(a) * r;
        y = rr(b.y[0], b.y[1]);
        z = Math.sin(a) * r;
      } else {
        x = rr(b.min[0], b.max[0]);
        y = rr(b.min[1], b.max[1]);
        z = rr(b.min[2], b.max[2]);
      }
      const s = rr(b.size[0], b.size[1]);
      // Two thirds of each billboard stays above whatever it floats over; the rest fades into it.
      const h = s * (b.aspect ?? 0.42);
      y = Math.max(y, Math.max(heights.ground(x, z), heights.terrain(x, z), 0) + h / 6);
      centers.push(x, y, z);
      shapes.push(s, h, rand() * 6, rr(b.opacity[0], b.opacity[1]));
      drifts.push(rand() * 6, rr(0.01, 0.03), b.tint ?? 1);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('uv', quad.getAttribute('uv'));
  g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3));
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(shapes), 4));
  g.setAttribute('aDrift', new THREE.InstancedBufferAttribute(new Float32Array(drifts), 3));
  g.instanceCount = centers.length / 3;

  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...sceneDepth,
    uMap: { value: map },
    uTime: { value: 0 },
    uSpin: { value: reduceMotion ? 0 : 1 },
    uOpacity: { value: 1 },
    uSoft: { value: 1 },
    uFade: { value: new THREE.Vector2() },
    uColor: { value: new THREE.Color() },
    uMoonDir: { value: moonDir },
    uMoonGlow: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'mist',
    uniforms,
    vertexShader: VS,
    fragmentShader: FS,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  onLook(() => {
    const m = look.mist;
    uniforms.uColor.value.set(m.color);
    uniforms.uOpacity.value = m.opacity;
    uniforms.uSoft.value = Math.max(0.01, m.softness);
    uniforms.uFade.value.set(m.near[0], Math.max(m.near[1], m.near[0] + 0.01));
    uniforms.uMoonGlow.value = m.moonGlow;
  });

  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'mist';
  // Instances wander over the whole world; and it goes first among the late things, so lanterns
  // and ghosts in or behind a bank still glow through it.
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.layers.set(LAYER.mist);
  return {
    mesh,
    update(time) {
      uniforms.uTime.value = time;
    },
  };
}
