import * as THREE from 'three';
import { LAYER } from '../render/layers';

// Additive point sprites for lanterns, flames, wisps and trails. Sizes are in world metres. They
// draw on the late layer, after the mist (render/layers.ts).

const VS = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.5);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
  }`;
const FS = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor.rgb * a, vColor.a * a);
  }`;

const materials: THREE.ShaderMaterial[] = [];
let glowMap: THREE.Texture | null = null;

export function initSprites(glow: THREE.Texture) {
  glowMap = glow;
}

function spriteMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    name: 'sprite',
    uniforms: { uMap: { value: glowMap }, uScale: { value: 500 } },
    vertexShader: VS,
    fragmentShader: FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  materials.push(m);
  return m;
}

/** Converts world size to pixels: call on resize with the drawing-buffer height and vertical FOV. */
export function setSpriteScale(bufferHeight: number, fovDeg: number) {
  const s = bufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  for (const m of materials) m.uniforms.uScale.value = s;
}

export type SpriteStyle = (i: number, t: number, pool: Pool) => void;

/** A ring buffer of short-lived particles. */
export class Pool {
  readonly n: number;
  readonly pos: Float32Array;
  readonly col: Float32Array;
  readonly size: Float32Array;
  readonly vel: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly points: THREE.Points;
  private next = 0;

  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1e9);
    this.life = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, spriteMaterial());
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER.late);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    const i = this.next;
    this.next = (i + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
  }

  /** Advance live particles with exponential drag; `style` sets colour and size from normalised age. */
  update(dt: number, drag: number, style: SpriteStyle) {
    const k = Math.exp(-drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) {
        this.size[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      for (let j = 0; j < 3; j++) {
        this.vel[i * 3 + j] *= k;
        this.pos[i * 3 + j] += this.vel[i * 3 + j] * dt;
      }
      style(i, t, this);
    }
    this.flush();
  }

  /** Mark attributes dirty after writing pos/col/size directly. */
  flush() {
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = true;
  }
}

/** Fixed glows (lanterns): one draw for all of them. */
export function staticGlow(spots: THREE.Vector3[], color: [number, number, number], size: number, rand: () => number): THREE.Points {
  const n = spots.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 4);
  const sz = new Float32Array(n);
  spots.forEach((p, i) => {
    pos.set([p.x, p.y, p.z], i * 3);
    col.set([color[0], color[1], color[2], 1], i * 4);
    sz[i] = size * (0.85 + rand() * 0.3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const p = new THREE.Points(g, spriteMaterial());
  p.frustumCulled = false;
  p.layers.set(LAYER.late);
  return p;
}
