import * as THREE from 'three';
import type { FlightInput } from '../flight/flight';
import { clamp, dampK } from '../world/math';

const UP = new THREE.Vector3(0, 1, 0);
const KEY = 'hollowmere:freecam';

export interface Pose {
  pos: [number, number, number];
  yaw: number;
  pitch: number;
}

/**
 * A detached camera for looking at the world from anywhere: same keys and drag as flight, wheel
 * sets speed, Shift is 5x. The ghost keeps flying on its own while it is active.
 */
export class FreeCam {
  active = false;
  /** m/s before Shift. */
  speed = 24;
  /** The camera's own pose: the follow camera rewrites camera.position every frame. */
  private pos = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private vel = new THREE.Vector3();
  private move = { forward: 0, strafe: 0, rise: 0, boost: false };
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private wish = new THREE.Vector3();
  private saved = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Start from wherever the camera is now. */
  enter() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.pos.copy(this.camera.position);
    this.pitch = e.x;
    this.yaw = e.y;
    this.vel.set(0, 0, 0);
    this.active = true;
    this.save();
  }

  exit() {
    this.active = false;
    this.save();
  }

  pose(): Pose {
    const p = this.pos;
    return { pos: [p.x, p.y, p.z], yaw: this.yaw, pitch: this.pitch };
  }

  setPose(pose: Pose) {
    this.pos.set(...pose.pos);
    this.camera.position.copy(this.pos);
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
    this.vel.set(0, 0, 0);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /** Look at `target` from `distance` away, keeping the current heading. */
  frame(target: THREE.Vector3, distance = 45) {
    if (!this.active) this.enter();
    const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const from = target.clone().addScaledVector(dir, -distance).addScaledVector(UP, distance * 0.35);
    const to = target.clone().sub(from).normalize();
    this.setPose({ pos: [from.x, from.y, from.z], yaw: Math.atan2(-to.x, -to.z), pitch: Math.asin(clamp(to.y, -1, 1)) });
    this.save();
  }

  /** Point along the view, `ahead` metres out. */
  ahead(ahead: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).addScaledVector(this.viewDir(this.fwd), ahead);
  }

  get heading(): [number, number] {
    return [this.yaw, this.pitch];
  }

  /** Take this frame's input; the ghost gets none of it. */
  steer(input: FlightInput) {
    this.yaw -= input.lookDX * 0.0034;
    this.pitch = clamp(this.pitch - input.lookDY * 0.003, -1.55, 1.55);
    input.lookDX = input.lookDY = 0;
    this.move.forward = input.forward;
    this.move.strafe = input.strafe;
    this.move.rise = input.rise;
    this.move.boost = input.boost;
  }

  wheel(e: WheelEvent) {
    this.speed = clamp(this.speed * Math.exp(-e.deltaY * 0.0015), 2, 400);
  }

  update(dt: number) {
    const m = this.move;
    this.viewDir(this.fwd);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.wish.set(0, 0, 0).addScaledVector(this.fwd, m.forward).addScaledVector(this.right, m.strafe).addScaledVector(UP, m.rise);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    this.wish.multiplyScalar(this.speed * (m.boost ? 5 : 1));
    this.vel.lerp(this.wish, dampK(10, dt));
    this.pos.addScaledVector(this.vel, dt);
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.saved += dt;
    if (this.saved > 1) this.save();
  }

  /** Remember the pose across reloads, so editing code doesn't throw the view away. */
  save() {
    this.saved = 0;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ active: this.active, speed: this.speed, ...this.pose() }));
    } catch {
      // Storage can be unavailable; the pose just isn't remembered.
    }
  }

  restore(): boolean {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as (Pose & { active: boolean; speed: number }) | null;
      if (!s?.active || !s.pos.every(Number.isFinite)) return false;
      this.speed = s.speed || this.speed;
      this.active = true;
      this.setPose(s);
      return true;
    } catch {
      return false;
    }
  }

  private viewDir(out: THREE.Vector3) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
}
