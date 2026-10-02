import * as THREE from 'three';
import type { WorldData } from '../data';
import { Pool } from '../life/sprites';
import type { Castle, Colliders } from '../world/castle';
import type { Heights } from '../world/heights';
import { angLerp, clamp, dampK, lerp, smoothstep } from '../world/math';
import { ghostShadow, makeGhost, type Ghost } from './ghost';
import type { Route } from './route';

/** Movement and look input for one frame. Look deltas are pixels and are consumed by `step`. */
export interface FlightInput {
  forward: number;
  strafe: number;
  rise: number;
  boost: boolean;
  lookDX: number;
  lookDY: number;
  /** Camera distance multiplier, 0.4..2.4. */
  zoom: number;
}

export interface Autofly {
  enabled: boolean;
  /** The player is flying; autofly waits for 12 s of no movement input. */
  override: boolean;
  /** Blend weight between player input (0) and autofly (1). */
  w: number;
  /** Carrot position on the route. */
  t: number;
  idle: number;
  /** Seconds left before autofly takes the view back after a drag. */
  lookHold: number;
}

export type Where = '' | 'hall' | 'stone';

// Flight constants from the mockup (design doc §6, §7).
const CRUISE = 17;
const BOOST = 40;
const RETURN_AFTER = 12;
const LOOK_HOLD = 3;
const YAW_PER_PX = 0.0034;
const PITCH_PER_PX = 0.003;
const PITCH_LIMIT = 1.25;
export const CLEARANCE = 1.8;

const UP = new THREE.Vector3(0, 1, 0);

/** Whether p is inside any wall or tower volume; 'hall' for the great hall's box. */
export function insideColliders(colliders: Colliders, p: THREE.Vector3): boolean | 'hall' {
  for (const c of colliders.cyl) {
    if (p.y > c.y0 && p.y < c.y1 && (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < c.r * c.r) return true;
  }
  for (const b of colliders.box) {
    if (p.y < b.y0 || p.y > b.y1) continue;
    const dx = p.x - b.cx;
    const dz = p.z - b.cz;
    const cs = Math.cos(b.rot);
    const sn = Math.sin(b.rot);
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    if (Math.abs(lx) < b.hl && Math.abs(lz) < b.ht) return b.hall ? 'hall' : true;
  }
  return false;
}

export class Flight {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = -0.05;
  /** Ghost body heading, eased toward the direction of travel. */
  private gyaw = 0;
  private bankRoll = 0;
  dist = 11;
  distBase = 11;
  readonly auto: Autofly = { enabled: true, override: false, w: 1, t: 0, idle: 0, lookHold: 0 };
  /** 1 on passing through a wall, decaying over ~0.6 s. Drives the phase effect. */
  phase = 0;
  inside = false;
  where: Where = '';
  time = 0;
  /** Set when the player has touched any control. */
  touched = false;
  /** 1 at the soft boundary and beyond: thickens the fog. */
  boundary = 0;

  readonly ghost: Ghost;
  readonly trail = new Pool(260);
  private camPos = new THREE.Vector3();
  private lastInside: boolean | 'hall' = false;
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private wish = new THREE.Vector3();
  private autoVel = new THREE.Vector3();
  private target = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private ghostQ = new THREE.Quaternion();
  private ghostE = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private world: WorldData,
    private route: Route,
    private heights: Heights,
    private colliders: Colliders,
    private hall: Castle['hall'],
    private camera: THREE.PerspectiveCamera,
    private reduceMotion: boolean,
    /** Called when the ghost passes into or out of stone. */
    private onPhase: () => void,
  ) {
    this.ghost = makeGhost(0, 0.85);
    this.ghost.group.name = 'player-ghost';
    this.ghost.group.scale.setScalar(1.6);
    this.ghost.group.add(ghostShadow());
    this.trail.points.name = 'ghost-trail';
    this.camera.rotation.order = 'YXZ';
    this.jump(0);
  }

  /** Portrait screens get a wider FOV and a farther camera. */
  frame(aspect: number) {
    this.camera.fov = aspect < 1 ? 68 : 55;
    this.distBase = aspect < 1 ? 15 : 11;
  }

  /** Teleport to route parameter t, facing along autofly's look. */
  jump(t: number) {
    const A = this.auto;
    A.t = t;
    this.route.point(t, this.pos);
    this.vel.set(0, 0, 0);
    this.phase = 0;
    this.lastInside = insideColliders(this.colliders, this.pos);
    const d = this.route.point(t + 0.004).sub(this.pos).normalize();
    [this.yaw, this.pitch] = this.route.look(t, this.pos);
    this.gyaw = Math.atan2(d.x, d.z);
    this.dist = this.distBase;
    this.snapCamera();
  }

  /** Teleport anywhere, facing yaw and pitch. Autofly, if on, picks up from the nearest route point. */
  place(p: THREE.Vector3, yaw: number, pitch: number) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.phase = 0;
    this.lastInside = insideColliders(this.colliders, this.pos);
    this.yaw = yaw;
    this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.gyaw = yaw + Math.PI;
    this.auto.t = this.route.nearest(p);
    this.snapCamera();
  }

  /** Re-find the carrot after the route changed shape. */
  resync() {
    this.auto.t = this.route.nearest(this.pos);
  }

  toggleAuto(): boolean {
    const A = this.auto;
    A.enabled = !A.enabled;
    if (A.enabled) {
      A.override = false;
      A.idle = 0;
      A.t = this.route.nearest(this.pos);
    }
    return A.enabled;
  }

  /** Seconds until autofly takes back over, or null when it isn't waiting. */
  get returnsIn(): number | null {
    const A = this.auto;
    return A.enabled && A.override ? Math.max(0, Math.ceil(RETURN_AFTER - A.idle)) : null;
  }

  private snapCamera() {
    const f = this.tmpA.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camPos.copy(this.pos).addScaledVector(f, -this.dist).add(this.tmpB.set(0, 1.6 + this.dist * 0.18, 0));
    this.camera.position.copy(this.camPos);
    this.camera.rotation.set(this.pitch - 0.08, this.yaw, 0);
  }

  step(dt: number, input: FlightInput) {
    const A = this.auto;
    const { pos, vel, route } = this;
    this.time += dt;
    this.dist = this.distBase * input.zoom;

    // Look. Dragging suspends autofly's look control for a moment but not its movement.
    if (input.lookDX || input.lookDY) {
      this.yaw -= input.lookDX * YAW_PER_PX;
      this.pitch = clamp(this.pitch - input.lookDY * PITCH_PER_PX, -PITCH_LIMIT, PITCH_LIMIT);
      input.lookDX = input.lookDY = 0;
      A.lookHold = LOOK_HOLD;
      this.touched = true;
    }
    A.lookHold = Math.max(0, A.lookHold - dt);

    // Movement input overrides autofly until 12 s of quiet.
    const { forward: f, strafe: s, rise: u } = input;
    const moving = Math.abs(f) > 0.05 || Math.abs(s) > 0.05 || Math.abs(u) > 0.05;
    if (moving) {
      A.idle = 0;
      this.touched = true;
      if (A.enabled && !A.override) A.override = true;
    } else A.idle += dt;
    if (A.enabled && A.override && A.idle > RETURN_AFTER) {
      A.override = false;
      A.t = route.nearest(pos);
    }
    const active = A.enabled && !A.override;
    A.w = clamp(A.w + (active ? dt * 0.45 : -dt * 4), 0, 1);

    // Forward follows pitch: look up and press W to climb.
    this.fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.wish.set(0, 0, 0).addScaledVector(this.fwd, f).addScaledVector(this.right, s).addScaledVector(UP, u);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    this.wish.multiplyScalar(input.boost ? BOOST : CRUISE);

    // Autofly: chase a carrot that moves along the route, throttled when we lag.
    this.autoVel.set(0, 0, 0);
    if (A.w > 0.001) {
      const rs = route.speed(A.t);
      const carrot = route.point(A.t, this.tmpC);
      const lag = carrot.distanceTo(pos);
      if (active) A.t = (A.t + ((rs * dt) / route.rate(A.t)) * clamp(28 / Math.max(lag, 1), 0.15, 1)) % 1;
      const tan = route.point(A.t + 0.002, this.tmpD).sub(carrot).normalize();
      this.autoVel.copy(carrot).sub(pos).multiplyScalar(0.9).addScaledVector(tan, rs * 0.6);
      const ml = rs * 1.9;
      if (this.autoVel.length() > ml) this.autoVel.setLength(ml);
      if (A.lookHold <= 0) {
        const [ty, tp] = route.look(A.t, pos);
        const k = dampK(this.reduceMotion ? 0.8 : 1.5, dt) * A.w;
        this.yaw = angLerp(this.yaw, ty, k);
        this.pitch = lerp(this.pitch, tp, k);
      }
    }
    this.target.copy(this.wish).lerp(this.autoVel, A.w);
    vel.lerp(this.target, dampK(A.w > 0.5 ? 2.4 : 1.7, dt));
    pos.addScaledVector(vel, dt);

    // Soft world boundary, ceiling, and floating up over ground instead of colliding.
    const { softRadius, fogEnd, ceiling } = this.world.bounds;
    const r = Math.hypot(pos.x, pos.z);
    if (r > softRadius) {
      const k = (r - softRadius) * 0.6 * dt;
      vel.x -= (pos.x / r) * k * 4;
      vel.z -= (pos.z / r) * k * 4;
    }
    if (pos.y > ceiling) vel.y -= (pos.y - ceiling) * dt * 2;
    const minY = this.heights.ground(pos.x, pos.z) + CLEARANCE;
    if (pos.y < minY) {
      pos.y += (minY - pos.y) * dampK(6, dt);
      if (vel.y < 0) vel.y *= Math.exp(-dt * 6);
    }
    this.boundary = smoothstep(softRadius - 20, fogEnd, r);

    // Walls: phase on every crossing in or out of stone.
    const ins = insideColliders(this.colliders, pos);
    if (!!ins !== !!this.lastInside) {
      this.phase = 1;
      this.onPhase();
    }
    this.lastInside = ins;
    const h = this.hall;
    this.inside =
      !!ins || (pos.x > h.x0 && pos.x < h.x1 && pos.z > h.z0 && pos.z < h.z1 && pos.y > h.y0 && pos.y < h.y0 + h.wallH + h.ridge);
    this.where = ins === true ? 'stone' : this.inside ? 'hall' : '';
    this.phase = Math.max(0, this.phase - dt * 1.6);

    this.animateBody(dt);
    this.followCamera(dt);
  }

  private animateBody(dt: number) {
    const { vel } = this;
    const body = this.ghost.group;
    const sp = vel.length();
    const hv = Math.hypot(vel.x, vel.z);
    const targetGY = hv > 1.2 ? Math.atan2(vel.x, vel.z) : this.yaw + Math.PI;
    const prevGY = this.gyaw;
    this.gyaw = angLerp(this.gyaw, targetGY, dampK(3.2, dt));
    let yawRate = this.gyaw - prevGY;
    while (yawRate > Math.PI) yawRate -= Math.PI * 2;
    while (yawRate < -Math.PI) yawRate += Math.PI * 2;
    this.bankRoll = lerp(this.bankRoll, clamp((-yawRate / Math.max(dt, 1e-3)) * 0.35, -0.5, 0.5), dampK(3, dt));
    const bob = this.reduceMotion ? 0 : Math.sin(this.time * 1.7) * 0.35;
    body.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.ghostE.set(clamp(sp * 0.012, 0, 0.35) - clamp(vel.y * 0.02, -0.3, 0.3), this.gyaw, this.bankRoll);
    body.quaternion.setFromEuler(this.ghostE);
    const u = this.ghost.uniforms;
    u.uTime.value = this.time;
    // The skirt bends against velocity.
    this.tmpA.copy(vel).multiplyScalar(-0.022).applyQuaternion(this.ghostQ.copy(body.quaternion).invert()).clampLength(0, 0.5);
    u.uBend.value.lerp(this.tmpA, dampK(4, dt));
    u.uOpacity.value = lerp(u.uOpacity.value, this.dist < 5.5 ? 0.55 : 1, dampK(4, dt));

    // Wisps trail from the hem.
    const emitN = Math.min(6, Math.floor(dt * 70 + Math.random()));
    for (let i = 0; i < emitN; i++) {
      const a = Math.random() * 6.28;
      const rd = Math.random() * 1.2;
      this.trail.emit(
        body.position.x + Math.cos(a) * rd,
        body.position.y - 1.25 - Math.random() * 0.3,
        body.position.z + Math.sin(a) * rd,
        -vel.x * 0.12 + (Math.random() - 0.5),
        0.5 + Math.random() * 0.6,
        -vel.z * 0.12 + (Math.random() - 0.5),
        1.4 + Math.random() * 0.8,
      );
    }
    this.trail.update(dt, 0.8, (i, t, p) => {
      const a = (1 - t) * (t < 0.1 ? t * 10 : 1);
      p.col.set([0.4 * a, 0.55 * a, 0.85 * a, 0.55 * a], i * 4);
      p.size[i] = lerp(0.4, 1.6, t);
    });
  }

  /** Third person, behind and above; never below ground + 1 m. */
  private followCamera(dt: number) {
    const f = this.fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const want = this.tmpB.copy(this.ghost.group.position).addScaledVector(f, -this.dist).add(this.tmpC.set(0, 1.6 + this.dist * 0.18, 0));
    const floor = this.heights.ground(want.x, want.z) + 1.0;
    if (want.y < floor) want.y = floor;
    this.camPos.lerp(want, dampK(7, dt));
    this.camera.position.copy(this.camPos);
    this.camera.rotation.set(this.pitch - 0.08, this.yaw, 0);
  }
}
