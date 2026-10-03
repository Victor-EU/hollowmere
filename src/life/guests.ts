import * as THREE from 'three';
import { chain, cone, ellipsoid, J, limb, Rig } from './rig';

// The feast's guests (src/life/feast.ts), built from rig parts. Seated ones are drawn at human
// scale with the seat at y = 0, facing +z with the table edge just in front of them, and shown
// about twice that size, like everything in the hall. Their arms swing at the shoulder: the left
// (+x) on the front-left limb channel, the right (−x), which holds the goblet, on the front-right.
// All original folk of Halloween: a skeleton, a witch, a vampire, a werewolf, a mummy, a
// pumpkin-head and a ghost; a headless host holding up his own glowing head; and a witch who
// stands to stir the cauldron.

type V3 = [number, number, number];
type Paint = THREE.ColorRepresentation | ((p: THREE.Vector3) => THREE.ColorRepresentation);
const mirror = (p: V3, s: number): V3 => [p[0] * s, p[1], p[2]];

export const NECK: V3 = [0, 0.62, 0];
const SHOULDER = 0.19;

interface Dress {
  /** Torso, sleeves, hands. */
  coat: Paint;
  sleeve: Paint;
  hand: Paint;
  /** Torso radius at the waist and the chest; sleeve radius at the wrist (a witch's bells out). */
  waist?: number;
  chest?: number;
  cuff?: number;
  /** Shoulders are drawn by the guest (a skeleton has collarbones, not a coat). */
  noTorso?: boolean;
  /** Limb thickness: a skeleton's are bones. */
  thin?: number;
}

/** Thighs under the table, the torso, the arms resting on the table and the goblet in the right hand. */
function seated(r: Rig, d: Dress, goblet = true) {
  const k = d.thin ?? 1;
  for (const s of [1, -1]) r.add(limb(mirror([0.085, 0.07, 0], s), mirror([0.095, 0.08, 0.4], s), 0.075 * k, 0.06 * k), J.body, [0, 0, 0], d.coat);
  if (!d.noTorso) {
    r.add(limb([0, 0.02, 0], [0, 0.57, 0], d.waist ?? 0.19, d.chest ?? 0.16, 10), J.body, [0, 0, 0], d.coat);
    r.add(ellipsoid([0, 0.55, 0], [0.21, 0.075, 0.12], 0, 10), J.body, [0, 0, 0], d.coat);
  }
  for (const s of [1, -1]) {
    const sh: V3 = mirror([SHOULDER, 0.55, 0], s);
    const joint = s > 0 ? J.fl : J.fr;
    r.add(ellipsoid(sh, [0.06 * k, 0.06 * k, 0.06 * k], 0, 6), joint, sh, d.sleeve);
    r.add(limb(sh, mirror([0.21, 0.33, 0.05], s), 0.056 * k, 0.047 * k, 7), joint, sh, d.sleeve);
    if (k < 1) r.add(ellipsoid(mirror([0.21, 0.33, 0.05], s), [0.03, 0.03, 0.03], 0, 5), joint, sh, d.sleeve);
    r.add(limb(mirror([0.21, 0.33, 0.05], s), mirror([0.15, 0.31, 0.32], s), 0.047 * k, (d.cuff ?? 0.04) * k, 7), joint, sh, d.sleeve);
    r.add(ellipsoid(mirror([0.15, 0.31, 0.355], s), [0.034, 0.03, 0.045], 0, 6), joint, sh, d.hand);
  }
  if (goblet) {
    const sh: V3 = [-SHOULDER, 0.55, 0];
    r.add(ellipsoid([-0.15, 0.315, 0.365], [0.03, 0.006, 0.03], 0, 6), J.handProp, sh, '#b8933e');
    r.add(limb([-0.15, 0.315, 0.365], [-0.15, 0.4, 0.365], 0.011, 0.011, 4), J.handProp, sh, '#b8933e');
    r.add(limb([-0.15, 0.4, 0.365], [-0.15, 0.48, 0.365], 0.02, 0.042, 8), J.handProp, sh, '#d0aa4c');
    r.add(ellipsoid([-0.15, 0.475, 0.365], [0.036, 0.004, 0.036], 0, 6), J.handProp, sh, '#4a0a14');
  }
}

/** A ribbed pumpkin with a carved, glowing face on +z. */
export function pumpkin(r: Rig, at: V3, radius: number, joint: number, pivot: V3, glow: number) {
  const g = new THREE.SphereGeometry(1, 12, 8);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)];
    const rib = 1 - 0.08 * Math.pow(Math.abs(Math.sin(Math.atan2(z, x) * 5)), 0.6);
    p.setXYZ(i, x * rib * radius, y * 0.82 * radius, z * rib * radius);
  }
  g.translate(...at);
  r.add(g, joint, pivot, '#c4621a');
  r.add(limb([at[0], at[1] + radius * 0.75, at[2]], [at[0] + radius * 0.15, at[1] + radius * 1.25, at[2] - radius * 0.05], radius * 0.12, radius * 0.08, 5), joint, pivot, '#3b3a1a');
  const f = radius * 0.92;
  const face = '#ffb347';
  for (const s of [1, -1]) r.add(ellipsoid([at[0] + s * radius * 0.36, at[1] + radius * 0.2, at[2] + f * 0.93], [radius * 0.2, radius * 0.17, radius * 0.08], [0, 0, s * 0.5], 4), joint, pivot, face, glow);
  r.add(ellipsoid([at[0], at[1] - radius * 0.32, at[2] + f * 0.92], [radius * 0.48, radius * 0.13, radius * 0.08], 0, 6), joint, pivot, face, glow);
}

export function skeleton(): THREE.BufferGeometry {
  const r = new Rig();
  const bone = '#c9bfa6';
  const dark = '#1b1714';
  seated(r, { coat: bone, sleeve: bone, hand: bone, noTorso: true, thin: 0.45 });
  // Ribs: a cage banded light and dark; a spine; collarbones; a pelvis.
  r.add(ellipsoid([0, 0.42, 0.01], [0.15, 0.15, 0.1], 0, 12), J.body, [0, 0, 0], (p: THREE.Vector3) => (Math.floor((p.y - 0.27) * 32) % 2 ? dark : bone));
  r.add(limb([0, 0.06, -0.05], [0, 0.6, -0.04], 0.028, 0.026, 5), J.body, [0, 0, 0], bone);
  r.add(limb([-0.2, 0.56, 0], [0.2, 0.56, 0], 0.026, 0.026, 5), J.body, [0, 0, 0], bone);
  r.add(ellipsoid([0, 0.08, 0], [0.14, 0.06, 0.09], 0, 8), J.body, [0, 0, 0], bone);
  r.add(limb([0, 0.58, -0.02], [0, 0.68, 0], 0.025, 0.025, 5), J.head, NECK, bone);
  r.add(ellipsoid([0, 0.78, 0], [0.095, 0.11, 0.115], 0, 10), J.head, NECK, bone);
  r.add(ellipsoid([0, 0.69, 0.05], [0.07, 0.035, 0.065], 0, 8), J.head, NECK, bone);
  r.add(ellipsoid([0, 0.703, 0.103], [0.05, 0.012, 0.012], 0, 6), J.head, NECK, (p: THREE.Vector3) => (Math.floor(p.x * 90) % 2 ? dark : bone));
  for (const s of [1, -1]) r.add(ellipsoid(mirror([0.038, 0.79, 0.095], s), [0.03, 0.032, 0.02], 0, 6), J.head, NECK, '#8a5cff', 0.7);
  r.add(ellipsoid([0, 0.752, 0.11], [0.012, 0.018, 0.008], 0, 4), J.head, NECK, dark);
  // A crown for the one at the high table.
  r.add(limb([0, 0.86, 0], [0, 0.93, 0], 0.085, 0.09, 8), J.headProp, NECK, '#c9a24a');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    r.add(cone([Math.sin(a) * 0.085, 0.93, Math.cos(a) * 0.085], [Math.sin(a) * 0.09, 1.0, Math.cos(a) * 0.09], 0.018, 4), J.headProp, NECK, '#c9a24a');
  }
  return r.build();
}

/** A witch's head, hair and hat, `dy` above a seated guest's (the one on the broom in the sky wears it too). */
export function witchHead(r: Rig, dy: number) {
  const face = '#98a986';
  const hair = '#2b2a2f';
  const hat = '#151119';
  const at = (p: V3): V3 => [p[0], p[1] + dy, p[2]];
  const neck: V3 = at(NECK);
  r.add(limb(at([0, 0.56, 0]), at([0, 0.7, 0.01]), 0.045, 0.04, 6), J.head, neck, face);
  r.add(ellipsoid(at([0, 0.77, 0.02]), [0.08, 0.1, 0.085], 0, 10), J.head, neck, face);
  r.add(chain([at([0, 0.78, 0.09]), at([0, 0.75, 0.17]), at([0, 0.715, 0.19])], [0.024, 0.015, 0.007], 5), J.head, neck, face);
  r.add(ellipsoid(at([0, 0.69, 0.06]), [0.035, 0.03, 0.035], 0, 6), J.head, neck, face);
  r.add(ellipsoid(at([0, 0.75, -0.04]), [0.11, 0.14, 0.08], 0, 8), J.head, neck, hair);
  r.add(limb(at([0, 0.72, -0.07]), at([0, 0.48, -0.1]), 0.095, 0.06, 7), J.head, neck, hair);
  for (const s of [1, -1]) r.add(ellipsoid(at(mirror([0.032, 0.79, 0.083], s)), [0.013, 0.01, 0.006], 0, 4), J.head, neck, '#a8ff70', 1.6);
  r.add(ellipsoid(at([0, 0.86, 0]), [0.27, 0.014, 0.27], 0, 12), J.head, neck, hat);
  r.add(limb(at([0, 0.86, 0]), at([0, 0.9, 0]), 0.12, 0.115, 10), J.head, neck, '#5b2a6e');
  r.add(chain([at([0, 0.86, 0]), at([0, 1.05, -0.02]), at([0.03, 1.2, -0.08]), at([0.08, 1.28, -0.15])], [0.118, 0.08, 0.04, 0.008], 8), J.head, neck, hat);
}

export function witch(): THREE.BufferGeometry {
  const r = new Rig();
  seated(r, { coat: '#231a2b', sleeve: '#231a2b', hand: '#98a986', waist: 0.22, chest: 0.15, cuff: 0.075 });
  witchHead(r, 0);
  return r.build();
}

/** A tall high collar, black outside, blood-red inside. */
function collar(r: Rig, y: number) {
  for (const s of [1, -1]) {
    r.add(ellipsoid(mirror([0.11, y, -0.05], s), [0.11, 0.16, 0.014], [0, s * 0.55, s * -0.2], 8), J.body, [0, 0, 0], (p: THREE.Vector3) => (Math.abs(p.x) < 0.13 ? '#6e0f1a' : '#0d0d11'));
  }
}

export function vampire(): THREE.BufferGeometry {
  const r = new Rig();
  seated(r, { coat: '#0d0d11', sleeve: '#0d0d11', hand: '#d8d0c8', waist: 0.21, chest: 0.17 });
  r.add(ellipsoid([0, 0.45, 0.1], [0.055, 0.12, 0.03], 0, 6), J.body, [0, 0, 0], '#e6e1d8');
  r.add(ellipsoid([0, 0.52, 0.135], [0.03, 0.03, 0.02], 0, 6), J.body, [0, 0, 0], '#7a0c18');
  collar(r, 0.73);
  const face = '#d8d0c8';
  r.add(limb([0, 0.56, 0], [0, 0.7, 0.01], 0.045, 0.04, 6), J.head, NECK, face);
  r.add(ellipsoid([0, 0.78, 0.02], [0.08, 0.105, 0.09], 0, 10), J.head, NECK, face);
  r.add(ellipsoid([0, 0.82, -0.01], [0.088, 0.075, 0.095], 0, 8), J.head, NECK, '#0a0a0c');
  r.add(cone([0, 0.86, 0.06], [0, 0.82, 0.105], 0.035, 4), J.head, NECK, '#0a0a0c');
  for (const s of [1, -1]) {
    r.add(cone(mirror([0.078, 0.79, 0], s), mirror([0.11, 0.84, -0.04], s), 0.02, 4), J.head, NECK, face);
    r.add(ellipsoid(mirror([0.033, 0.79, 0.09], s), [0.012, 0.009, 0.006], 0, 4), J.head, NECK, '#ff2a2a', 1.8);
  }
  return r.build();
}

export function werewolf(): THREE.BufferGeometry {
  const r = new Rig();
  const fur = '#4a3e33';
  seated(r, { coat: '#5a4a3a', sleeve: fur, hand: '#2a221c', chest: 0.18 });
  r.add(ellipsoid([0, 0.38, 0], [0.22, 0.25, 0.16], 0, 10), J.body, [0, 0, 0], fur);
  r.add(ellipsoid([0, 0.46, 0.07], [0.17, 0.13, 0.1], 0, 8), J.body, [0, 0, 0], '#6b5b4b');
  r.add(ellipsoid([0, 0.57, 0], [0.26, 0.1, 0.16], 0, 10), J.body, [0, 0, 0], fur);
  r.add(ellipsoid([0, 0.68, -0.04], [0.13, 0.1, 0.12], 0, 8), J.head, NECK, fur);
  r.add(ellipsoid([0, 0.78, 0], [0.1, 0.095, 0.11], 0, 10), J.head, NECK, fur);
  r.add(limb([0, 0.75, 0.06], [0, 0.72, 0.23], 0.06, 0.035, 7), J.head, NECK, fur);
  r.add(ellipsoid([0, 0.722, 0.235], [0.02, 0.016, 0.016], 0, 4), J.head, NECK, '#0c0c0c');
  for (const s of [1, -1]) {
    r.add(cone(mirror([0.055, 0.86, -0.02], s), mirror([0.075, 0.98, -0.04], s), 0.04, 4), J.head, NECK, fur);
    r.add(ellipsoid(mirror([0.042, 0.8, 0.085], s), [0.013, 0.01, 0.006], 0, 4), J.head, NECK, '#ffc23a', 2);
  }
  return r.build();
}

export function mummy(): THREE.BufferGeometry {
  const r = new Rig();
  const wraps = (p: THREE.Vector3) => (((((p.y * 2 + p.x * 0.8 + p.z * 0.6) * 9) % 1) + 1) % 1 < 0.28 ? '#8f8469' : '#cbbf9f');
  seated(r, { coat: wraps, sleeve: wraps, hand: wraps, waist: 0.18, chest: 0.15 });
  r.add(limb([0, 0.56, 0], [0, 0.7, 0.01], 0.05, 0.045, 6), J.head, NECK, wraps);
  r.add(ellipsoid([0, 0.78, 0.01], [0.088, 0.105, 0.095], 0, 10), J.head, NECK, wraps);
  r.add(limb([0.05, 0.86, -0.05], [0.12, 0.62, -0.1], 0.02, 0.012, 4), J.head, NECK, '#b5a98b');
  r.add(ellipsoid([0.034, 0.8, 0.09], [0.014, 0.01, 0.006], 0, 4), J.head, NECK, '#7dff6a', 2.4);
  r.add(ellipsoid([-0.034, 0.8, 0.092], [0.016, 0.004, 0.005], 0, 4), J.head, NECK, '#1b1714');
  return r.build();
}

export function pumpkinHead(): THREE.BufferGeometry {
  const r = new Rig();
  const coat = (p: THREE.Vector3) => (Math.sin(p.x * 40) * Math.sin(p.y * 31) > 0.6 ? '#6b5233' : '#4b3726');
  seated(r, { coat, sleeve: coat, hand: '#b8954a' });
  for (const s of [1, -1]) r.add(cone(mirror([0.15, 0.31, 0.3], s), mirror([0.16, 0.27, 0.27], s), 0.03, 4), s > 0 ? J.fl : J.fr, mirror([SHOULDER, 0.55, 0], s), '#c9a24a');
  r.add(cone([0, 0.57, 0], [0, 0.65, 0.02], 0.08, 6), J.head, NECK, '#b8954a');
  pumpkin(r, [0, 0.79, 0], 0.15, J.head, NECK, 3);
  return r.build();
}

export function ghost(): THREE.BufferGeometry {
  const r = new Rig();
  const white = '#e6ecfa';
  r.add(limb([0, 0.0, 0.02], [0, 0.62, 0], 0.27, 0.17, 12), J.body, [0, 0, 0], white);
  r.add(ellipsoid([0, 0.76, 0], [0.17, 0.18, 0.16], 0, 12), J.head, NECK, white);
  for (const s of [1, -1]) {
    r.add(ellipsoid(mirror([0.05, 0.8, 0.14], s), [0.026, 0.036, 0.012], 0, 6), J.head, NECK, '#1a1d2a');
    const sh: V3 = mirror([0.17, 0.52, 0], s);
    r.add(limb(sh, mirror([0.17, 0.34, 0.26], s), 0.06, 0.035, 6), s > 0 ? J.fl : J.fr, sh, white);
  }
  r.add(ellipsoid([0, 0.72, 0.15], [0.02, 0.028, 0.01], 0, 6), J.head, NECK, '#1a1d2a');
  const sh: V3 = [-0.17, 0.52, 0];
  r.add(ellipsoid([-0.17, 0.33, 0.27], [0.03, 0.006, 0.03], 0, 6), J.handProp, sh, '#b8933e');
  r.add(limb([-0.17, 0.33, 0.27], [-0.17, 0.42, 0.27], 0.011, 0.011, 4), J.handProp, sh, '#b8933e');
  r.add(limb([-0.17, 0.42, 0.27], [-0.17, 0.5, 0.27], 0.02, 0.042, 8), J.handProp, sh, '#d0aa4c');
  return r.build();
}

/** The host: a headless lord at the high table, holding his own glowing head up in his left hand. */
export function host(): THREE.BufferGeometry {
  const r = new Rig();
  seated(r, { coat: '#16141c', sleeve: '#16141c', hand: '#cfc6bd', waist: 0.21, chest: 0.18 });
  r.add(ellipsoid([0, 0.45, 0.1], [0.055, 0.12, 0.03], 0, 6), J.body, [0, 0, 0], '#e6e1d8');
  for (const s of [1, -1]) r.add(limb(mirror([0.06, 0.2, 0.15], s), mirror([0.06, 0.55, 0.13], s), 0.008, 0.008, 4), J.body, [0, 0, 0], '#c9a24a');
  collar(r, 0.7);
  r.add(ellipsoid([0, 0.61, 0], [0.055, 0.02, 0.055], 0, 8), J.body, [0, 0, 0], '#3a0a10');
  pumpkin(r, [0.15, 0.47, 0.37], 0.13, J.handPropL, [SHOULDER, 0.55, 0], 3);
  return r.build();
}

/** The witch at the cauldron, standing, a long ladle in her right hand reaching into the pot ahead. */
export function stirringWitch(): THREE.BufferGeometry {
  const r = new Rig();
  const robe = '#231a2b';
  const dy = 0.8;
  r.add(limb([0, 0, 0], [0, 1.37, 0], 0.32, 0.16, 12), J.body, [0, 0, 0], robe);
  r.add(ellipsoid([0, 1.35, 0], [0.21, 0.075, 0.12], 0, 10), J.body, [0, 0, 0], robe);
  for (const s of [1, -1]) {
    const sh: V3 = mirror([SHOULDER, 1.35, 0], s);
    const joint = s > 0 ? J.fl : J.fr;
    r.add(limb(sh, mirror([0.21, 1.12, 0.06], s), 0.056, 0.047, 7), joint, sh, robe);
    r.add(limb(mirror([0.21, 1.12, 0.06], s), mirror([0.13, 1.08, 0.34], s), 0.047, 0.075, 7), joint, sh, robe);
    r.add(ellipsoid(mirror([0.13, 1.08, 0.37], s), [0.034, 0.03, 0.045], 0, 6), joint, sh, '#98a986');
  }
  witchHead(r, dy);
  r.add(limb([-0.13, 1.18, 0.37], [-0.06, 0.45, 0.85], 0.018, 0.018, 5), J.handProp, [-SHOULDER, 1.35, 0], '#3a2a1c');
  r.add(ellipsoid([-0.06, 0.45, 0.85], [0.07, 0.03, 0.07], 0, 6), J.handProp, [-SHOULDER, 1.35, 0], '#2a2a2e');
  return r.build();
}
