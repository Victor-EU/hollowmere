import * as THREE from 'three';
import type { WorldData } from '../data';
import { lerp, range, rng } from './math';
import type { Textures } from './textures';

export interface Sky {
  group: THREE.Group;
  moonDir: THREE.Vector3;
  update(dt: number): void;
}

/** Gradient dome with a moon glow, stars, the moon and its halo, and cloud sprites lit by their angle to the moon. */
export function makeSky(world: WorldData, tex: Textures, fogColor: THREE.Color): Sky {
  const group = new THREE.Group();
  group.name = 'sky';
  const moonDir = new THREE.Vector3(...world.moon.direction).normalize();
  const rand = rng(4242);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 48, 24),
    new THREE.ShaderMaterial({
      name: 'sky',
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uMoon: { value: moonDir }, uFog: { value: fogColor } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uMoon;
        uniform vec3 uFog;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 zen = vec3(0.0035, 0.005, 0.012);
          vec3 hor = vec3(0.028, 0.036, 0.06);
          vec3 c = mix(hor, zen, smoothstep(-0.02, 0.65, h));
          float m = max(dot(d, uMoon), 0.0);
          c += vec3(0.06, 0.075, 0.11) * pow(m, 5.0) + vec3(0.16, 0.17, 0.2) * pow(m, 40.0);
          c = mix(c, uFog, smoothstep(0.08, -0.06, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  group.add(dome);

  // Stars: additive points, denser and brighter overhead.
  {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = rand() * Math.PI * 2;
      const y = Math.pow(range(rand, 0.04, 1), 0.7);
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * 4600, y * 4600, Math.sin(th) * r * 4600], i * 3);
      const b = Math.pow(rand(), 3) * 1.6 + 0.12;
      const warm = rand();
      col.set([b * (0.9 + warm * 0.15), b * 0.95, b * (1.1 - warm * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 2.2,
        sizeAttenuation: false,
        vertexColors: true,
        map: tex.glow,
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    group.add(stars);
  }

  // Moon and halo.
  const moonPos = moonDir.clone().multiplyScalar(world.moon.distance);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex.glow,
      color: new THREE.Color(0.22, 0.26, 0.36),
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.position.copy(moonPos);
  halo.scale.set(2600, 2600, 1);
  halo.renderOrder = -8;
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex.moon, color: new THREE.Color(2.6, 2.55, 2.4), transparent: true, depthWrite: false, fog: false }),
  );
  moon.position.copy(moonPos);
  moon.scale.set(world.moon.size, world.moon.size, 1);
  moon.renderOrder = -7;
  group.add(halo, moon);

  // Clouds.
  const clouds: THREE.Sprite[] = [];
  const cloud = (pos: THREE.Vector3, sx: number, sy: number, alpha: number) => {
    const lit = Math.pow(Math.max(pos.clone().normalize().dot(moonDir), 0), 6);
    const mat = new THREE.SpriteMaterial({
      map: tex.cloud,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: alpha,
      color: new THREE.Color(lerp(0.035, 0.32, lit), lerp(0.042, 0.33, lit), lerp(0.065, 0.38, lit)),
    });
    mat.rotation = range(rand, -0.15, 0.15);
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.set(sx, sy, 1);
    s.renderOrder = -6;
    group.add(s);
    clouds.push(s);
  };
  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2;
    const d = range(rand, 1200, 2800);
    cloud(
      new THREE.Vector3(Math.cos(a) * d, range(rand, 380, 900), Math.sin(a) * d),
      range(rand, 1100, 2200),
      range(rand, 380, 700),
      range(rand, 0.55, 0.9),
    );
  }
  for (let i = 0; i < 4; i++) {
    const p = moonDir.clone().multiplyScalar(range(rand, 2300, 2800));
    p.x += range(rand, -260, 260);
    p.y += range(rand, -200, 120);
    p.z += range(rand, -120, 120);
    cloud(p, range(rand, 900, 1500), range(rand, 260, 420), range(rand, 0.45, 0.75));
  }

  return {
    group,
    moonDir,
    update(dt) {
      for (const c of clouds) c.material.rotation += 0.0006 * dt;
    },
  };
}
