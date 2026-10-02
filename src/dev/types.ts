import type * as THREE from 'three';
import type { RouteData, WorldData, Zone } from '../data';
import type { Flight, FlightInput } from '../flight/flight';
import type { Route } from '../flight/route';
import type { Hud } from '../ui/hud';
import type { Input } from '../ui/input';
import type { Colliders } from '../world/castle';
import type { Heights } from '../world/heights';

/** What the app hands its dev tools. */
export interface DevHost {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  flight: Flight;
  route: Route;
  /** The live route data. The route editor edits it in place. */
  routeData: RouteData;
  world: WorldData;
  zones: Zone[];
  heights: Heights;
  colliders: Colliders;
  input: Input;
  hud: Hud;
  /** Current pixel ratio and how many times the adaptive loop has lowered it. */
  quality(): { dpr: number; adapted: number };
  zoneLabel(): string | null;
}

/** Hooks the main loop calls each frame. */
export interface DevTools {
  begin(now: number): void;
  /** World time step: 0 while paused, one frame when stepping. */
  worldDt(dt: number): number;
  /** Takes the input while a dev camera is flying and returns what the ghost gets instead. */
  steer(input: FlightInput, dt: number): FlightInput;
  /** After the world has moved, before rendering: dev cameras and overlays. */
  update(dt: number): void;
  end(): void;
}
