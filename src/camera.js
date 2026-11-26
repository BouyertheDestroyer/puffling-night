import * as THREE from 'three';
import { clamp, damp, angleDiff, lerp } from './noise.js';

// Third-person orbit camera that follows the player or the car.
export class FollowCam {
  constructor(camera, world) {
    this.cam = camera; this.world = world;
    this.yaw = 0; this.pitch = 0.25; this.dist = 4.2; this.targetDist = 4.2;
    this.target = new THREE.Vector3(); this.smoothTarget = new THREE.Vector3();
    this.lastInput = 0; this.fov = 60; this.init = false;
  }
  // yaw: angle of the camera's forward direction, same convention as headings (forward = cos,sin)
  update(dt, { target, heading, inCar, speed = 0, mdx = 0, mdy = 0, padX = 0, padY = 0, now }) {
    if (!this.init) { this.smoothTarget.copy(target); this.yaw = heading; this.init = true; }
    const sens = 0.0023;
    this.yaw += mdx * sens + padX * 2.6 * dt;
    this.pitch = clamp(this.pitch + mdy * sens + padY * 1.8 * dt, -0.35, 1.2);
    if (mdx || mdy || padX || padY) this.lastInput = now;
    // in the car, swing back behind it when the player isn't steering the camera
    if (inCar && now - this.lastInput > 1200 && Math.abs(speed) > 1) {
      const behind = speed >= 0 ? heading : heading + Math.PI;
      this.yaw += angleDiff(this.yaw, behind) * (1 - Math.exp(-2.5 * dt));
      this.pitch = damp(this.pitch, 0.22, 1.5, dt);
    }
    this.targetDist = inCar ? 7.2 + Math.min(Math.abs(speed) * 0.06, 1.5) : 4.0;
    this.dist = damp(this.dist, this.targetDist, 3, dt);
    this.smoothTarget.x = damp(this.smoothTarget.x, target.x, inCar ? 12 : 16, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, target.z, inCar ? 12 : 16, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, target.y, 8, dt);
    const T = this.smoothTarget;
    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(-Math.cos(this.yaw) * cp, Math.sin(this.pitch), -Math.sin(this.yaw) * cp);
    // pull in if a wall or the ground is in the way
    let d = this.dist;
    for (let s = 0.6; s <= this.dist; s += 0.3) {
      const p = T.clone().addScaledVector(dir, s);
      if (this.world.blocked(p.x, p.z, 0.2, { static: true, boxesOnly: true, above: p.y - this.world.ground(p.x, p.z) })) { d = Math.max(0.6, s - 0.4); break; }
      if (p.y < this.world.ground(p.x, p.z) + 0.3) { d = Math.max(0.6, s - 0.2); break; }
    }
    this.curD = damp(this.curD ?? d, d, d < (this.curD ?? d) ? 30 : 4, dt);
    const pos = T.clone().addScaledVector(dir, this.curD);
    pos.y = Math.max(pos.y, this.world.ground(pos.x, pos.z) + 0.3);
    this.cam.position.copy(pos);
    // look slightly above the target so the horizon shows
    this.cam.lookAt(T.x, T.y + (inCar ? 0.3 : 0.15), T.z);
    const fov = inCar ? 60 + Math.min(Math.abs(speed) * 0.35, 12) : 60;
    this.fov = damp(this.fov, fov, 3, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
  roofAt() { return 1e9; } // buildings are tall enough; treat as solid
  // forward on the ground plane for movement input
  flatForward() { return { x: Math.cos(this.yaw), z: Math.sin(this.yaw) }; }
}
