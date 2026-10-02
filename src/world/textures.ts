import * as THREE from 'three';
import { clamp, fbm, rng, smoothstep } from './math';

// Procedural canvas textures from the mockup, for sky, sprites and small props. The castle's
// surfaces come from the processed texture library instead (src/world/assets.ts).

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

let anisotropy = 1;

function canvasTex(w: number, h: number, draw: Draw, { srgb = true, repeat = true } = {}): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

function makeGlow() {
  return canvasTex(
    128,
    128,
    (g, w) => {
      const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.18, 'rgba(255,255,255,0.75)');
      grd.addColorStop(0.45, 'rgba(255,255,255,0.18)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, w);
    },
    { srgb: false, repeat: false },
  );
}

/** Soft noisy blob in the alpha channel, for mist and clouds. */
function softTex(size: number, scale: number, seed: number, elong = 1) {
  return canvasTex(
    size * elong,
    size,
    (g, w, h) => {
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const nx = (x / w - 0.5) * 2;
          const ny = (y / h - 0.5) * 2;
          const r = Math.sqrt(nx * nx + ny * ny);
          const n = fbm((x / w) * scale * elong + seed, (y / h) * scale + seed * 1.7, 5) * 0.5 + 0.5;
          const a = clamp((1 - r) * 1.4, 0, 1) * clamp(n * 1.9 - 0.45, 0, 1);
          const i = (y * w + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
          img.data[i + 3] = a * 255;
        }
      }
      g.putImageData(img, 0, 0);
    },
    { srgb: false, repeat: false },
  );
}

function makeMoon() {
  return canvasTex(
    256,
    256,
    (g, w) => {
      const R = rng(5);
      const grd = g.createRadialGradient(w * 0.46, w * 0.44, 4, w / 2, w / 2, w / 2);
      grd.addColorStop(0, '#fbf7ec');
      grd.addColorStop(0.8, '#e6e2d6');
      grd.addColorStop(0.97, '#cfcabd');
      grd.addColorStop(1, 'rgba(207,202,189,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.beginPath();
      g.arc(w / 2, w / 2, w / 2 - 3, 0, Math.PI * 2);
      g.clip();
      for (let i = 0; i < 22; i++) {
        const x = R() * w;
        const y = R() * w;
        const r = 6 + R() * 34;
        g.fillStyle = `rgba(150,145,140,${0.12 + R() * 0.22})`;
        g.beginPath();
        g.ellipse(x, y, r, r * (0.7 + R() * 0.3), R() * 3, 0, Math.PI * 2);
        g.fill();
      }
      for (let i = 0; i < 60; i++) {
        const x = R() * w;
        const y = R() * w;
        const r = 1 + R() * 5;
        g.strokeStyle = 'rgba(120,115,110,0.25)';
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    },
    { repeat: false },
  );
}

/** Original crest: a gold crescent over three spires on deep red. */
function makeCrest() {
  return canvasTex(
    128,
    320,
    (g, w, h) => {
      g.fillStyle = '#4a0d12';
      g.fillRect(0, 0, w, h - 24);
      for (let x = 0; x < w; x += 16) {
        g.beginPath();
        g.moveTo(x, h - 24);
        g.lineTo(x + 8, h);
        g.lineTo(x + 16, h - 24);
        g.fill();
      }
      g.strokeStyle = '#c99a3e';
      g.lineWidth = 4;
      g.strokeRect(8, 8, w - 16, h - 40);
      g.fillStyle = '#d8a944';
      g.beginPath();
      g.arc(64, 100, 34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4a0d12';
      g.beginPath();
      g.arc(78, 92, 30, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#d8a944';
      for (const [x, hh] of [
        [36, 70],
        [64, 100],
        [92, 70],
      ]) {
        g.fillRect(x - 7, 240 - hh + 20, 14, hh - 20);
        g.beginPath();
        g.moveTo(x - 10, 240 - hh + 22);
        g.lineTo(x, 240 - hh - 14);
        g.lineTo(x + 10, 240 - hh + 22);
        g.fill();
      }
      g.fillRect(24, 240, 80, 8);
    },
    { repeat: false },
  );
}

/**
 * Five hall banners side by side (128 x 320 each): the castle's crest, then a bat, a jack-o'-lantern,
 * a spider and a moon. Made by the feast (src/life/feast.ts) after the first frame, not with the rest.
 */
export function makeHallBanners() {
  const gold = '#d8a944';
  const fields = ['#4a0d12', '#2c1440', '#141016', '#0f2a26', '#101a3a'];
  return canvasTex(
    640,
    320,
    (g) => {
      fields.forEach((field, i) => {
        g.save();
        g.translate(i * 128, 0);
        // Field with a swallowtail of points at the foot, and a gilt border.
        g.fillStyle = field;
        g.fillRect(0, 0, 128, 296);
        for (let x = 0; x < 128; x += 16) {
          g.beginPath();
          g.moveTo(x, 296);
          g.lineTo(x + 8, 320);
          g.lineTo(x + 16, 296);
          g.fill();
        }
        g.strokeStyle = '#c99a3e';
        g.lineWidth = 4;
        g.strokeRect(8, 8, 112, 280);
        g.fillStyle = gold;
        g.strokeStyle = gold;
        const disc = (x: number, y: number, r: number) => {
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        };
        if (i === 0) {
          // The castle's crest: a crescent over three spires.
          disc(64, 100, 34);
          g.fillStyle = field;
          disc(78, 92, 30);
          g.fillStyle = gold;
          for (const [x, hh] of [[36, 70], [64, 100], [92, 70]]) {
            g.fillRect(x - 7, 240 - hh + 20, 14, hh - 20);
            g.beginPath();
            g.moveTo(x - 10, 240 - hh + 22);
            g.lineTo(x, 240 - hh - 14);
            g.lineTo(x + 10, 240 - hh + 22);
            g.fill();
          }
          g.fillRect(24, 240, 80, 8);
        } else if (i === 1) {
          // A bat, wings spread.
          g.beginPath();
          g.moveTo(64, 120);
          for (const [x, y] of [[80, 112], [96, 98], [118, 104], [112, 124], [104, 140], [92, 134], [84, 150], [72, 142], [64, 158]]) g.lineTo(x, y);
          for (const [x, y] of [[56, 142], [44, 150], [36, 134], [24, 140], [16, 124], [10, 104], [32, 98], [48, 112]]) g.lineTo(x, y);
          g.closePath();
          g.fill();
          disc(64, 116, 11);
          g.beginPath();
          g.moveTo(56, 108);
          g.lineTo(58, 96);
          g.lineTo(62, 106);
          g.moveTo(72, 108);
          g.lineTo(70, 96);
          g.lineTo(66, 106);
          g.fill();
          g.fillRect(36, 220, 56, 6);
        } else if (i === 2) {
          // A jack-o'-lantern: ribs, a stem, a carved face in the field's colour.
          g.fillStyle = '#c4621a';
          for (const [dx, rx] of [[-22, 26], [22, 26], [0, 30]]) {
            g.beginPath();
            g.ellipse(64 + dx, 140, rx, 38, 0, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = '#3b3a1a';
          g.fillRect(60, 92, 8, 14);
          g.fillStyle = '#f2b347';
          for (const s of [-1, 1]) {
            g.beginPath();
            g.moveTo(64 + s * 8, 132);
            g.lineTo(64 + s * 26, 132);
            g.lineTo(64 + s * 17, 116);
            g.fill();
          }
          g.beginPath();
          g.moveTo(38, 150);
          for (let k = 0; k <= 8; k++) g.lineTo(38 + k * 6.5, k % 2 ? 158 : 166);
          g.lineTo(90, 150);
          g.quadraticCurveTo(64, 176, 38, 150);
          g.fill();
          g.fillStyle = gold;
          g.fillRect(36, 220, 56, 6);
        } else if (i === 3) {
          // A spider hanging on its thread from a web.
          g.lineWidth = 2;
          for (let k = 0; k < 6; k++) {
            g.beginPath();
            g.moveTo(64, 30);
            g.lineTo(64 + Math.cos((k / 5) * Math.PI) * 50, 30 + Math.sin((k / 5) * Math.PI) * 50);
            g.stroke();
          }
          for (const rr of [18, 32, 46]) {
            g.beginPath();
            g.arc(64, 30, rr, 0, Math.PI);
            g.stroke();
          }
          g.beginPath();
          g.moveTo(64, 30);
          g.lineTo(64, 128);
          g.stroke();
          disc(64, 150, 18);
          disc(64, 126, 10);
          g.lineWidth = 4;
          for (const s of [-1, 1]) {
            for (let k = 0; k < 4; k++) {
              g.beginPath();
              g.moveTo(64 + s * 10, 140 + k * 6);
              g.lineTo(64 + s * 34, 124 + k * 14);
              g.lineTo(64 + s * 42, 146 + k * 16);
              g.stroke();
            }
          }
          g.fillRect(36, 220, 56, 6);
        } else {
          // A crescent moon among stars.
          disc(58, 120, 40);
          g.fillStyle = field;
          disc(76, 108, 36);
          g.fillStyle = gold;
          for (const [x, y, r] of [[96, 70, 5], [30, 190, 4], [100, 170, 6], [44, 60, 3], [84, 208, 3]]) {
            g.beginPath();
            for (let k = 0; k < 10; k++) {
              const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
              const rad = k % 2 ? r * 0.45 : r * 1.6;
              g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
            }
            g.fill();
          }
          g.fillRect(36, 236, 56, 6);
        }
        g.restore();
      });
    },
    { repeat: false },
  );
}

function makeWeb() {
  return canvasTex(
    512,
    512,
    (g, w) => {
      const R = rng(61);
      const c = w / 2;
      g.strokeStyle = 'rgba(230,236,245,0.85)';
      g.lineWidth = 1.6;
      const spokes = 14;
      const ang: number[] = [];
      for (let i = 0; i < spokes; i++) ang.push((i / spokes) * Math.PI * 2 + (R() - 0.5) * 0.2);
      for (const a of ang) {
        g.beginPath();
        g.moveTo(c, c);
        g.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c);
        g.stroke();
      }
      g.lineWidth = 1.1;
      for (let r = 16; r < c * 0.96; r += 13 + r * 0.04) {
        g.beginPath();
        ang.forEach((a, i) => {
          const rr = r * (0.94 + 0.06 * Math.sin(i * 3));
          const x = c + Math.cos(a) * rr;
          const y = c + Math.sin(a) * rr;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.closePath();
        g.stroke();
      }
    },
    { srgb: false, repeat: false },
  );
}

/** Pumpkin skin, or the carved face's glow. u = 0.25 faces +z on a SphereGeometry. */
function pumpkinTex(emissive: boolean) {
  return canvasTex(
    512,
    256,
    (g, w, h) => {
      if (!emissive) {
        g.fillStyle = '#d0601a';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 10; i++) {
          const x = (i * w) / 10;
          const grd = g.createLinearGradient(x, 0, x + w / 10, 0);
          grd.addColorStop(0, 'rgba(90,30,5,0.55)');
          grd.addColorStop(0.5, 'rgba(255,150,60,0.0)');
          grd.addColorStop(1, 'rgba(90,30,5,0.55)');
          g.fillStyle = grd;
          g.fillRect(x, 0, w / 10, h);
        }
      }
      const cx = w * 0.25;
      const cy = h * 0.47;
      g.fillStyle = emissive ? '#ffb347' : '#2a1206';
      const tri = (x: number, y: number, s: number) => {
        g.beginPath();
        g.moveTo(x - s, y + s * 0.6);
        g.lineTo(x + s, y + s * 0.6);
        g.lineTo(x, y - s);
        g.fill();
      };
      tri(cx - 30, cy - 26, 17);
      tri(cx + 30, cy - 26, 17);
      tri(cx, cy - 2, 7);
      g.beginPath();
      g.moveTo(cx - 52, cy + 14);
      const teeth = [[-40, 26], [-30, 18], [-18, 32], [-6, 22], [6, 32], [18, 22], [30, 30], [42, 18], [52, 14]];
      for (const [dx, dy] of teeth) g.lineTo(cx + dx, cy + dy);
      g.quadraticCurveTo(cx + 10, cy + 70, cx - 52, cy + 14);
      g.fill();
      if (emissive) {
        g.globalCompositeOperation = 'source-atop';
        const grd = g.createRadialGradient(cx, cy + 20, 5, cx, cy, 80);
        grd.addColorStop(0, '#fff0a8');
        grd.addColorStop(1, '#ff7b1c');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'destination-over';
        g.fillStyle = '#000';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      }
    },
    { repeat: false },
  );
}

/**
 * The wyrm's hide: a tile of overlapping scales, 4 across and 8 rows deep, each row offset by half
 * a scale and tucked under the row in front of it, so the free edges point to the tail (+v). The
 * albedo is iron-dark; the emissive map glows ember-red only in the thin seams.
 */
function makeScales(size = 256): { albedo: THREE.CanvasTexture; ember: THREE.CanvasTexture } {
  const COLS = 4;
  const ROWS = 8;
  const R = 0.62;
  // A scale's shade by its place in the tile, so the tile still wraps.
  const shade = (c: number, r: number) => {
    const s = Math.sin((c * 12.9898 + r * 78.233 + 1.3) * 1.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const albedo = new ImageData(size, size);
  const ember = new ImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const X = (x / size) * COLS;
      const Y = (y / size) * (ROWS / 2);
      // The scale on top is the covering one nearest the head (lowest row).
      let d = 1;
      let v = 0;
      const r0 = Math.floor(Y * 2);
      for (let r = r0 - 2; r <= r0 + 1; r++) {
        const off = ((r % 2) + 2) % 2 ? 0.5 : 0;
        const c = Math.round(X - off - 0.5);
        let best = Infinity;
        let bc = 0;
        for (const cc of [c - 1, c, c + 1]) {
          const dd = Math.hypot(X - (cc + off + 0.5), Y - r * 0.5) / R;
          if (dd < best) {
            best = dd;
            bc = cc;
          }
        }
        if (best < 1) {
          d = best;
          v = shade(((bc % COLS) + COLS) % COLS, ((r % ROWS) + ROWS) % ROWS);
          break;
        }
      }
      const i = (y * size + x) * 4;
      // Darker toward the free edge, a sheen near the root of each scale.
      const body = (0.8 + 0.35 * v) * (1 - 0.5 * smoothstep(0.6, 1, d)) * (1 + 0.2 * (1 - smoothstep(0, 0.55, d)));
      albedo.data[i] = clamp(58 * body, 0, 255);
      albedo.data[i + 1] = clamp(47 * body, 0, 255);
      albedo.data[i + 2] = clamp(42 * body, 0, 255);
      albedo.data[i + 3] = 255;
      const e = smoothstep(0.9, 0.995, d) * (0.5 + 0.5 * v);
      ember.data[i] = 220 * e;
      ember.data[i + 1] = 70 * e * e;
      ember.data[i + 2] = 18 * e * e;
      ember.data[i + 3] = 255;
    }
  }
  const put = (img: ImageData) => canvasTex(size, size, (g) => g.putImageData(img, 0, 0));
  return { albedo: put(albedo), ember: put(ember) };
}

/**
 * A cluster of leaves on a transparent card, for the autumn trees: pointed ovals at random angles,
 * thick in the middle and ragged at the edge, in greys so each tree's colour tints them.
 */
function makeLeaves(size = 256) {
  return canvasTex(
    size,
    size,
    (g, w) => {
      const R = rng(404);
      const c = w / 2;
      for (let i = 0; i < 150; i++) {
        // Denser toward the centre, so the card stays solid when mipmaps soften its edge.
        const a = R() * Math.PI * 2;
        const r = Math.pow(R(), 0.65) * c * 0.84;
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r;
        const s = (0.045 + R() * 0.04) * w;
        const v = Math.round(150 + R() * 105 - (r / c) * 40);
        g.save();
        g.translate(x, y);
        g.rotate(R() * Math.PI * 2);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.beginPath();
        g.moveTo(-s, 0);
        g.quadraticCurveTo(-s * 0.2, -s * 0.55, s, 0);
        g.quadraticCurveTo(-s * 0.2, s * 0.55, -s, 0);
        g.fill();
        g.restore();
      }
    },
    { repeat: false },
  );
}

/**
 * Tileable ripple slopes for the lake: a sum of wave trains whose wave vectors fit the tile, so it
 * wraps exactly. Slopes (dh/dx, dh/dz) in RG with 0.5 as flat, so mipmaps average them properly
 * and far water calms into a mirror.
 */
function makeRipples(size = 256) {
  const R = rng(97);
  const waves = Array.from({ length: 36 }, () => {
    // Integer wave numbers; most of the height in the long waves, from every direction.
    const k = 2 + Math.pow(R(), 1.7) * 26;
    const a = R() * Math.PI * 2;
    const m = Math.round(Math.cos(a) * k);
    const n = Math.round(Math.sin(a) * k);
    const len = Math.max(1, Math.hypot(m, n));
    return { m, n, amp: Math.pow(len, -1.5), ph: R() * Math.PI * 2 };
  });
  const sx = new Float32Array(size * size);
  const sz = new Float32Array(size * size);
  let max = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dz = 0;
      for (const w of waves) {
        const c = w.amp * 2 * Math.PI * Math.cos((2 * Math.PI * (w.m * x + w.n * y)) / size + w.ph);
        dx += c * w.m;
        dz += c * w.n;
      }
      const i = y * size + x;
      sx[i] = dx;
      sz[i] = dz;
      max = Math.max(max, Math.abs(dx), Math.abs(dz));
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(127.5 + (127.5 * sx[i]) / max);
    data[i * 4 + 1] = Math.round(127.5 + (127.5 * sz[i]) / max);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

export function makeTextures(maxAnisotropy: number) {
  anisotropy = maxAnisotropy;
  return {
    glow: makeGlow(),
    mist: softTex(128, 3, 11),
    cloud: softTex(160, 4, 23, 2),
    moon: makeMoon(),
    crest: makeCrest(),
    web: makeWeb(),
    pumpkin: pumpkinTex(false),
    pumpkinGlow: pumpkinTex(true),
    ripples: makeRipples(),
    scales: makeScales(),
    leaves: makeLeaves(),
  };
}

export type Textures = ReturnType<typeof makeTextures>;
