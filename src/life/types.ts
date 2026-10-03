import type * as THREE from 'three';
import type { AudioEventType } from '../audio/types';

/** Anything in the world that moves on its own. */
export interface Living {
  object: THREE.Object3D;
  update(dt: number, time: number): void;
  /** Called before each render of the scene with the camera drawing it (the view, the lake's reflection), to hide what that camera can't see. */
  cull?(camera: THREE.Camera): void;
}

/** Things living systems may need from the rest of the app. */
export interface LifeContext {
  reduceMotion: boolean;
  /** The player ghost's position and velocity, read every frame. */
  player: THREE.Vector3;
  playerVel: THREE.Vector3;
  /** Where the ghost will be in `s` seconds: along the route on autofly, straight on otherwise. */
  ahead(s: number, out: THREE.Vector3): THREE.Vector3;
  /** Play a positioned one-shot (dragon roar, a ghost's sigh). */
  sound(type: AudioEventType, at: THREE.Vector3): void;
}
