import './ui/style.css';
import * as THREE from 'three';
import { AudioEngine, zoneLabelAt } from './audio';
import { route as routeData, world, zones } from './data';
import { Flight } from './flight/flight';
import { Route } from './flight/route';
import { makeBats } from './life/bats';
import { makeCandles } from './life/candles';
import { makeGhosts } from './life/ghosts';
import { makeLake } from './life/lake';
import { makePumpkins } from './life/pumpkins';
import { initSprites, setSpriteScale } from './life/sprites';
import type { LifeContext, Living } from './life/types';
import { makeWyrm } from './life/wyrm';
import { makePost } from './render/post';
import { validateScene } from './render/validate';
import { makeHud } from './ui/hud';
import { makeInput } from './ui/input';
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

function boot() {
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
  // The world is static, so the moon's shadow map is rendered once.
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(world.fog.color);
  const fog = new THREE.FogExp2(fogColor, world.fog.density);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.4, 9000);

  // World.
  const tex = makeTextures(renderer.capabilities.getMaxAnisotropy());
  initSprites(tex.glow);
  const M = makeMaterials(tex);
  const heights = new Heights(world);
  const sky = makeSky(world, tex, fogColor);
  const castle = buildCastle(world, heights, M, tex);
  const lights = makeLights(world, M, sky.moonDir, castle.boathouseLight, castle.lanternSpots);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const water = makeWater(size.x, size.y, fogColor, world.fog.density);
  const mist = makeMist(world.life.mist, heights, tex.mist, reduceMotion);
  scene.add(
    sky.group,
    makeTerrain(world, heights),
    makeRockColumn(world.cliff, 'cliff'),
    makeRockColumn(world.outcrop, 'outcrop'),
    castle.group,
    makeTrees(world, heights, M, castle.viaduct.b),
    lights.group,
    water.mesh,
    mist.group,
  );

  // Flight and sound.
  const audio = new AudioEngine(zones);
  const route = new Route(routeData, new THREE.Vector3(...world.castleCentre));
  const flight = new Flight(world, route, heights, castle.colliders, castle.hall, camera, reduceMotion, () => audio.trigger('whoosh'));
  scene.add(flight.ghost.group, flight.trail.points);

  // Life.
  const ctx: LifeContext = { reduceMotion, player: flight.pos, sound: (type, at) => audio.trigger(type, at) };
  const living: Living[] = [
    makePumpkins(world, tex, castle.viaduct, ctx),
    makeCandles(world.life.candles, castle.hall, ctx),
    makeGhosts(world.life.ghosts, {
      gate: castle.gate.clone().add(new THREE.Vector3(0, 4, -14)),
      hall: new THREE.Vector3(castle.hall.cx, castle.hall.y0 + 6, castle.hall.cz),
      pier: castle.boatHome.clone().setY(3),
    }),
    makeBats(world.life.bats),
    makeWyrm(world, M, ctx),
    makeLake(world, M, castle.boatHome),
  ];
  for (const l of living) scene.add(l.object);

  if (import.meta.env.DEV) {
    const problems = validateScene(scene);
    if (problems.length) console.error(`Non-finite geometry (fix before it reaches bloom):\n${problems.join('\n')}`);
  }

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

  // Loop. Paused while the tab is hidden.
  let last = performance.now();
  let frames = 0;
  let acc = 0;
  let adapted = 0;
  let first = true;
  let raf = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    flight.step(dt, input.read());
    const t = flight.time;
    fog.density = world.fog.density * (1 + 3 * flight.boundary);
    water.update(t, fog.density);
    sky.update(dt);
    mist.update(dt, t);
    lights.update(t);
    for (const l of living) l.update(dt, t);
    audio.update({ position: flight.pos, yaw: flight.yaw, speed: flight.vel.length() }, dt);
    hud.update(flight, zoneLabelAt(zones, flight.pos));
    if (first) renderer.shadowMap.needsUpdate = true;
    post.render(dt, t, flight.phase);
    if (first) {
      first = false;
      hud.ready();
    }
    // Lower the resolution once or twice if the GPU is struggling.
    frames++;
    acc += dt;
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

  // A small hook for tinkering in the console and for screenshot tests.
  Object.assign(window, { hollowmere: { flight, scene, renderer, post, jump: (t: number) => flight.jump(t) } });
}

boot();
