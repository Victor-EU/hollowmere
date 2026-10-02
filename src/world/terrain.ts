import * as THREE from 'three';
import type { RockColumn, WorldData } from '../data';
import type { Heights } from './heights';
import { fbm, noise2, smoothstep } from './math';

export function makeTerrain(world: WorldData, heights: Heights): THREE.Mesh {
  const { size, segments } = world.terrain;
  const g = new THREE.PlaneGeometry(size, size, segments, segments);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, heights.terrain(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const col = new Float32Array(p.count * 3);
  const silt = new THREE.Color('#121518');
  const shore = new THREE.Color('#2b261f');
  const forest = new THREE.Color('#1a2620');
  const rock = new THREE.Color('#3a3d47');
  const snow = new THREE.Color('#aab4c8');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i);
    const ny = n.getY(i);
    const v = fbm(p.getX(i) * 0.02, p.getZ(i) * 0.02, 3) * 0.5 + 0.5;
    if (h < -1) c.copy(silt);
    else if (h < 3) c.copy(shore);
    else {
      c.copy(forest).lerp(rock, smoothstep(0.86, 0.68, ny));
      c.lerp(snow, smoothstep(190 + v * 50, 240 + v * 50, h) * smoothstep(0.55, 0.75, ny));
    }
    c.multiplyScalar(0.8 + v * 0.4);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'terrain', vertexColors: true, roughness: 0.96 }));
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

/** A craggy rock column (the castle cliff or the gate outcrop): a noise-displaced, flat-shaded cylinder. */
export function makeRockColumn(o: RockColumn, name: string): THREE.Mesh {
  const H = o.top - o.bottom;
  const g = new THREE.CylinderGeometry(o.topRadius, o.bottomRadius, H, 64, 16, false);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const top = new THREE.Color('#1f2a22');
  const rock = new THREE.Color('#3b3e48');
  const dark = new THREE.Color('#1c1d23');
  const moss = new THREE.Color('#2c3a2a');
  const c = new THREE.Color();
  const seed = o.seed;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const t = (y + H / 2) / H;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const isTop = y > H / 2 - 0.01;
    const tt = isTop ? 1 : t;
    let f = 1 + 0.07 * noise2(ca * 1.6 + seed, sa * 1.6 + tt * 0.8) + 0.05 * noise2(ca * 6 + seed, sa * 6 + tt * 3) + 0.025 * noise2(ca * 20, sa * 20 + tt * 9);
    if (!isTop) f += 0.03 * noise2(ca * 3 + 4, tt * 14) * (1 - t);
    p.setX(i, x * f);
    p.setZ(i, z * f);
    if (!isTop && t < 0.97) p.setY(i, y + noise2(ca * 4 + seed, sa * 4) * 2.2);
    const v = noise2(ca * 9 + seed, sa * 9 + t * 7) * 0.5 + 0.5;
    if (isTop && r < o.topRadius - 0.5) c.copy(top).multiplyScalar(0.8 + v * 0.4);
    else {
      c.copy(dark).lerp(rock, smoothstep(0.0, 0.8, t) * (0.6 + v * 0.6));
      c.lerp(moss, smoothstep(0.82, 0.98, t) * v);
    }
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'rock', vertexColors: true, roughness: 0.95, flatShading: true }));
  mesh.name = name;
  mesh.position.set(o.center[0], (o.top + o.bottom) / 2, o.center[1]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
