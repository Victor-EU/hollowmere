import type { Point3 } from './zones';

export interface ListenerState {
  /** Ghost world position. */
  position: Point3;
  /** Facing, radians; forward vector is (-sin(yaw), 0, -cos(yaw)). */
  yaw: number;
}

export type AudioEventType = 'roar' | 'whoosh' | 'caw' | 'wingbeat' | 'sigh' | 'chitter' | 'grind' | 'creak';
