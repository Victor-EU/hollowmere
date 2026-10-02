import * as THREE from 'three';
import { box, matrix, prism } from './geom';
import type { Kit } from './kit';
import { curtainWall } from './wall';

export interface GateSpec {
  at: THREE.Vector3;
  stairs: number;
  /** Terrain height, so the stairs stop at the shore path. */
  ground: (x: number, z: number) => number;
  crest: THREE.Texture;
}

/** A crouching gargoyle from primitives (M4 gives the gate pair heads that turn). */
function gargoyle(M: Kit['M']): THREE.Group {
  const g = new THREE.Group();
  const part = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, M.dark);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  part(new THREE.SphereGeometry(1, 12, 10), 0, 1.1, 0).scale.set(1.05, 1.1, 1.3);
  part(new THREE.SphereGeometry(0.62, 10, 8), 0, 2.3, 0.95);
  for (const hx of [-0.3, 0.3]) part(new THREE.ConeGeometry(0.14, 0.9, 5), hx, 2.9, 0.75).rotation.x = -0.5;
  for (const wx of [-1, 1]) {
    const w = part(new THREE.ConeGeometry(0.9, 2.6, 3), wx * 0.9, 2.1, -0.4);
    w.rotation.z = -wx * 0.5;
    w.scale.set(1, 1, 0.25);
  }
  return g;
}

/** Gate pillars and arch, iron leaves swung open, flanking walls, and stairs down to the shore. */
export function gate(k: Kit, gs: GateSpec): THREE.Vector3[] {
  const { M, rand } = k;
  const G = gs.at;
  const y0 = G.y;
  const lanterns: THREE.Vector3[] = [];
  const bannerMat = new THREE.MeshStandardMaterial({ name: 'banner', map: gs.crest, roughness: 0.85, side: THREE.DoubleSide });

  for (const sx of [-1, 1]) {
    const x = G.x + sx * 6;
    k.add(box(4.0, 2.2, 4.0, rand() * 16, 0), M.stone, matrix(x, y0 + 0.1, G.z));
    k.add(box(3.2, 11.8, 3.2, rand() * 16, 1.2), M.stone, matrix(x, y0 + 1.2 + 5.9, G.z));
    k.add(box(3.7, 0.45, 3.7, rand() * 16, 0), M.stone, matrix(x, y0 + 13.2, G.z));
    k.add(box(4.2, 0.6, 4.2, rand() * 16, 0), M.stone, matrix(x, y0 + 13.7, G.z));
    const gg = gargoyle(M);
    gg.position.set(x, y0 + 14, G.z);
    k.addObject(gg);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5.5), bannerMat);
    banner.position.set(x, y0 + 7.5, G.z + 1.66);
    k.addObject(banner);
    // Lanterns hang inside the gateway, on the pillars' inner faces.
    lanterns.push(new THREE.Vector3(G.x + sx * 3.95, y0 + 6.2, G.z + 1.2));
  }

  // A round arch between the pillars, springing from their inner faces.
  {
    const span = 8.8;
    const spring = 8.6;
    const ring = 0.95;
    const s = new THREE.Shape();
    s.absarc(0, spring, span / 2 + ring, Math.PI, 0, true);
    s.absarc(0, spring, span / 2, 0, Math.PI, false);
    s.closePath();
    k.add(prism(s, 2.6, 16), M.stone, matrix(G.x, y0, G.z));
    // A keystone that stands proud.
    k.add(box(0.9, 1.5, 2.9, rand() * 16, 0), M.stone, matrix(G.x, y0 + spring + span / 2 + 0.55, G.z));
  }

  // Iron gate leaves, swung open.
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(G.x + sx * 4.4, y0, G.z);
    pivot.rotation.y = sx * -1.2;
    const bar = (w: number, h: number, d: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.iron);
      m.position.set(x, y, 0);
      pivot.add(m);
    };
    for (let i = 0; i <= 7; i++) bar(0.14, 8.6, 0.14, -sx * (i * 0.6), 4.3);
    for (const y of [1, 4.5, 8]) bar(4.4, 0.2, 0.18, -sx * 2.2, y);
    // Spear points along the top.
    for (let i = 0; i <= 7; i++) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 4), M.iron);
      m.position.set(-sx * (i * 0.6), 8.85, 0);
      pivot.add(m);
    }
    k.addObject(pivot);
  }

  // Flanking walls, crenellated, facing out over the stairs.
  for (const [a, b] of [
    [G.x - 19, G.x - 7.6],
    [G.x + 7.6, G.x + 19],
  ]) {
    curtainWall(k, { ax: a, az: G.z, bx: b, bz: G.z, base: y0 - 3, top: y0 + 6, thickness: 2.2, outside: [G.x, G.z + 50] });
  }

  // Landing, then stairs down to the shore path between stepped cheek walls.
  k.add(box(10, 0.8, 12, rand() * 8, rand() * 8), M.floor, matrix(G.x, y0 + 0.2, G.z + 6));
  let y = y0;
  let z = G.z + 12;
  const step = box(8, 1.1, 1.9);
  const cheek = box(0.7, 2.4, 1.9);
  for (let i = 0; i < gs.stairs; i++) {
    if (y < gs.ground(G.x, z) + 0.4) break;
    k.add(step, M.floor, matrix(G.x, y - 0.4, z));
    for (const sx of [-1, 1]) k.add(cheek, M.stone, matrix(G.x + sx * 4.35, y + 0.35, z));
    if (i % 4 === 0) for (const sx of [-1, 1]) lanterns.push(new THREE.Vector3(G.x + sx * 4.6, y + 2.2, z));
    y -= 0.85;
    z += 1.7;
  }
  return lanterns;
}
