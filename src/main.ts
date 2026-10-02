import './ui/style.css';
import * as THREE from 'three';
import { AudioEngine, zoneLabelAt } from './audio';
import { look, route as routeData, world, zones } from './data';
import { Flight } from './flight/flight';
import { Route } from './flight/route';
import { makeBats } from './life/bats';
import { makeCandles } from './life/candles';
import { makeCrows } from './life/crows';
import { makeGargoyles } from './life/gargoyles';
import { makeGhosts } from './life/ghosts';
import { makeLake } from './life/lake';
import { makePumpkins } from './life/pumpkins';
import { initSprites, setSpriteScale } from './life/sprites';
import type { LifeContext, Living } from './life/types';
import { makeWarden } from './life/warden';
import { makeWyrm } from './life/wyrm';
import type { Dev } from './dev';
import type { DevHost, DevTools } from './dev/types';
import { lookChanged, onLook } from './render/look';
import { makePost } from './render/post';
import { bakeShadows } from './render/shadows';
import { makeHud } from './ui/hud';
import { makeInput } from './ui/input';
import { loadLibrary, pickTier } from './world/assets';
import { buildCastle } from './world/castle';
import { Heights } from './world/heights';
import { makeLights } from './world/lights';
import { makeMaterials } from './world/materials';
import { makeMist } from './world/mist';
import { makeSky } from './world/sky';
import { makeRockColumn, makeTerrain } from './world/terrain';
import { makeTextures } from './world/textures';
import { makeTrees } from './world/trees';
import { makeWater } from './world/water';

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

function noWebGL() {
  $('#nogl').hidden = false;
  $('#loader').hidden = true;
}

async function boot() {
  const canvas = $<HTMLCanvasElement>('#scene');
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    console.error(err);
    noWebGL();
    return;
  }
  let dpr = Math.min(window.devicePixelRatio || 1, isTouch ? 1.25 : 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(0, look.fog.density);
  // Shared with the shaders that fog themselves (sky, water), so tuning reaches them too.
  const fogColor = fog.color;
  scene.fog = fog;
  onLook(() => fogColor.set(look.fog.color));
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.4, 9000);

  // World.
  const tex = makeTextures(renderer.capabilities.getMaxAnisotropy());
  initSprites(tex.glow);
  const M = makeMaterials(await loadLibrary(renderer, pickTier()));
  const heights = new Heights(world);
  const sky = makeSky(world, tex, fogColor);
  const castle = buildCastle(world, heights, M, tex);
  const lights = makeLights(world, M, sky.moonDir, castle.boathouseLight, castle.lanternSpots);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const water = makeWater(size.x, size.y, camera, fogColor, tex.ripples, sky.moonDir);
  const mist = makeMist(world.life.mist, heights, tex.mist, sky.moonDir, reduceMotion);
  scene.add(
    sky.group,
    makeTerrain(world, heights),
    makeRockColumn(world.cliff, 'cliff'),
    makeRockColumn(world.outcrop, 'outcrop'),
    castle.group,
    makeTrees(world, heights, M, tex, castle.viaduct.b),
    lights.group,
    water.mesh,
    mist.mesh,
  );

  // Flight and sound.
  const audio = new AudioEngine(zones);
  const route = new Route(routeData, new THREE.Vector3(...world.castleCentre));
  const flight = new Flight(world, route, heights, castle.colliders, castle.hall, camera, reduceMotion, () => audio.trigger('whoosh'));
  scene.add(flight.ghost.group, flight.trail.points);

  // Life.
  const ctx: LifeContext = { reduceMotion, player: flight.pos, playerVel: flight.vel, sound: (type, at) => audio.trigger(type, at) };
  const living: Living[] = [
    makePumpkins(world, tex, castle.viaduct, ctx),
    makeCandles(world.life.candles, castle.hall, ctx),
    makeGhosts(
      world.life.ghosts,
      {
        gate: castle.gate.clone().add(new THREE.Vector3(0, 4, -14)),
        hall: new THREE.Vector3(castle.hall.cx, castle.hall.y0 + 6, castle.hall.cz),
        pier: castle.boatHome.clone().setY(3),
      },
      castle.hall,
      M,
      ctx,
    ),
    makeBats(world.life.bats, ctx),
    makeWyrm(world, tex, ctx),
    makeWarden(world, heights, M, ctx, castle.colliders),
    makeGargoyles(castle.gargoyles, world.life.gargoyles.reach, M, ctx),
    makeCrows([...world.life.crows.perches.map((p) => new THREE.Vector3(...p)), ...castle.boathouseRidge], world.life.crows.every, ctx),
    makeLake(world, M, castle.boatHome),
  ];
  for (const l of living) scene.add(l.object);

  // UI.
  const toggleAuto = () => hud.setAuto(flight.toggleAuto());
  let soundBusy = false;
  const toggleSound = () => {
    soundBusy = true;
    audio.toggle().then((on) => {
      soundBusy = false;
      hud.setSound(on);
    });
  };
  const hud = makeHud(isTouch, { toggleAuto, toggleSound });
  // Sound can't start before a gesture; show that it will, if it was on last time.
  hud.setSound(false, audio.wantsSound);
  const input = makeInput(canvas, isTouch, {
    toggleAuto,
    toggleSound,
    toggleHelp: () => hud.toggleHelp(),
    // Browsers need a gesture before audio; if sound was on last time, any gesture brings it back.
    gesture: () => {
      if (audio.wantsSound && !audio.on && !soundBusy) audio.resumeFromGesture().then(() => hud.setSound(audio.on));
    },
  });

  // Deep links: ?at=hall starts at a named route point, ?autofly=0 starts in free flight.
  const params = new URLSearchParams(location.search);
  const at = params.get('at');
  if (at && at in routeData.named) flight.jump(route.tAt(routeData.named[at]));
  if (params.get('autofly') === '0') toggleAuto();

  const post = makePost(renderer, scene, camera, reduceMotion);
  const onResize = () => {
    flight.frame(innerWidth / innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(innerWidth, innerHeight, false);
    post.setSize(innerWidth, innerHeight, dpr);
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    water.setSize(buf.x, buf.y);
    setSpriteScale(buf.y, camera.fov);
  };
  addEventListener('resize', onResize);
  onResize();
  flight.jump(flight.auto.t);

  // Adaptive resolution: frames and seconds since the last check, and how often it stepped down.
  let frames = 0;
  let acc = 0;
  let adapted = 0;

  // Dev tools: everything in dev builds; just the stats overlay with ?stats in production.
  const host: DevHost = {
    canvas,
    renderer,
    scene,
    camera,
    flight,
    route,
    routeData,
    world,
    zones,
    heights,
    colliders: castle.colliders,
    input,
    hud,
    quality: () => ({ dpr, adapted }),
    zoneLabel: () => zoneLabelAt(zones, flight.pos),
  };
  let dev: DevTools | null = null;
  if (import.meta.env.DEV) dev = (await import('./dev')).installDev(host);
  else if (params.has('stats')) dev = (await import('./dev/stats')).statsOnly(host);

  // Loop. Paused while the tab is hidden.
  let last = performance.now();
  let first = true;
  let raf = 0;
  const frame = (now: number) => {
    const real = Math.min(0.05, (now - last) / 1000);
    last = now;
    dev?.begin(now);
    // Dev tools can pause the world or fly their own camera.
    const dt = dev ? dev.worldDt(real) : real;
    const raw = input.read();
    flight.step(dt, dev ? dev.steer(raw, real) : raw);
    const t = flight.time;
    fog.density = look.fog.density * (1 + 3 * flight.boundary);
    water.update(t, fog.density);
    sky.update(dt);
    mist.update(t);
    lights.update(t);
    for (const l of living) l.update(dt, t);
    audio.update({ position: flight.pos, yaw: flight.yaw, speed: flight.vel.length() }, dt);
    hud.update(flight, zoneLabelAt(zones, flight.pos));
    dev?.update(real);
    post.render(dt, t, flight.phase);
    dev?.end();
    if (first) {
      first = false;
      // The moon's map is drawn; from now on only the Warden's lantern redraws one.
      bakeShadows(scene);
      hud.ready();
    }
    // Lower the resolution once or twice if the GPU is struggling.
    frames++;
    acc += real;
    if (acc > 2.5) {
      const fps = frames / acc;
      frames = 0;
      acc = 0;
      if (fps < 38 && adapted < 2 && dpr > 0.75) {
        dpr = Math.max(0.75, dpr * 0.75);
        adapted++;
        onResize();
      }
    }
    raf = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', () => {
    audio.setPaused(document.hidden);
    if (document.hidden) cancelAnimationFrame(raf);
    else {
      last = performance.now();
      frames = acc = 0;
      raf = requestAnimationFrame(frame);
    }
  });
  raf = requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  // A small hook for tinkering in the console, screenshot tests and `npm run validate`.
  Object.assign(window, {
    hollowmere: { flight, scene, renderer, post, audio, look, lookChanged, dev: dev as Dev | null, jump: (t: number) => flight.jump(t) },
  });
}

void boot();
