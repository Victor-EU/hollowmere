import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER } from '../render/layers';
import { lerp } from '../world/math';

/** Lathe profile: flared skirt below, dome head above. About 1.6 m tall before scaling. */
function ghostGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 18; i++) {
    const y = lerp(-0.66, 0.45, i / 18);
    pts.push(new THREE.Vector2(0.55 + 0.2 * Math.pow(Math.max(0, 0.45 - y) / 1.11, 1.7), y));
  }
  for (let i = 1; i <= 14; i++) {
    const a = ((i / 14) * Math.PI) / 2;
    pts.push(new THREE.Vector2(Math.cos(a) * 0.55, 0.45 + Math.sin(a) * 0.55));
  }
  // Not exactly 0: a zero radius gives the apex a degenerate normal (NaN), which smears bloom across the screen.
  pts[pts.length - 1].x = 0.0001;
  return new THREE.LatheGeometry(pts, 48);
}

let sharedGeometry: THREE.LatheGeometry | null = null;
let faceGeometry: THREE.BufferGeometry | null = null;

/** The body's lathe, shared by every ghost (and the player's shadow stand-in). */
export function ghostBody(): THREE.LatheGeometry {
  return (sharedGeometry ??= ghostGeometry());
}

/** Two dark eyes and a small round mouth, merged: one draw per ghost instead of three. */
function ghostFace(): THREE.BufferGeometry {
  if (faceGeometry) return faceGeometry;
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.CircleGeometry(0.075, 20);
    e.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(sx * 0.17, 0.56, 0.52), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, sx * 0.3, 0)), new THREE.Vector3(1, 1.5, 1)));
    parts.push(e);
  }
  const mouth = new THREE.CircleGeometry(0.055, 18);
  mouth.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.36, 0.545), new THREE.Quaternion(), new THREE.Vector3(1, 1.35, 1)));
  parts.push(mouth);
  faceGeometry = mergeGeometries(parts)!;
  return faceGeometry;
}

export interface GhostUniforms {
  [name: string]: THREE.IUniform;
  uTime: { value: number };
  uBend: { value: THREE.Vector3 };
  uSeed: { value: number };
  uColor: { value: THREE.Color };
  uGlow: { value: number };
  uOpacity: { value: number };
  /** Lengthens the skirt below the waist; 1 is the player's. */
  uStretch: { value: number };
}

/** Fresnel-rim translucent sheet; the hem waves and bends against velocity in the vertex shader. */
function ghostMaterial(seed: number, glow: number): THREE.ShaderMaterial & { uniforms: GhostUniforms } {
  return new THREE.ShaderMaterial({
    name: 'ghost',
    uniforms: {
      uTime: { value: 0 },
      uBend: { value: new THREE.Vector3() },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(0.72, 0.84, 1.0) },
      uGlow: { value: glow },
      uOpacity: { value: 1 },
      uStretch: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBend;
      uniform float uSeed;
      uniform float uStretch;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec3 p = position;
        float a = atan(p.z, p.x);
        float low = smoothstep(0.35, -0.66, p.y);
        if (p.y < 0.0) p.y *= uStretch;
        p.y += (sin(a * 7.0 + uTime * 4.0 + uSeed) * 0.07 + sin(a * 3.0 - uTime * 2.3 + uSeed * 2.0) * 0.05) * low;
        p.xz *= 1.0 + 0.06 * sin(uTime * 2.0 + p.y * 4.0 + uSeed) * low;
        p += uBend * low * low;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vY = position.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uGlow;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec3 n = normalize(vN);
        float f = pow(1.0 - abs(dot(n, vV)), 1.8);
        float hem = smoothstep(-0.7, -0.05, vY);
        float a = (0.07 + 0.62 * f) * mix(0.1, 1.0, hem) * uOpacity;
        gl_FragColor = vec4(uColor * (0.45 + 1.5 * f) * uGlow, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }) as THREE.ShaderMaterial & { uniforms: GhostUniforms };
}

export interface Ghost {
  group: THREE.Group;
  uniforms: GhostUniforms;
}

let faceMaterial: THREE.MeshBasicMaterial | null = null;

/**
 * An invisible stand-in for the player's body that casts the shadow in the Warden's lantern light.
 * The see-through body draws on a late layer, which the shadow pass never sees (it tests the main
 * camera's layers), so this solid copy sits on layer 0, drawing nothing but depth into shadow
 * maps. It starts casting once the moon's map is drawn (render/shadows.ts), so it's never in it.
 */
export function ghostShadow(): THREE.Mesh {
  const m = new THREE.Mesh(ghostBody(), new THREE.MeshBasicMaterial({ name: 'ghost-shadow', colorWrite: false, depthWrite: false }));
  m.name = 'ghost-shadow';
  m.userData.spotCaster = true;
  return m;
}

/** A ghost: the shared body plus two dark eyes and a small round mouth. Faces +z. */
export function makeGhost(seed: number, glow: number): Ghost {
  const group = new THREE.Group();
  const material = ghostMaterial(seed, glow);
  const body = new THREE.Mesh(ghostBody(), material);
  body.renderOrder = 5;
  // See-through: drawn after the mist, sorted with the glows (render/layers.ts).
  body.layers.set(LAYER.late);
  group.add(body);
  faceMaterial ??= new THREE.MeshBasicMaterial({ name: 'ghost-face', color: new THREE.Color('#06070c'), fog: false });
  const face = new THREE.Mesh(ghostFace(), faceMaterial);
  face.name = 'ghost-face';
  group.add(face);
  return { group, uniforms: material.uniforms };
}
