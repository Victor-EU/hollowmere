import './ui/style.css';
import * as THREE from 'three';
import { AudioEngine, zoneLabelAt } from './audio';
import { look, route as routeData, world, zones } from './data';
import { Flight } from './flight/flight';
import { Route } from './flight/route';
import { makeAnimals } from './life/animals';
import { makeBats } from './life/bats';
import { makeCandles } from './life/candles';
import { makeCrows } from './life/crows';
import { makeFeast } from './life/feast';
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
import { Quality } from './render/quality';
import { bakeShadows } from './render/shadows';
import { makeHud } from './ui/hud';
import { makeInput } from './ui/input';
import { TextureLibrary } from './world/assets';
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
/** Startup milestones, read by tools/loadtime.ts. */
const mark = (name: string) => performance.mark(`hm:${name}`);
/** The first frame waits this long at most for the texture previews; past it, flat colours. */
const PREVIEW_WAIT = 1500;
/** Unfocused this long, the loop drops to 30 fps (design doc §19). */
const UNFOCUSED_CAP = 60_000;

function noWebGL() {
  $('#nogl').hidden = false;
  $('#loader').hidden = true;
}

async function boot() {
  mark('boot');
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
  const params = new URLSearchParams(location.search);
  const quality = new Quality(renderer.getContext() as WebGL2RenderingContext, params);
  // The manifest and texture previews download while the world is built.
  const library = TextureLibrary.open(renderer);
  let dpr = quality.pixelRatio;
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
  mark('canvas-textures');
  const lib = await library;
  mark('manifest');
  const M = makeMaterials(lib);
  const heights = new Heights(world);
  const sky = makeSky(world, tex, fogColor);
  const castle = buildCastle(world, heights, M, tex);
  const lights = makeLights(world, M, sky.moonDir, castle.boathouseLight, castle.lanternSpots, quality.shadowMap);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // The low tier's reflection probe: over the middle of the lake, with the shores a little past its radii.
  const probe = { at: new THREE.Vector3(world.lake.center[0], 4, world.lake.center[1]), radius: Math.max(...world.lake.radii) * 1.2 };
  const water = makeWater(size.x, size.y, camera, fogColor, tex.ripples, sky.moonDir, probe);
  const mist = makeMist(world.life.mist, heights, tex.mist, sky.moonDir, reduceMotion);
  /** Everything outside: inside the great hall it's hidden (see the culling below). */
  const outdoors: THREE.Object3D[] = [
    sky.group,
    makeTerrain(world, heights),
    makeRockColumn(world.cliff, 'cliff'),
    makeRockColumn(world.outcrop, 'outcrop'),
    makeTrees(world, heights, M, tex, castle.viaduct.b),
    water.mesh,
    mist.mesh,
  ];
  scene.add(...outdoors, castle.group, lights.group);

  // Flight and sound.
  // Devices that start on the low tier also get the music decoded at half rate.
  const audio = new AudioEngine(zones, { decodeRate: quality.textures === 'mobile' ? 24000 : undefined });
  const route = new Route(routeData, new THREE.Vector3(...world.castleCentre));
  const flight = new Flight(world, route, heights, castle.colliders, castle.hall, camera, reduceMotion, () => audio.trigger('whoosh'));
  scene.add(flight.ghost.group, flight.trail.points);

  // Life.
  const ctx: LifeContext = { reduceMotion, player: flight.pos, playerVel: flight.vel, sound: (type, at) => audio.trigger(type, at) };
  // Everything here moves except the pumpkins and candles.
  const pumpkins = makePumpkins(world, tex, castle.viaduct, ctx);
  const wyrm = makeWyrm(world, tex, ctx);
  const warden = makeWarden(world, heights, M, ctx, castle.colliders);
  const gargoyles = makeGargoyles(castle.gargoyles, world.life.gargoyles.reach, M, ctx);
  const lake = makeLake(world, M, castle.boatHome);
  const still: Living[] = [pumpkins, makeCandles(world.life.candles, castle.hall, ctx)];
  const moving: Living[] = [
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
    wyrm,
    warden,
    gargoyles,
    lake,
  ];
  const living = [...still, ...moving];
  for (const l of living) scene.add(l.object);
  // In the great hall the walls and the stained glass hide the whole outdoors, so it isn't drawn
  // from in there: the land, the trees, the lake and its reflection, and what lives outside. Lights
  // stay, since a change in their number would recompile every shader on the way in.
  const H = castle.hall;
  const indoors = (p: THREE.Vector3) => p.x > H.x0 + 1 && p.x < H.x1 - 1 && p.z > H.z0 + 1 && p.z < H.z1 - 1 && p.y > H.y0 && p.y < H.y0 + H.wallH;
  const hideable = (o: THREE.Object3D): THREE.Object3D[] => {
    let lit = false;
    o.traverse((c) => (lit ||= (c as THREE.Light).isLight === true));
    return lit ? o.children.flatMap((c) => ((c as THREE.Light).isLight ? [] : hideable(c))) : [o];
  };
  const outside = [...outdoors, ...[pumpkins, wyrm, warden, gargoyles, lake].map((l) => l.object)].flatMap(hideable);
  scene.onBeforeRender = (_r, _s, cam) => {
    const out = !indoors(cam.position);
    for (const o of outside) o.visible = out;
    for (const l of living) l.cull?.(cam);
  };
  /** Left out of the lake's probe, which would freeze them. */
  const unreflected = [flight.ghost.group, flight.trail.points, ...moving.map((l) => l.object)];
  mark('world');

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
    dismiss: () => hud.closeHelp(),
    // Browsers need a gesture before audio; if sound was on last time, any gesture brings it back.
    gesture: () => {
      if (audio.wantsSound && !audio.on && !soundBusy) audio.resumeFromGesture().then(() => hud.setSound(audio.on));
    },
  });

  // Deep links: ?at=hall starts at a named route point, ?autofly=0 starts in free flight.
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
  // The tier's settings, now and whenever adaptation (or the battery) changes it.
  let probeStale = false;
  let reflection: number | 'probe' | null = null;
  const applyQuality = () => {
    const s = quality.settings;
    dpr = quality.pixelRatio;
    // Draw the probe when the lake first needs it.
    if (s.reflection === 'probe' && reflection !== 'probe') probeStale = true;
    reflection = s.reflection;
    water.setReflection(s.reflection);
    post.setMsaa(s.msaa);
    post.setBloomMips(s.bloomMips);
    onResize();
  };
  applyQuality();
  quality.onChange(applyQuality);
  flight.jump(flight.auto.t);

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
    quality: () => ({ dpr, name: quality.name, pinned: quality.pinned, log: quality.log, streamed: lib.streamed }),
    zoneLabel: () => zoneLabelAt(zones, flight.pos),
  };
  let dev: DevTools | null = null;
  if (import.meta.env.DEV) dev = (await import('./dev')).installDev(host);
  else if (params.has('stats')) dev = (await import('./dev/stats')).statsOnly(host);

  // Shaders compile while the previews finish downloading, so the first frame doesn't stall on either.
  const all = camera.layers.mask;
  camera.layers.enableAll();
  const compiled = renderer.compileAsync(scene, camera);
  camera.layers.mask = all;
  await Promise.all([lib.previews(PREVIEW_WAIT), compiled]);
  mark('previews');

  /** Life that isn't in the opening shot, built and compiled after the first frame so it can't hold that up. */
  const addLater = async () => {
    for (const [make, out] of [
      [() => makeAnimals(world.life.animals, heights, camera, ctx), true],
      [() => makeCrows([...world.life.crows.perches.map((p) => new THREE.Vector3(...p)), ...castle.boathouseRidge], world.life.crows.ground, world.life.crows.every, heights, ctx), true],
      [() => makeFeast(castle.hall, M, camera, ctx, quality.textures === 'desktop'), false],
    ] as const) {
      const l = make();
      await renderer.compileAsync(l.object, camera, scene);
      scene.add(l.object);
      living.push(l);
      unreflected.push(l.object);
      if (out) outside.push(...hideable(l.object));
    }
    mark('later');
  };

  // Loop. Paused while the tab is hidden, and at 30 fps once the window has been unfocused a minute.
  let last = performance.now();
  let first = true;
  let raf = 0;
  let blurredAt = document.hasFocus() ? null : last;
  addEventListener('blur', () => (blurredAt = performance.now()));
  addEventListener('focus', () => (blurredAt = null));
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const capped = blurredAt !== null && now - blurredAt > UNFOCUSED_CAP;
    if (capped && now - last < 1000 / 30 - 4) return;
    // The world steps at most 50 ms a frame; the frame-rate check needs the true time.
    const elapsed = (now - last) / 1000;
    const real = Math.min(0.05, elapsed);
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
    lib.update(real);
    audio.update({ position: flight.pos, yaw: flight.yaw }, dt);
    hud.update(flight, zoneLabelAt(zones, flight.pos));
    dev?.update(real);
    post.render(dt, t, flight.phase);
    dev?.end();
    if (first) {
      first = false;
      // The moon's map is drawn; from now on only the Warden's lantern redraws one.
      bakeShadows(scene);
      hud.ready();
      mark('first-frame');
      // Full-resolution textures, now that you can fly; the lake's probe sees them once they're in.
      void lib.stream(quality.textures).then(() => (probeStale = quality.settings.reflection === 'probe'));
      void addLater();
    }
    if (probeStale) {
      probeStale = false;
      water.capture(renderer, scene, unreflected);
    }
    // A frame over a second is a hitch (a compile, a GC, a stall), not a frame rate.
    quality.frame(elapsed, !capped && elapsed < 1);
  };
  document.addEventListener('visibilitychange', () => {
    audio.setPaused(document.hidden);
    if (document.hidden) cancelAnimationFrame(raf);
    else {
      last = performance.now();
      quality.frame(0, false);
      raf = requestAnimationFrame(frame);
    }
  });
  raf = requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  // A small hook for tinkering in the console, screenshot tests, `npm run validate` and `npm run a11y`.
  Object.assign(window, {
    hollowmere: { flight, scene, renderer, post, audio, look, lookChanged, quality, reduceMotion, textures: lib, dev: dev as Dev | null, jump: (t: number) => flight.jump(t) },
  });
}

void boot();
