import * as THREE from 'three';
import type { WorldData } from '../data';
import type { Heights } from './heights';
import { fbm, range, rng } from './math';
import type { Materials } from './materials';

/** Instanced conifers on the hills, and autumn trees on the shore, the plateau edge and the outcrop. */
export function makeTrees(world: WorldData, heights: Heights, M: Materials, viaductEnd: THREE.Vector3): THREE.Group {
  const rand = rng(3131);
  const rr = (a: number, b: number) => range(rand, a, b);
  const group = new THREE.Group();
  group.name = 'trees';
  const { cliff, outcrop, plateau } = world;
  const d = new THREE.Object3D();
  const c = new THREE.Color();

  const conG = new THREE.ConeGeometry(1, 1, 7);
  conG.translate(0, 0.5, 0);
  const con = new THREE.InstancedMesh(conG, new THREE.MeshStandardMaterial({ name: 'conifer', roughness: 0.95, flatShading: true }), 2600);
  let n = 0;
  for (let i = 0; i < 9000 && n < 2600; i++) {
    const x = rr(-1100, 1100);
    const z = rr(-1100, 1100);
    const h = heights.terrain(x, z);
    if (h < 2 || h > 170) continue;
    if (Math.hypot(x - cliff.center[0], z - cliff.center[1]) < 114 || Math.hypot(x - outcrop.center[0], z - outcrop.center[1]) < 50) continue;
    const slope = Math.hypot(heights.terrain(x + 4, z) - h, heights.terrain(x, z + 4) - h) / 4;
    if (slope > 0.9) continue;
    if (fbm(x * 0.008, z * 0.008, 3) < -0.12) continue;
    const s = rr(0.8, 1.4);
    d.position.set(x, h - 0.6, z);
    d.scale.set(rr(2.4, 3.6) * s, rr(9, 16) * s, rr(2.4, 3.6) * s);
    d.rotation.set(0, rand() * 6, 0);
    d.updateMatrix();
    con.setMatrixAt(n, d.matrix);
    c.setRGB(rr(0.012, 0.022), rr(0.03, 0.05), rr(0.03, 0.045));
    con.setColorAt(n, c);
    n++;
  }
  con.count = n;
  con.castShadow = true;
  con.receiveShadow = true;
  group.add(con);

  const palette = ['#8a3518', '#a3561c', '#6e2216', '#b07c25', '#5a2e17', '#94431a'].map((h) => new THREE.Color(h));
  const fol = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ name: 'foliage', roughness: 0.9, flatShading: true }),
    1560,
  );
  const trG = new THREE.CylinderGeometry(0.25, 0.4, 1, 5);
  trG.translate(0, 0.5, 0);
  const tr = new THREE.InstancedMesh(trG, M.wood, 520);
  let m = 0;
  let fm = 0;
  const place = (x: number, y: number, z: number, s: number) => {
    const th = rr(3, 5.5) * s;
    d.position.set(x, y - 0.3, z);
    d.scale.set(s, th, s);
    d.rotation.set(0, 0, 0);
    d.updateMatrix();
    tr.setMatrixAt(m, d.matrix);
    const base = palette[Math.floor(rand() * palette.length)];
    for (let k = 0; k < 3; k++) {
      const a = rand() * 6.28;
      const o = k ? rr(1.2, 2.2) * s : 0;
      d.position.set(x + Math.cos(a) * o, y + th + (k ? rr(0.4, 2.6) : 1.6) * s, z + Math.sin(a) * o);
      const sc = k ? rr(0.55, 0.8) : 1;
      d.scale.set(rr(2.6, 3.6) * s * sc, rr(2.6, 3.8) * s * sc, rr(2.6, 3.6) * s * sc);
      d.rotation.set(rand() * 3, rand() * 6, rand() * 3);
      d.updateMatrix();
      fol.setMatrixAt(fm, d.matrix);
      c.copy(base).multiplyScalar(rr(0.6, 1.0));
      fol.setColorAt(fm, c);
      fm++;
    }
    m++;
  };
  // Shore and hills around the cliff.
  for (let i = 0; i < 6000 && m < 420; i++) {
    const a = rand() * Math.PI * 2;
    const r = rr(108, 340);
    const x = Math.cos(a) * r + (rand() < 0.3 ? outcrop.center[0] * 0.6 : 0);
    const z = Math.sin(a) * r;
    const h = heights.terrain(x, z);
    if (h < 0.8 || h > 45) continue;
    if (Math.hypot(x - outcrop.center[0], z - outcrop.center[1]) < 44) continue;
    place(x, h, z, rr(0.8, 1.3));
  }
  // The plateau edge, leaving the hall's lake front clear.
  const { x: hx, z: hz } = world.hall;
  for (let i = 0; i < 70 && m < 520; i++) {
    const a = rand() * Math.PI * 2;
    const r = rr(73, 80);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z > hz[0] - 13 && z < hz[1] + 15 && x > hx[0] - 7 && x < hx[1] + 7) continue;
    place(x, plateau, z, rr(0.6, 0.9));
  }
  // The outcrop rim, away from the gate and the viaduct landing.
  for (let i = 0; i < 30 && m < 520; i++) {
    const a = rand() * Math.PI * 2;
    const r = rr(24, 29);
    const x = outcrop.center[0] + Math.cos(a) * r;
    const z = outcrop.center[1] + Math.sin(a) * r;
    if (z > 74 || Math.hypot(x - viaductEnd.x, z - viaductEnd.z) < 12) continue;
    place(x, outcrop.top, z, rr(0.6, 0.85));
  }
  fol.count = fm;
  tr.count = m;
  fol.castShadow = tr.castShadow = true;
  fol.receiveShadow = true;
  group.add(fol, tr);
  return group;
}
