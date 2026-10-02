import * as THREE from 'three';
import type { WorldData } from '../data';
import { clamp, dampK, lerp, range, rng, smoothstep } from '../world/math';
import { WARM_DECAY } from '../world/lights';
import type { Materials } from '../world/materials';
import { Pool } from './sprites';
import type { LifeContext, Living } from './types';

/**
 * The wyrm: an original serpentine dragon of ~46 instanced segments circling the keep, with
 * back spikes, a horned head with a hinged jaw and bat-like wings. Breathes fire along its path
 * for 2.4 s every 8-13 s; the only big warm event in the sky.
 */
export function makeWyrm(world: WorldData, M: Materials, ctx: LifeContext): Living {
  const rand = rng(6060);
  const cfg = world.life.wyrm;
  const N = cfg.segments;
  const [cx, cy, cz] = cfg.center;
  const group = new THREE.Group();
  group.name = 'wyrm';

  const hide = new THREE.MeshStandardMaterial({ name: 'wyrm', color: new THREE.Color('#3a2a20'), roughness: 0.55, metalness: 0.3, emissive: new THREE.Color('#200a04'), emissiveIntensity: 1 });
  const body = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), hide, N);
  const spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.32, 1.6, 5), M.iron, N);
  body.frustumCulled = spikes.frustumCulled = false;
  group.add(body, spikes);

  const head = new THREE.Group();
  group.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), hide);
  skull.scale.set(1.1, 0.9, 1.3);
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.15, 3.8, 8), hide);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, 0.15, 2.5);
  head.add(snout);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.55, 0.6);
  head.add(jaw);
  const jawMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 3.4, 8), hide);
  jawMesh.rotation.x = Math.PI / 2;
  jawMesh.position.set(0, 0, 1.9);
  jaw.add(jawMesh);
  const eyeMat = new THREE.MeshBasicMaterial({ name: 'wyrm-eye', color: new THREE.Color(4, 2.4, 0.4), fog: false });
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.32, 3.4, 6), M.iron);
    h.position.set(sx * 0.75, 1.0, -0.9);
    h.rotation.set(-2.2, 0, sx * 0.25);
    head.add(h);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), eyeMat);
    e.position.set(sx * 0.78, 0.5, 1.0);
    head.add(e);
  }

  const wingShape = new THREE.Shape();
  [[0, 1.6], [5, 3.2], [11, 2.6], [20, -0.8], [16, -3.2], [13.5, -2.0], [11, -5.4], [7.5, -3.4], [4.2, -6], [0, -3.6]].forEach(([x, z], i) =>
    i ? wingShape.lineTo(x, -z) : wingShape.moveTo(x, -z),
  );
  const wg = new THREE.ShapeGeometry(wingShape);
  wg.rotateX(-Math.PI / 2);
  const wingMat = new THREE.MeshStandardMaterial({ name: 'wyrm-wing', color: new THREE.Color('#3d1d14'), emissive: new THREE.Color('#180503'), roughness: 0.7, side: THREE.DoubleSide });
  const wings = new THREE.Group();
  const wr = new THREE.Group();
  const wl = new THREE.Group();
  wings.add(wr, wl);
  wr.add(new THREE.Mesh(wg, wingMat));
  const lm = new THREE.Mesh(wg, wingMat);
  lm.scale.x = -1;
  wl.add(lm);
  group.add(wings);

  const fire = new Pool(420);
  group.add(fire.points);
  // Peak 5 over 150 m in the mockup's legacy units, converted as in world/lights.ts.
  const FIRE_PEAK = 352;
  const fireLight = new THREE.PointLight(new THREE.Color('#ff6a1a'), 0, 150, WARM_DECAY);
  group.add(fireLight);

  const radius = (i: number) =>
    i < 4 ? 1.3 + 0.15 * i : i < 12 ? lerp(1.9, 2.6, (i - 4) / 8) : lerp(2.6, 0.25, Math.pow((i - 12) / (N - 13), 0.85));
  const path = (th: number, out: THREE.Vector3) => {
    const R = cfg.radius + 9 * Math.sin(2 * th + 0.6);
    return out.set(cx + R * Math.cos(th), cy + 9 * Math.sin(1.5 * th) + 4 * Math.sin(3.7 * th), cz + R * Math.sin(th));
  };

  let theta = 2.2;
  let breath = 0;
  let nextBreath = 6;
  let roared = false;
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const o = new THREE.Object3D();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tA = new THREE.Vector3();
  const tB = new THREE.Vector3();
  const tC = new THREE.Vector3();

  return {
    object: group,
    update(dt, time) {
      theta += dt * 0.15;
      for (let i = 0; i < N; i++) {
        const th = theta - (i * 1.75) / 56;
        path(th, p);
        path(th + 0.01, q);
        const tang = q.sub(p).normalize();
        side.crossVectors(tang, up).normalize();
        p.addScaledVector(side, Math.sin(i * 0.33 - time * 2.6) * 1.3 * (i / N));
        p.y += Math.sin(i * 0.25 - time * 2.0) * 0.8 * (i / N);
        const r = radius(i);
        o.position.copy(p);
        o.lookAt(tA.copy(p).add(tang));
        o.scale.set(r, r * 0.9, r * 1.25);
        o.updateMatrix();
        body.setMatrixAt(i, o.matrix);
        if (i >= 2 && i < 38) {
          const sd = tB.copy(up).addScaledVector(tang, -0.6).normalize();
          o.position.copy(p).addScaledVector(up, r * 0.85);
          o.quaternion.setFromUnitVectors(tC.set(0, 1, 0), sd);
          o.scale.setScalar(clamp(r * 0.7, 0.3, 1.6));
        } else o.scale.setScalar(0);
        o.updateMatrix();
        spikes.setMatrixAt(i, o.matrix);
        if (i === 0) {
          head.position.copy(p).addScaledVector(tang, 1.2);
          head.lookAt(tA.copy(head.position).add(tang));
        }
        if (i === 9) {
          wings.position.copy(p).addScaledVector(up, r * 0.7);
          wings.lookAt(tA.copy(wings.position).add(tang));
        }
      }
      body.instanceMatrix.needsUpdate = spikes.instanceMatrix.needsUpdate = true;
      const flap = Math.sin(time * 2.2) * 0.6 + 0.12;
      wr.rotation.z = flap;
      wl.rotation.z = -flap;

      // Fire, always aimed along the path, never at the player.
      nextBreath -= dt;
      if (nextBreath <= 0 && breath <= 0) {
        breath = 2.4;
        nextBreath = range(rand, 8, 13);
        roared = false;
      }
      let open = 0.08;
      if (breath > 0) {
        breath -= dt;
        open = 0.55;
        head.updateMatrixWorld();
        if (!roared) {
          roared = true;
          ctx.sound('roar', head.position);
        }
        const mouth = head.localToWorld(tA.set(0, -0.3, 4.6));
        const fwd = tB.set(0, -0.12, 1).normalize().applyQuaternion(head.quaternion);
        const n = Math.floor(dt * 180 + Math.random());
        for (let k = 0; k < n; k++) {
          fire.emit(mouth.x, mouth.y, mouth.z, fwd.x * 30 + (Math.random() - 0.5) * 7, fwd.y * 30 + (Math.random() - 0.5) * 7 - 2, fwd.z * 30 + (Math.random() - 0.5) * 7, 1.0 + Math.random() * 0.6);
        }
        fireLight.position.copy(mouth).addScaledVector(fwd, 8);
        // ~2 Hz flicker: the design doc caps flashing at 3 Hz (the mockup ran at 6 Hz).
        fireLight.intensity = lerp(fireLight.intensity, FIRE_PEAK * (1 + Math.sin(time * 13) * 0.24), dampK(10, dt));
      } else fireLight.intensity = lerp(fireLight.intensity, 0, dampK(4, dt));
      jaw.rotation.x = lerp(jaw.rotation.x, open, dampK(8, dt));
      fire.update(dt, 1.3, (i, t, pl) => {
        const fade = 1 - smoothstep(0.55, 1, t);
        let r: number;
        let g: number;
        let b: number;
        if (t < 0.15) {
          r = 4;
          g = 3;
          b = 1.4;
        } else if (t < 0.5) {
          const k = (t - 0.15) / 0.35;
          r = lerp(4, 3, k);
          g = lerp(3, 0.9, k);
          b = lerp(1.4, 0.15, k);
        } else {
          const k = (t - 0.5) / 0.5;
          r = lerp(3, 0.5, k);
          g = lerp(0.9, 0.1, k);
          b = lerp(0.15, 0.03, k);
        }
        pl.col.set([r * fade, g * fade, b * fade, fade], i * 4);
        pl.size[i] = lerp(1.6, 9, Math.sqrt(t));
        pl.vel[i * 3 + 1] += 3 * dt;
      });
    },
  };
}
