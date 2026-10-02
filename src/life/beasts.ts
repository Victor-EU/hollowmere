import * as THREE from 'three';
import { chain, cone, ellipsoid, J, limb, Rig } from './rig';

// The animals' bodies, built from rig parts (src/life/rig.ts): faces +z, feet at y = 0, in metres.
// Original designs, stylised to read as silhouettes against moonlit snow from forty metres up.

type V3 = [number, number, number];

export interface Body {
  geometry: THREE.BufferGeometry;
  /** The head's pivot, and the eyes on the head, for eye-shine. */
  head: V3;
  eyes: V3[];
  /** Nose to tail, for following the slope. */
  length: number;
}

const mirror = (p: V3, s: number): V3 => [p[0] * s, p[1], p[2]];
/** Two-tone coat: `top` above `line`, blending to `under` below it. */
function coat(top: string, under: string, line: number, soft = 0.12) {
  const a = new THREE.Color(top);
  const b = new THREE.Color(under);
  const c = new THREE.Color();
  return (p: THREE.Vector3) => c.lerpColors(b, a, THREE.MathUtils.smoothstep(p.y, line - soft, line + soft)).getHex();
}

/** A red deer: a doe, or with antlers grown by the prop channel, a stag. About 1 m at the shoulder. */
export function deer(): Body {
  const r = new Rig();
  const hide = coat('#6a5442', '#b5a084', 0.93);
  const leg = (p: THREE.Vector3) => (p.y < 0.07 ? '#17120e' : '#4a3a2d');
  r.add(ellipsoid([0, 1.05, -0.02], [0.21, 0.26, 0.56], 0, 12), J.body, [0, 0, 0], hide);
  r.add(ellipsoid([0, 1.02, 0.32], [0.2, 0.29, 0.27], 0, 10), J.body, [0, 0, 0], hide);
  r.add(ellipsoid([0, 1.09, -0.38], [0.2, 0.27, 0.25], 0, 10), J.body, [0, 0, 0], coat('#6a5442', '#cdbfa8', 1.0));
  const neck: V3 = [0, 1.16, 0.44];
  r.add(limb([0, 1.18, 0.42], [0, 1.62, 0.72], 0.12, 0.075), J.head, neck, hide);
  r.add(ellipsoid([0, 1.66, 0.84], [0.075, 0.085, 0.17], 0.35), J.head, neck, '#6a5442');
  r.add(limb([0, 1.63, 0.9], [0, 1.56, 1.03], 0.058, 0.034), J.head, neck, '#5b4838');
  r.add(ellipsoid([0, 1.56, 1.03], [0.028, 0.024, 0.02]), J.head, neck, '#141110');
  for (const s of [1, -1]) {
    r.add(cone(mirror([0.06, 1.73, 0.78], s), mirror([0.18, 1.85, 0.72], s), 0.045), J.head, neck, '#5d4a3a');
    // Antlers: a beam sweeping up and back with two tines, hidden on does.
    r.add(chain([mirror([0.04, 1.75, 0.8], s), mirror([0.12, 1.96, 0.74], s), mirror([0.2, 2.14, 0.68], s), mirror([0.21, 2.34, 0.73], s)], [0.022, 0.018, 0.013, 0.007], 5), J.headProp, neck, '#8f7d64');
    r.add(limb(mirror([0.12, 1.96, 0.74], s), mirror([0.1, 2.1, 0.88], s), 0.012, 0.005, 4), J.headProp, neck, '#8f7d64');
    r.add(limb(mirror([0.2, 2.14, 0.68], s), mirror([0.3, 2.24, 0.6], s), 0.011, 0.004, 4), J.headProp, neck, '#8f7d64');
    const fl: V3 = mirror([0.11, 1.0, 0.36], s);
    r.add(chain([fl, mirror([0.11, 0.55, 0.4], s), mirror([0.11, 0.03, 0.38], s)], [0.055, 0.034, 0.024], 6), s > 0 ? J.fl : J.fr, fl, leg);
    const bl: V3 = mirror([0.11, 1.05, -0.38], s);
    r.add(chain([bl, mirror([0.11, 0.6, -0.5], s), mirror([0.11, 0.38, -0.56], s), mirror([0.11, 0.03, -0.48], s)], [0.07, 0.044, 0.03, 0.024], 6), s > 0 ? J.bl : J.br, bl, leg);
  }
  r.add(cone([0, 1.17, -0.6], [0, 1.0, -0.7], 0.055), J.tail, [0, 1.17, -0.6], '#e8e0d0');
  return { geometry: r.build(), head: neck, eyes: [[0.066, 1.69, 0.89], [-0.066, 1.69, 0.89]], length: 1.3 };
}

interface CanidLook {
  coat: string;
  belly: string;
  legs: string;
  muzzle: string;
  /** Ear height and width, and the tail's girth and tip colour. */
  ear: [number, number];
  tail: { girth: number; tip: string; length: number };
}

/** A wolf, or with a lighter frame, longer ears and a white-tipped brush, a fox. Wolf scale: 0.8 m at the shoulder. */
function canid(look: CanidLook): Body {
  const r = new Rig();
  const hide = coat(look.coat, look.belly, 0.74);
  r.add(ellipsoid([0, 0.82, -0.06], [0.19, 0.24, 0.5], 0, 12), J.body, [0, 0, 0], hide);
  r.add(ellipsoid([0, 0.8, 0.27], [0.22, 0.3, 0.29], 0, 10), J.body, [0, 0, 0], hide);
  // The ruff over the shoulders and round the neck.
  r.add(ellipsoid([0, 0.94, 0.34], [0.23, 0.25, 0.22], 0, 10), J.body, [0, 0, 0], look.coat);
  r.add(ellipsoid([0, 0.9, 0.48], [0.17, 0.2, 0.13], 0.3, 8), J.head, [0, 0.9, 0.38], look.coat);
  const neck: V3 = [0, 0.9, 0.38];
  r.add(limb([0, 0.9, 0.38], [0, 0.98, 0.58], 0.15, 0.12), J.head, neck, look.coat);
  r.add(ellipsoid([0, 1.0, 0.64], [0.12, 0.11, 0.14]), J.head, neck, look.coat);
  r.add(limb([0, 0.965, 0.7], [0, 0.93, 0.91], 0.066, 0.034), J.head, neck, look.muzzle);
  r.add(ellipsoid([0, 0.935, 0.915], [0.026, 0.022, 0.022]), J.head, neck, '#0d0d0f');
  const [eh, ew] = look.ear;
  for (const s of [1, -1]) {
    r.add(cone(mirror([0.06, 1.07, 0.61], s), mirror([0.085, 1.07 + eh, 0.58], s), ew), J.head, neck, look.coat);
    const fl: V3 = mirror([0.1, 0.75, 0.32], s);
    r.add(chain([fl, mirror([0.1, 0.36, 0.34], s), mirror([0.1, 0.03, 0.37], s)], [0.07, 0.045, 0.038], 6), s > 0 ? J.fl : J.fr, fl, look.legs);
    const bl: V3 = mirror([0.1, 0.8, -0.38], s);
    r.add(chain([bl, mirror([0.1, 0.42, -0.5], s), mirror([0.1, 0.24, -0.52], s), mirror([0.1, 0.03, -0.45], s)], [0.09, 0.055, 0.042, 0.038], 6), s > 0 ? J.bl : J.br, bl, look.legs);
  }
  const { girth: g, tip, length: L } = look.tail;
  const tailRoot: V3 = [0, 0.86, -0.52];
  const tipAt = -0.52 - L;
  r.add(
    chain([tailRoot, [0, 0.7, -0.52 - L * 0.55], [0, 0.52, tipAt]], [g * 0.6, g, g * 0.55], 7),
    J.tail,
    tailRoot,
    (p: THREE.Vector3) => (p.z < tipAt + L * 0.18 ? tip : look.coat),
  );
  return { geometry: r.build(), head: neck, eyes: [[0.05, 1.03, 0.745], [-0.05, 1.03, 0.745]], length: 1.1 };
}

export const wolf = () =>
  canid({ coat: '#34353b', belly: '#6c6963', legs: '#2f3035', muzzle: '#6f6a62', ear: [0.15, 0.045], tail: { girth: 0.1, tip: '#1d1d21', length: 0.45 } });

/** Built at wolf size, shown at about 0.55 scale. */
export const fox = () =>
  canid({ coat: '#8d4f28', belly: '#d2c2ad', legs: '#22180f', muzzle: '#c9b8a2', ear: [0.25, 0.06], tail: { girth: 0.13, tip: '#e9e3d8', length: 0.62 } });

/** A hare, about 0.6 m long: long ears, big hind feet. */
export function hare(): Body {
  const r = new Rig();
  const fur = coat('#6c6256', '#c2b8a8', 0.17, 0.06);
  r.add(ellipsoid([0, 0.24, -0.02], [0.1, 0.12, 0.18], 0.2, 10), J.body, [0, 0, 0], fur);
  r.add(ellipsoid([0, 0.2, -0.12], [0.11, 0.12, 0.12], 0, 8), J.body, [0, 0, 0], fur);
  const neck: V3 = [0, 0.3, 0.12];
  r.add(ellipsoid([0, 0.36, 0.2], [0.058, 0.064, 0.088], 0.3), J.head, neck, '#6c6256');
  for (const s of [1, -1]) {
    r.add(limb(mirror([0.025, 0.41, 0.16], s), mirror([0.05, 0.63, 0.1], s), 0.026, 0.016, 5), J.head, neck, (p: THREE.Vector3) => (p.y > 0.58 ? '#16120f' : '#6c6256'));
    const fl: V3 = mirror([0.04, 0.2, 0.12], s);
    r.add(limb(fl, mirror([0.04, 0.0, 0.15], s), 0.022, 0.016, 5), s > 0 ? J.fl : J.fr, fl, '#5f564b');
    const bl: V3 = mirror([0.065, 0.2, -0.1], s);
    r.add(chain([bl, mirror([0.065, 0.07, -0.19], s), mirror([0.065, 0.015, -0.03], s)], [0.045, 0.026, 0.02], 5), s > 0 ? J.bl : J.br, bl, '#5f564b');
  }
  r.add(ellipsoid([0, 0.25, -0.21], [0.035, 0.035, 0.03]), J.tail, [0, 0.25, -0.2], '#e6e1d8');
  return { geometry: r.build(), head: neck, eyes: [[0.045, 0.385, 0.25], [-0.045, 0.385, 0.25]], length: 0.45 };
}

/** A black cat, sitting, tail round its feet. Its eyes glow by themselves. */
export function cat(): Body {
  const r = new Rig();
  const fur = '#0f0f12';
  r.add(ellipsoid([0, 0.11, -0.04], [0.1, 0.11, 0.12]), J.body, [0, 0, 0], fur);
  r.add(ellipsoid([0, 0.21, 0.04], [0.075, 0.12, 0.075], -0.25), J.body, [0, 0, 0], fur);
  const neck: V3 = [0, 0.29, 0.05];
  r.add(ellipsoid([0, 0.35, 0.07], [0.066, 0.06, 0.06]), J.head, neck, fur);
  r.add(ellipsoid([0, 0.33, 0.12], [0.03, 0.022, 0.025]), J.head, neck, '#18181c');
  for (const s of [1, -1]) {
    r.add(cone(mirror([0.036, 0.39, 0.06], s), mirror([0.047, 0.455, 0.05], s), 0.023, 4), J.head, neck, fur);
    r.add(ellipsoid(mirror([0.025, 0.362, 0.123], s), [0.014, 0.011, 0.006]), J.head, neck, '#ffcc33', 2.2);
    r.add(limb(mirror([0.035, 0.17, 0.08], s), mirror([0.035, 0.0, 0.1], s), 0.022, 0.018, 5), J.body, [0, 0, 0], fur);
  }
  const root: V3 = [0, 0.03, -0.13];
  r.add(chain([root, [0.07, 0.016, -0.12], [0.12, 0.016, -0.02], [0.11, 0.016, 0.09]], [0.021, 0.019, 0.017, 0.012], 5), J.tail, root, fur);
  return { geometry: r.build(), head: neck, eyes: [[0.025, 0.362, 0.13], [-0.025, 0.362, 0.13]], length: 0.3 };
}

/** A crow: wings spread at full prop scale, tucked against the body when it's small. */
export function crow(): Body {
  const r = new Rig();
  const ink = '#0b0b0f';
  r.add(ellipsoid([0, 0.17, 0], [0.065, 0.07, 0.13], 0.25), J.body, [0, 0, 0], ink);
  const neck: V3 = [0, 0.21, 0.08];
  r.add(ellipsoid([0, 0.25, 0.12], [0.044, 0.046, 0.05]), J.head, neck, ink);
  r.add(cone([0, 0.245, 0.155], [0, 0.232, 0.235], 0.019, 4), J.head, neck, '#1d1d22');
  r.add(ellipsoid([0, 0.14, -0.18], [0.05, 0.012, 0.09], 0.3), J.tail, [0, 0.16, -0.1], ink);
  for (const s of [1, -1]) {
    r.add(limb(mirror([0.02, 0.11, 0], s), mirror([0.02, 0, 0.012], s), 0.008, 0.006, 4), J.body, [0, 0, 0], '#26262b');
    r.add(ellipsoid(mirror([0.21, 0.19, -0.01], s), [0.19, 0.011, 0.075], 0, 8), s > 0 ? J.wingL : J.wingR, mirror([0.04, 0.19, 0], s), ink);
  }
  return { geometry: r.build(), head: neck, eyes: [], length: 0.3 };
}
