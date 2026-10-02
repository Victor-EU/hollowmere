import * as THREE from 'three';
import type { AnimalsData, Vec2 } from '../data';
import type { Heights } from '../world/heights';
import { angLerp, clamp, dampK, lerp, range, rng, smoothstep } from '../world/math';
import { cat, deer, fox, hare, wolf, type Body } from './beasts';
import { Creatures, headPoint, rigMaterial } from './rig';
import { Pool } from './sprites';
import type { LifeContext, Living } from './types';

// Animals on the ground (design doc §10): deer that graze and bolt, a wolf pack that watches and
// howls at the moon, foxes on their rounds, hares, and black cats on their perches. None of them
// ever comes toward you. Each kind is one draw; their eyes shine back at the camera, one more.
// They're bigger than life, like everything here (the ghost is 4 m tall, the hall's walls 24 m),
// so they read from autofly's height: the deer are elk-sized and the wolves are dire wolves.

type GaitName = 'walk' | 'trot' | 'bound' | 'hop';
/** Leg phases as fractions of a stride (front-left, front-right, back-left, back-right), swing, bob and rock. */
const GAITS: Record<GaitName, { legs: readonly number[]; amp: number; bob: number; rock: number; lift: boolean }> = {
  walk: { legs: [0.25, 0.75, 0, 0.5], amp: 0.3, bob: 0.015, rock: 0, lift: false },
  trot: { legs: [0, 0.5, 0.5, 0], amp: 0.42, bob: 0.03, rock: 0, lift: false },
  bound: { legs: [0, 0.07, 0.5, 0.57], amp: 0.75, bob: 0.2, rock: 0.12, lift: true },
  hop: { legs: [0, 0, 0.5, 0.5], amp: 0.85, bob: 0.16, rock: 0.15, lift: true },
};

interface Pace {
  gait: GaitName;
  /** m/s, and metres per stride. */
  speed: number;
  stride: number;
}

interface Kind {
  name: string;
  body: Body;
  scale: [number, number];
  walk: Pace;
  run: Pace;
  /** Head pitch feeding (positive is down), and on the alert. */
  feed: number;
  alert: number;
  /** Seconds feeding between moves, and how far a move goes. */
  rest: [number, number];
  roam: [number, number];
  /** It looks up at you within `notice` metres and runs from you within `spook`. */
  notice: number;
  spook: number;
  /** Eye-shine colour and sprite size (m). */
  eye: [number, number, number];
  eyeSize: number;
  /** Tail pitch at rest and on the run (negative lifts it): a deer flashes its white scut. */
  tail: [number, number];
}

const KINDS: Record<'deer' | 'wolf' | 'fox' | 'hare', Omit<Kind, 'body'>> = {
  deer: {
    name: 'deer',
    scale: [1.55, 1.8],
    walk: { gait: 'walk', speed: 0.9, stride: 1.5 },
    run: { gait: 'bound', speed: 8.5, stride: 4.2 },
    feed: 1.45,
    alert: -0.25,
    rest: [4, 12],
    roam: [3, 9],
    notice: 60,
    spook: 26,
    eye: [0.75, 0.95, 0.7],
    eyeSize: 0.2,
    tail: [0.1, -1.1],
  },
  wolf: {
    name: 'wolves',
    scale: [1.6, 1.85],
    walk: { gait: 'trot', speed: 1.6, stride: 1.4 },
    run: { gait: 'trot', speed: 3.6, stride: 2.0 },
    feed: 0.35,
    alert: -0.05,
    rest: [5, 14],
    roam: [3, 8],
    notice: 80,
    spook: 12,
    eye: [0.95, 0.9, 0.35],
    eyeSize: 0.18,
    tail: [-0.1, -0.45],
  },
  fox: {
    name: 'foxes',
    scale: [0.95, 1.05],
    walk: { gait: 'trot', speed: 1.8, stride: 1.0 },
    run: { gait: 'bound', speed: 6.5, stride: 2.2 },
    feed: 0.9,
    alert: -0.1,
    rest: [1.5, 5],
    roam: [0, 0],
    notice: 40,
    spook: 18,
    eye: [1.0, 0.75, 0.3],
    eyeSize: 0.13,
    tail: [-0.55, -0.7],
  },
  hare: {
    name: 'hares',
    scale: [2.0, 2.3],
    walk: { gait: 'hop', speed: 1.4, stride: 0.7 },
    run: { gait: 'hop', speed: 9, stride: 2.2 },
    feed: 0.45,
    alert: -0.25,
    rest: [3, 9],
    roam: [1.5, 5],
    notice: 30,
    spook: 16,
    eye: [1.0, 0.45, 0.35],
    eyeSize: 0.1,
    tail: [0, 0],
  },
};

type State = 'feed' | 'move' | 'alert' | 'flee' | 'howl';

interface Agent {
  kind: Kind;
  mesh: Creatures;
  i: number;
  /** Where it belongs: a centre and leash, or a round of points. */
  home: { x: number; z: number; r: number };
  path: Vec2[] | null;
  leg: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  phase: number;
  state: State;
  timer: number;
  tx: number;
  tz: number;
  scale: number;
  prop: number;
  hp: number;
  hy: number;
  tail: number;
  /** Looking round while feeding: when, and which way. */
  glance: number;
  look: number;
  zig: number;
}

/** Past this far a herd is a few pixels at most; it isn't drawn. */
const FAR = 420;
/** Cats sit about 0.9 m tall at this scale. */
const CAT = 2.1;
/** A wolf pack howls together, now and then. */
const HOWL_EVERY: [number, number] = [22, 45];

export function makeAnimals(data: AnimalsData, heights: Heights, camera: THREE.Camera, ctx: LifeContext): Living {
  const rand = rng(4242);
  const rr = (a: number, b: number) => range(rand, a, b);
  const material = rigMaterial('animal');
  const group = new THREE.Group();
  group.name = 'animals';

  const agents: Agent[] = [];
  const packs: { members: Agent[]; wait: number }[] = [];
  const kinds: { kind: Kind; mesh: Creatures }[] = [];
  const spawn = (key: keyof typeof KINDS, body: () => Body, groups: { center?: Vec2; radius?: number; path?: Vec2[]; count: number; stags?: number }[]) => {
    const total = groups.reduce((n, g) => n + g.count, 0);
    if (!total) return [];
    const kind: Kind = { ...KINDS[key], body: body() };
    const mesh = new Creatures(kind.name, kind.body.geometry, material, total);
    group.add(mesh.mesh);
    kinds.push({ kind, mesh });
    const made: Agent[][] = [];
    let i = 0;
    for (const g of groups) {
      const these: Agent[] = [];
      const home = g.path
        ? { x: g.path[0][0], z: g.path[0][1], r: 0 }
        : { x: g.center![0], z: g.center![1], r: g.radius! };
      for (let n = 0; n < g.count; n++, i++) {
        let x = home.x;
        let z = home.z;
        if (g.path) {
          const p = g.path[(n * Math.floor(g.path.length / g.count)) % g.path.length];
          [x, z] = [p[0] + rr(-2, 2), p[1] + rr(-2, 2)];
        } else {
          for (let tries = 0; tries < 20; tries++) {
            const a = rand() * Math.PI * 2;
            const d = Math.sqrt(rand()) * home.r * 0.8;
            [x, z] = [home.x + Math.cos(a) * d, home.z + Math.sin(a) * d];
            if (walkable(x, z)) break;
          }
        }
        these.push({
          kind,
          mesh,
          i,
          home,
          path: g.path ?? null,
          leg: n % (g.path?.length ?? 1),
          x,
          z,
          yaw: rand() * Math.PI * 2,
          speed: 0,
          phase: rand() * 6.28,
          state: 'feed',
          timer: rr(0, kind.rest[1]),
          tx: x,
          tz: z,
          scale: rr(...kind.scale) * (n < (g.stags ?? 0) ? 1.12 : 1),
          prop: n < (g.stags ?? 0) ? 1 : 0,
          hp: kind.feed,
          hy: 0,
          tail: kind.tail[0],
          glance: rr(2, 8),
          look: 0,
          zig: 0,
        });
      }
      agents.push(...these);
      made.push(these);
    }
    return made;
  };

  /** Open ground: dry, not up on the rock columns, and not too steep to stand on. */
  function walkable(x: number, z: number): boolean {
    const t = heights.terrain(x, z);
    if (t < 2 || heights.ground(x, z) - t > 0.5) return false;
    return Math.abs(heights.terrain(x + 1.5, z) - heights.terrain(x - 1.5, z)) + Math.abs(heights.terrain(x, z + 1.5) - heights.terrain(x, z - 1.5)) < 2.2;
  }

  spawn('deer', deer, data.deer);
  for (const pack of spawn('wolf', wolf, data.wolves)) packs.push({ members: pack, wait: rr(6, HOWL_EVERY[1]) });
  spawn('fox', fox, data.foxes);
  spawn('hare', hare, data.hares);

  // Black cats: they never leave their perches, just watch you.
  const catBody = cat();
  const cats = data.cats.map((c) => ({ at: new THREE.Vector3(...c.at), yaw: c.yaw, hp: 0, hy: 0, tail: 0, flick: rr(4, 15), glow: 0.6 }));
  const catMesh = cats.length ? new Creatures('cats', catBody.geometry, material, cats.length) : null;
  if (catMesh) group.add(catMesh.mesh);

  const eyes = new Pool(agents.length * 2 + cats.length * 2);
  group.add(eyes.points);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const nose = new THREE.Vector3();
  const base = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let eyeN = 0;

  /** Eye-shine: bright when the head faces the camera, fading with distance. */
  function shine(local: [number, number, number][], pivot: [number, number, number], hp: number, hy: number, matrix: THREE.Matrix4, color: [number, number, number], size: number, glow?: number) {
    headPoint(base, pivot, pivot, hp, hy, matrix);
    headPoint(nose, [pivot[0], pivot[1], pivot[2] + 1], pivot, hp, hy, matrix);
    nose.sub(base).normalize();
    for (const l of local) {
      headPoint(eye, l, pivot, hp, hy, matrix);
      // Just in front of the eye, so the head doesn't hide the sprite's centre.
      eye.addScaledVector(nose, 0.05 * size * 6);
      tmp.subVectors(camera.position, eye);
      const d = tmp.length();
      const facing = glow ?? smoothstep(0.55, 0.95, nose.dot(tmp.multiplyScalar(1 / d)));
      const k = facing * (1 - smoothstep(90, 260, d));
      eyes.pos.set([eye.x, eye.y, eye.z], eyeN * 3);
      eyes.col.set([color[0] * k * 1.6, color[1] * k * 1.6, color[2] * k * 1.6, k], eyeN * 4);
      eyes.size[eyeN] = k > 0.01 ? size : 0;
      eyeN++;
    }
  }

  function pickTarget(a: Agent) {
    if (a.path) {
      a.leg = (a.leg + 1) % a.path.length;
      [a.tx, a.tz] = [a.path[a.leg][0] + rr(-1.5, 1.5), a.path[a.leg][1] + rr(-1.5, 1.5)];
      return;
    }
    for (let tries = 0; tries < 8; tries++) {
      const ang = rand() * Math.PI * 2;
      const d = rr(...a.kind.roam);
      // Drift back toward the middle of the herd's ground.
      const tx = lerp(a.x + Math.cos(ang) * d, a.home.x, 0.25);
      const tz = lerp(a.z + Math.sin(ang) * d, a.home.z, 0.25);
      if (Math.hypot(tx - a.home.x, tz - a.home.z) < a.home.r && walkable(tx, tz)) {
        [a.tx, a.tz] = [tx, tz];
        return;
      }
    }
    [a.tx, a.tz] = [a.home.x + rr(-3, 3), a.home.z + rr(-3, 3)];
  }

  function step(a: Agent, dt: number) {
    const k = a.kind;
    const gy = heights.ground(a.x, a.z);
    const gx = ctx.player.x - a.x;
    const gz = ctx.player.z - a.z;
    const hd = Math.hypot(gx, gz);
    const dist = Math.hypot(hd, ctx.player.y - gy);
    if (a.state !== 'flee' && dist < k.spook) {
      a.state = 'flee';
      a.timer = rr(4, 7);
      a.zig = 0;
    } else if ((a.state === 'feed' || a.state === 'move') && dist < k.notice) {
      a.state = 'alert';
      a.timer = rr(2, 4);
    }

    let speed = 0;
    let wantYaw = a.yaw;
    let turn = 1.6;
    let hp = k.feed;
    let hy = 0;
    let tail = k.tail[0];
    const toward = Math.atan2(gx, gz);
    switch (a.state) {
      case 'feed':
        // Head down, lifted now and then to look round.
        a.glance -= dt;
        if (a.glance < 0) {
          a.glance = rr(3, 9);
          a.look = rr(-0.9, 0.9);
        }
        if (a.glance < 1.4) [hp, hy] = [k.alert * 0.5, a.look];
        if ((a.timer -= dt) <= 0) {
          pickTarget(a);
          a.state = 'move';
        }
        break;
      case 'move':
        speed = k.walk.speed * Math.sqrt(a.scale);
        wantYaw = Math.atan2(a.tx - a.x, a.tz - a.z);
        hp = 0.15;
        if (Math.hypot(a.tx - a.x, a.tz - a.z) < 1) {
          a.state = 'feed';
          a.timer = rr(...k.rest);
        }
        break;
      case 'alert': {
        // Stand and watch: the head follows you, and the body turns when the head can't.
        const rel = Math.atan2(Math.sin(toward - a.yaw), Math.cos(toward - a.yaw));
        hy = clamp(rel, -1.2, 1.2);
        hp = clamp(-Math.atan2(ctx.player.y - gy - 1, hd), -0.9, 0.3) + k.alert * 0.5;
        if (Math.abs(rel) > 1.1) [wantYaw, turn] = [toward, 0.8];
        if ((a.timer -= dt) <= 0) {
          if (dist < k.notice) a.timer = rr(1, 2.5);
          else {
            a.state = 'feed';
            a.timer = rr(2, 6);
          }
        }
        break;
      }
      case 'flee':
        speed = k.run.speed * Math.sqrt(a.scale);
        // Away from you; hares jink.
        a.zig += dt;
        wantYaw = toward + Math.PI + (k.run.gait === 'hop' ? Math.sin(a.zig * 3.1) * 0.7 : 0);
        turn = 4;
        hp = 0;
        tail = k.tail[1];
        if ((a.timer -= dt) <= 0 && dist > k.spook * 1.6) {
          a.state = 'move';
          [a.tx, a.tz] = [lerp(a.x, a.home.x, 0.5), lerp(a.z, a.home.z, 0.5)];
        }
        break;
      case 'howl':
        hp = -1.1;
        tail = 0.2;
        if ((a.timer -= dt) <= 0) {
          a.state = 'feed';
          a.timer = rr(...k.rest);
        }
        break;
    }

    a.yaw += clamp(Math.atan2(Math.sin(wantYaw - a.yaw), Math.cos(wantYaw - a.yaw)), -turn * dt, turn * dt);
    a.speed = lerp(a.speed, speed, dampK(a.state === 'flee' ? 3 : 2, dt));
    // Step, unless that leaves open ground or strays too far; then head home instead.
    const nx = a.x + Math.sin(a.yaw) * a.speed * dt;
    const nz = a.z + Math.cos(a.yaw) * a.speed * dt;
    const leashed = !a.path && Math.hypot(nx - a.home.x, nz - a.home.z) > a.home.r * (a.state === 'flee' ? 2.5 : 1.4);
    if (walkable(nx, nz) && !leashed) {
      a.x = nx;
      a.z = nz;
    } else {
      a.speed *= 0.5;
      [a.tx, a.tz] = [a.home.x + rr(-4, 4), a.home.z + rr(-4, 4)];
      if (a.state === 'feed' || a.state === 'move') a.state = 'move';
      else a.yaw = angLerp(a.yaw, Math.atan2(a.home.x - a.x, a.home.z - a.z), dampK(3, dt));
    }

    a.hp = lerp(a.hp, hp, dampK(4, dt));
    a.hy = lerp(a.hy, hy, dampK(4, dt));
    a.tail = lerp(a.tail, tail, dampK(5, dt));
  }

  function pose(a: Agent, dt: number) {
    const k = a.kind;
    const running = a.speed > ((k.walk.speed + k.run.speed) / 2) * Math.sqrt(a.scale);
    const pace = running ? k.run : k.walk;
    const g = GAITS[pace.gait];
    a.phase += (a.speed / (pace.stride * a.scale)) * Math.PI * 2 * dt;
    const swing = clamp(a.speed / (pace.speed * Math.sqrt(a.scale) * 0.6), 0, 1) * (ctx.reduceMotion && !running ? 0.7 : 1);
    const legs = g.legs.map((o) => g.amp * swing * Math.sin(a.phase + o * Math.PI * 2));
    const s = Math.sin(a.phase);
    const bob = g.lift ? g.bob * swing * Math.max(0, s) : g.bob * swing * Math.abs(Math.sin(a.phase * 2));
    // Follow the slope, nose to tail.
    const L = k.body.length * a.scale * 0.5;
    const fy = heights.ground(a.x + Math.sin(a.yaw) * L, a.z + Math.cos(a.yaw) * L);
    const by = heights.ground(a.x - Math.sin(a.yaw) * L, a.z - Math.cos(a.yaw) * L);
    const slope = Math.atan2(fy - by, 2 * L);
    e.set(-slope + g.rock * swing * s, a.yaw, 0);
    pos.set(a.x, (fy + by) / 2 + bob, a.z);
    m.compose(pos, q.setFromEuler(e), scl.setScalar(a.scale));
    const wag = a.state === 'feed' ? Math.sin(a.phase * 0.3 + a.i) * 0.15 : 0;
    a.mesh.set(a.i, m, [a.hp, a.hy, a.tail, wag], legs, [0, 0, 1, a.prop]);
    shine(k.body.eyes as [number, number, number][], k.body.head as [number, number, number], a.hp, a.hy, m, k.eye, k.eyeSize * a.scale);
  }

  /** Keep a herd from piling into one spot. */
  function spread(list: Agent[]) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.kind !== b.kind) continue;
        const min = a.kind.body.length * (a.scale + b.scale) * 0.45;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < min) {
          const push = (min - d) * 0.5;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
        }
      }
    }
  }

  const near = (cam: THREE.Camera, points: { x: number; z: number }[]) => points.some((p) => Math.hypot(p.x - cam.position.x, p.z - cam.position.z) < FAR);
  return {
    object: group,
    cull(cam) {
      for (const k of kinds) k.mesh.mesh.visible = near(cam, agents.filter((a) => a.mesh === k.mesh));
      if (catMesh) catMesh.mesh.visible = near(cam, cats.map((c) => c.at));
      eyes.points.visible = near(cam, [...agents, ...cats.map((c) => c.at)]);
    },
    update(dt) {
      // The pack howls together: one starts, the rest join within a second or two.
      for (const p of packs) {
        if ((p.wait -= dt) > 0) continue;
        p.wait = rr(...HOWL_EVERY);
        for (const w of p.members) {
          if (w.state === 'flee') continue;
          w.state = 'howl';
          w.timer = rr(3.5, 6) + rr(0, 1.5);
        }
      }
      eyeN = 0;
      for (const a of agents) step(a, dt);
      spread(agents);
      for (const a of agents) pose(a, dt);
      for (const k of kinds) k.mesh.flush();

      if (catMesh) {
        cats.forEach((c, i) => {
          tmp.subVectors(ctx.player, c.at);
          const d = tmp.length();
          // Within 30 m the head follows you; the eyes brighten as you come.
          const watching = d < 30;
          const rel = Math.atan2(Math.sin(Math.atan2(tmp.x, tmp.z) - c.yaw), Math.cos(Math.atan2(tmp.x, tmp.z) - c.yaw));
          c.hy = lerp(c.hy, watching ? clamp(rel, -1.4, 1.4) : 0, dampK(3, dt));
          c.hp = lerp(c.hp, watching ? clamp(-Math.atan2(tmp.y - 0.4, Math.hypot(tmp.x, tmp.z)), -0.7, 0.5) : 0.15, dampK(3, dt));
          c.glow = lerp(c.glow, 0.7 + 1.8 * smoothstep(30, 4, d), dampK(2, dt));
          // A flick of the tail every so often.
          c.flick -= dt;
          if (c.flick < 0) c.flick = rr(8, 18);
          const f = c.flick < 1.6 && !ctx.reduceMotion ? Math.sin((c.flick / 1.6) * Math.PI * 3) * 0.5 : 0;
          c.tail = lerp(c.tail, f, dampK(8, dt));
          m.compose(c.at, q.setFromEuler(e.set(0, c.yaw, 0)), scl.setScalar(CAT));
          catMesh.set(i, m, [c.hp, c.hy, 0, c.tail], [0, 0, 0, 0], [0, c.glow, 1, 0]);
          shine(catBody.eyes as [number, number, number][], catBody.head as [number, number, number], c.hp, c.hy, m, [1.0, 0.75, 0.2], 0.06 * CAT, Math.min(1, c.glow / 2));
        });
        catMesh.flush();
      }
      for (let i = eyeN; i < eyes.n; i++) eyes.size[i] = 0;
      eyes.flush();
    },
  };
}
