import * as THREE from 'three';
import { clamp, fbm, rng } from './math';

// Procedural canvas textures from the mockup. Generated imagery replaces these in M2.

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

/** A pointed arch path, apex at `top`. */
function archPath(g: CanvasRenderingContext2D, cx: number, top: number, w: number, h: number) {
  const spring = top + w * 0.72;
  g.beginPath();
  g.moveTo(cx - w / 2, top + h);
  g.lineTo(cx - w / 2, spring);
  g.quadraticCurveTo(cx - w / 2, top + w * 0.12, cx, top);
  g.quadraticCurveTo(cx + w / 2, top + w * 0.12, cx + w / 2, spring);
  g.lineTo(cx + w / 2, top + h);
  g.closePath();
}

function litGlass(g: CanvasRenderingContext2D, cx: number, top: number, w: number, h: number, lit: number, tone: number) {
  const grd = g.createLinearGradient(0, top, 0, top + h);
  const warm = tone < 0.2 ? ['#ff6a2c', '#ffb257'] : tone > 0.85 ? ['#ffc970', '#fff0b8'] : ['#ff9038', '#ffd27c'];
  grd.addColorStop(0, warm[0]);
  grd.addColorStop(1, warm[1]);
  g.globalAlpha = lit;
  g.fillStyle = grd;
  archPath(g, cx, top, w, h);
  g.fill();
  g.globalAlpha = 1;
}

function windowFrame(g: CanvasRenderingContext2D, cx: number, top: number, w: number, h: number) {
  g.strokeStyle = 'rgba(14,10,8,0.95)';
  g.lineWidth = Math.max(2, w * 0.07);
  g.beginPath();
  g.moveTo(cx, top + w * 0.25);
  g.lineTo(cx, top + h);
  g.stroke();
  for (let k = 1; k < 4; k++) {
    const y = top + w * 0.6 + ((h - w * 0.6) * k) / 4;
    g.beginPath();
    g.moveTo(cx - w / 2, y);
    g.lineTo(cx + w / 2, y);
    g.stroke();
  }
}

export interface StoneSet {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture | null;
  bump: THREE.CanvasTexture;
}

/** Stone atlas: 1024 px = 32 m square, optionally with a 4x4 grid of lit, dim and dark windows. */
function makeStoneSet(withWindows: boolean, seed: number): StoneSet {
  const S = 1024;
  const cell = 256;
  const rowH = 16;
  const R = rng(seed);
  const blocks: [number, number, number, number][] = [];
  for (let y = 0; y < S; y += rowH) {
    let x = -R() * 50;
    while (x < S) {
      const w = 26 + R() * 56;
      blocks.push([x, y, w, R()]);
      x += w;
    }
  }
  const wins: { x: number; y: number; w: number; h: number; lit: number; tone: number }[] = [];
  if (withWindows) {
    for (let cy = 0; cy < 4; cy++) {
      for (let cx = 0; cx < 4; cx++) {
        const roll = R();
        if (roll < 0.16) continue;
        wins.push({
          x: cx * cell + cell / 2 + (R() - 0.5) * 24,
          y: cy * cell + 70,
          w: 46,
          h: 110,
          lit: roll < 0.7 ? (R() < 0.78 ? 1 : 0.5) : 0,
          tone: R(),
        });
      }
    }
  }
  const stains: [number, number, number, number, number][] = [];
  for (let i = 0; i < 26; i++) stains.push([R() * S, R() * S, 20 + R() * 60, 80 + R() * 260, R()]);
  const drawBlocks = (fn: (x: number, y: number, w: number, v: number) => void) => {
    for (const [x, y, w, v] of blocks) {
      for (const off of [0, S]) {
        if (x + w - off < 0) continue;
        fn(x - off, y, w, v);
      }
    }
  };
  const map = canvasTex(S, S, (g) => {
    g.fillStyle = '#25262c';
    g.fillRect(0, 0, S, S);
    drawBlocks((x, y, w, v) => {
      const s = 62 + v * 30;
      g.fillStyle = `rgb(${s | 0},${(s + 2) | 0},${(s + 5) | 0})`;
      g.fillRect(x + 1.5, y + 1.5, w - 3, rowH - 3);
    });
    for (const [x, y, w, h, v] of stains) {
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, `rgba(20,24,22,${0.25 + v * 0.25})`);
      grd.addColorStop(1, 'rgba(20,24,22,0)');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
    }
    for (const wdw of wins) {
      g.fillStyle = '#7a7a80';
      archPath(g, wdw.x, wdw.y - 8, wdw.w + 16, wdw.h + 14);
      g.fill();
      g.fillStyle = '#56565c';
      g.fillRect(wdw.x - wdw.w / 2 - 10, wdw.y + wdw.h + 4, wdw.w + 20, 8);
      g.fillStyle = '#07080c';
      archPath(g, wdw.x, wdw.y, wdw.w, wdw.h);
      g.fill();
      if (wdw.lit) litGlass(g, wdw.x, wdw.y, wdw.w, wdw.h, wdw.lit * 0.9, wdw.tone);
      windowFrame(g, wdw.x, wdw.y, wdw.w, wdw.h);
    }
  });
  const emissive = withWindows
    ? canvasTex(S, S, (g) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, S, S);
        for (const wdw of wins) {
          if (!wdw.lit) continue;
          litGlass(g, wdw.x, wdw.y, wdw.w, wdw.h, wdw.lit, wdw.tone);
          windowFrame(g, wdw.x, wdw.y, wdw.w, wdw.h);
        }
      })
    : null;
  const bump = canvasTex(
    S,
    S,
    (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, S, S);
      drawBlocks((x, y, w, v) => {
        const s = 150 + v * 90;
        g.fillStyle = `rgb(${s | 0},${s | 0},${s | 0})`;
        g.fillRect(x + 2, y + 2, w - 4, rowH - 4);
      });
      for (const wdw of wins) {
        g.fillStyle = '#000';
        archPath(g, wdw.x, wdw.y, wdw.w, wdw.h);
        g.fill();
      }
    },
    { srgb: false },
  );
  return { map, emissive, bump };
}

/** One bay of the great hall: 7.33 m x 24 m, a tall two-light lancet window with tracery. */
function makeHallBay() {
  const W = 256;
  const H = 840;
  const R = rng(42);
  const blocks: [number, number, number, number][] = [];
  for (let y = 0; y < H; y += 17) {
    let x = -R() * 40;
    while (x < W) {
      const w = 26 + R() * 50;
      blocks.push([x, y, w, R()]);
      x += w;
    }
  }
  const win = { cx: W / 2, top: 120, w: 104, h: 560 };
  const panes: [number, number][] = [];
  for (let i = 0; i < 40; i++) panes.push([R(), R()]);
  const glass = (g: CanvasRenderingContext2D, a: number) => {
    const { cx, top, w, h } = win;
    g.save();
    archPath(g, cx, top, w, h);
    g.clip();
    const grd = g.createLinearGradient(0, top, 0, top + h);
    grd.addColorStop(0, '#ff7a2e');
    grd.addColorStop(0.45, '#ffad52');
    grd.addColorStop(1, '#ffd98a');
    g.globalAlpha = a;
    g.fillStyle = grd;
    g.fillRect(cx - w, top, w * 2, h);
    // A few stained panes.
    for (let i = 0; i < panes.length; i++) {
      const [u, v] = panes[i];
      if (v > 0.32) continue;
      const px = cx - w / 2 + (Math.floor(u * 4) * w) / 4;
      const py = top + w * 0.7 + (Math.floor((i / panes.length) * 9) * (h - w * 0.7)) / 9;
      g.fillStyle = v < 0.1 ? '#c63a2a' : v < 0.2 ? '#e0a72a' : '#3f8c8a';
      g.globalAlpha = a * 0.75;
      g.fillRect(px, py, w / 4, (h - w * 0.7) / 9);
    }
    g.globalAlpha = 1;
    g.restore();
    // Tracery.
    g.strokeStyle = 'rgba(16,10,8,0.95)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx, top + 70);
    g.lineTo(cx, top + h);
    g.stroke();
    g.lineWidth = 4;
    archPath(g, cx - w / 4, top + 64, w / 2 - 6, h - 64);
    g.stroke();
    archPath(g, cx + w / 4, top + 64, w / 2 - 6, h - 64);
    g.stroke();
    g.beginPath();
    g.arc(cx, top + 46, 17, 0, Math.PI * 2);
    g.stroke();
    for (let k = 1; k < 9; k++) {
      const y = top + w * 0.7 + ((h - w * 0.7) * k) / 9;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx - w / 2, y);
      g.lineTo(cx + w / 2, y);
      g.stroke();
    }
  };
  const map = canvasTex(W, H, (g) => {
    g.fillStyle = '#25262c';
    g.fillRect(0, 0, W, H);
    for (const [x, y, w, v] of blocks) {
      const s = 64 + v * 30;
      g.fillStyle = `rgb(${s | 0},${(s + 3) | 0},${(s + 11) | 0})`;
      g.fillRect(x + 1.5, y + 1.5, w - 3, 14);
      if (x + w > W) g.fillRect(x - W + 1.5, y + 1.5, w - 3, 14);
    }
    g.fillStyle = 'rgba(16,18,24,0.55)';
    g.fillRect(0, 0, 14, H);
    g.fillRect(W - 14, 0, 14, H);
    g.fillStyle = '#7d7c82';
    archPath(g, win.cx, win.top - 12, win.w + 24, win.h + 20);
    g.fill();
    g.fillStyle = '#08080c';
    archPath(g, win.cx, win.top, win.w, win.h);
    g.fill();
    glass(g, 0.92);
    g.fillStyle = '#4c4b52';
    g.fillRect(0, H - 40, W, 40);
  });
  const emissive = canvasTex(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    glass(g, 1);
  });
  return { map, emissive };
}

function makeSlate() {
  const S = 512;
  const draw = (g: CanvasRenderingContext2D, bump: boolean) => {
    // Same seed for both passes so the bump lines up with the colour.
    const R = rng(9);
    g.fillStyle = bump ? '#000' : '#15171d';
    g.fillRect(0, 0, S, S);
    for (let y = 0, row = 0; y < S; y += 24, row++) {
      let x = row % 2 ? -14 : 0;
      while (x < S) {
        const w = 20 + R() * 16;
        const v = R();
        if (bump) {
          const s = 120 + v * 120;
          g.fillStyle = `rgb(${s | 0},${s | 0},${s | 0})`;
        } else {
          const s = 34 + v * 22;
          g.fillStyle = `rgb(${s | 0},${(s + 4) | 0},${(s + 14) | 0})`;
        }
        g.fillRect(x + 1, y + 1, w - 2, 22);
        x += w;
      }
    }
    if (!bump) {
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(80,96,70,${R() * 0.25})`;
        g.fillRect(R() * S, R() * S, 2 + R() * 4, 2 + R() * 3);
      }
    }
  };
  return { map: canvasTex(S, S, (g) => draw(g, false)), bump: canvasTex(S, S, (g) => draw(g, true), { srgb: false }) };
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

export function makeTextures(maxAnisotropy: number) {
  anisotropy = maxAnisotropy;
  return {
    stoneWindows: makeStoneSet(true, 77),
    stonePlain: makeStoneSet(false, 78),
    hallBay: makeHallBay(),
    slate: makeSlate(),
    glow: makeGlow(),
    mist: softTex(128, 3, 11),
    cloud: softTex(160, 4, 23, 2),
    moon: makeMoon(),
    crest: makeCrest(),
    web: makeWeb(),
    pumpkin: pumpkinTex(false),
    pumpkinGlow: pumpkinTex(true),
  };
}

export type Textures = ReturnType<typeof makeTextures>;
