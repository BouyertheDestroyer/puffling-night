import * as THREE from 'three';
import { Car, parkedCarGeometries, carMaterials } from './car.js';
import { Player } from './player.js';
import { Pufflings } from './puffling.js';
import { buildBox } from './box.js';
import { FollowCam } from './camera.js';
import { STAR_AT } from './ui.js';
import { clamp, damp, angleDiff, rng } from './noise.js';
import { height, shoreS } from './world/layout.js';

const PASSENGER = new THREE.Vector3(-0.38, 0.66, 0.02);

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // E, L, world, town, input, audio, ui, sky, ocean
    const { E, L, world } = this;
    this.scene = E.scene;
    this.placeParkedCars();
    this.car = new Car(this.scene, world, 0xb3261e);
    this.car.place(L.carStart.x, L.carStart.z, L.carStart.ang);
    world.extra.push(this.car);
    this.car.onCrash = v => this.audio.thump(Math.min(0.8, v * 0.08), 70, 0.3);
    this.player = new Player(this.scene, world, this.audio);
    const ds = this.car.doorSpot();
    this.player.place(ds.x, ds.z, this.car.heading + Math.PI / 2);
    // the box starts on the passenger seat
    this.box = buildBox(); this.boxCount = 0; this.boxWhere = 'car';
    this.putBoxInCar(true);
    this.pufflings = new Pufflings(this.scene, world, L, this.audio);
    this.pufflings.populate(this.player.pos);
    this.cam = new FollowCam(E.camera, world);
    this.cam.yaw = this.car.heading - 0.6; this.cam.pitch = 0.3;
    this.stars = 0; this.saved = 0;
    this.paused = false; this.overlay = null;
    this.time = 0;
    this.ui.setStars(0, 0); this.ui.setBox(0, 'car');
    this.lookout = L.lookout;
    this.perf = { acc: 0, n: 0, scale: E.renderer.getPixelRatio() };
  }

  // ----------------------------------------------------------------- parked cars
  placeParkedCars() {
    const { L, world } = this;
    const r = rng(555), list = [];
    for (const road of L.roads) {
      if (road.name === 'Vitavegur') continue;
      for (let i = 3; i < road.pts.length - 3; i++) {
        if (!r.chance(0.1)) continue;
        const p = road.pts[i], q = road.pts[i + 1];
        const ang = Math.atan2(q.z - p.z, q.x - p.x), side = r.chance(0.5) ? 1 : -1;
        const off = road.width / 2 - 1.05;
        const x = p.x - Math.sin(ang) * side * off, z = p.z + Math.cos(ang) * side * off;
        if (L.roadDist(x, z, 20, road).d < 6) continue;
        if (list.some(c => Math.hypot(c.x - x, c.z - z) < 7)) continue;
        if (Math.hypot(x - L.carStart.x, z - L.carStart.z) < 12) continue;
        if (world.blocked(x, z, 1.0)) continue;
        list.push({ x, z, h: ang + (r.chance(0.5) ? 0 : Math.PI), color: r.pick([0xe8e8e8, 0x1d2b44, 0x6e7478, 0x111111, 0x7a1f1f, 0x2f4a3a, 0xc8c2b0, 0x335d8a]) });
      }
    }
    L.parked = list;
    const G = parkedCarGeometries();
    const M = carMaterials(0xffffff);
    M.tail.emissiveIntensity = 0.1;
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    for (const k in G) {
      const im = new THREE.InstancedMesh(G[k], M[k], list.length);
      list.forEach((c, i) => {
        const fx = Math.cos(c.h), fz = Math.sin(c.h);
        const hf = height(c.x + fx * 1.3, c.z + fz * 1.3), hb = height(c.x - fx * 1.3, c.z - fz * 1.3);
        dummy.position.set(c.x, world.ground(c.x, c.z), c.z);
        dummy.rotation.set(0, 0, 0); dummy.rotation.order = 'YXZ';
        dummy.rotation.y = Math.PI / 2 - c.h; dummy.rotation.x = -Math.atan2(hf - hb, 2.6);
        dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
        if (k === 'paint') im.setColorAt(i, color.setHex(c.color));
      });
      im.castShadow = k !== 'glass'; im.receiveShadow = true;
      if (k === 'glass') im.renderOrder = 2;
      im.computeBoundingSphere();
      this.scene.add(im); (this.parkedMeshes ??= []).push(im);
    }
    // collision box: local x runs along the heading, so hw is half the length
    for (const c of list) this.town.addBox(c.x, c.z, 2.2, 0.92, c.h, { parked: true });
  }

  // ----------------------------------------------------------------- the box
  putBoxInCar(silent) {
    this.car.model.body.add(this.box.group);
    this.box.group.position.copy(PASSENGER); this.box.group.rotation.set(0, 0, 0);
    this.box.group.scale.setScalar(0.95);
    this.boxWhere = 'car';
    if (!silent) { this.audio.rustle(); this.ui.setBox(this.boxCount, 'car'); }
  }
  takeBox() {
    const c = this.player.person.carry;
    c.add(this.box.group);
    this.box.group.position.set(0, -0.2, 0.02); this.box.group.rotation.set(0, Math.PI / 2, 0); this.box.group.scale.setScalar(1);
    this.boxWhere = 'hands';
    this.audio.rustle(); this.ui.setBox(this.boxCount, 'hands');
  }

  // ----------------------------------------------------------------- per frame
  update(dt) {
    const { input, player, car, ui } = this;
    this.time += dt;
    input.pollPad();
    const pad = input.pad;
    // overlays
    if (input.hit('KeyH') || (pad && pad.hit('start'))) this.toggleOverlay('help');
    if (input.hit('KeyM', 'Tab') || (pad && pad.hit('back'))) this.toggleOverlay('map');
    if (input.hit('Escape')) { if (this.overlay) this.toggleOverlay(this.overlay); }
    if (this.overlay) { if (this.overlay === 'map') this.drawBigMap(); input.endFrame(); return; }

    // --- input
    const fwd = this.cam.flatForward(), right = { x: -fwd.z, z: fwd.x };
    let my = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']), mx = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    if (pad) { mx += pad.lx; my -= pad.ly; }
    const interact = input.hit('KeyE', 'Mouse0') || (pad && pad.hit('a'));
    const carKey = input.hit('KeyF', 'Enter') || (pad && pad.hit('y'));
    if (input.hit('KeyC') || (pad && pad.hit('rb'))) player.sneak = !player.sneak;

    let prompt = '';
    if (player.inCar) {
      // ---------------------------------- driving
      const thr = Math.max(input.down('KeyW', 'ArrowUp') ? 1 : 0, pad ? pad.rt : 0);
      const brk = Math.max(input.down('KeyS', 'ArrowDown') ? 1 : 0, pad ? pad.lt : 0);
      let steer = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']); if (pad) steer += pad.lx;
      const exiting = !!player.seq;
      car.update(dt, exiting ? { throttle: 0, brake: 0, steer: 0, handbrake: true } : { throttle: thr, brake: brk, steer: clamp(steer, -1, 1), handbrake: input.down('Space') || (pad && pad.now.b) });
      if (input.hit('KeyQ') || (pad && pad.hit('x'))) this.audio.horn();
      if (input.hit('KeyL')) car.setLights(!car.lightsOn);
      if (carKey && !exiting) {
        if (Math.abs(car.speed) < 4) player.exitCar(car, () => { car.engineOn = false; });
        else ui.toast('Slow down to get out', 1.5);
      }
      if (this.boxWhere === 'car' && this.boxCount > 0 && this.nearLookout(car.pos, 40)) prompt = 'Park here and take the box to the lookout';
    } else {
      car.update(dt, null);
      if (!player.seq) {
        const move = { x: fwd.x * my + right.x * mx, z: fwd.z * my + right.z * mx };
        player.updateOnFoot(dt, player.action ? { x: 0, z: 0 } : move, input.down('ShiftLeft', 'ShiftRight') || (pad && pad.now.lb), this.boxWhere === 'hands');
        if (!player.action) prompt = this.interactions(interact, carKey);
      }
    }
    player.updateSeq(dt);
    player.updateAction(dt);
    player.animate(dt, this.boxWhere === 'hands');
    this.pufflings.update(dt, player, car);
    this.nudgePufflingsFromCar();
    this.box.show(this.boxCount, this.time);

    // --- camera
    let target, heading, inCarView = player.inCar || (player.seq && player.seq.phase !== 'walk');
    if (inCarView) { target = car.pos.clone(); target.y += 1.5; heading = car.heading; }
    else { target = player.pos.clone(); target.y += 1.45; heading = player.heading; }
    this.cam.update(dt, { target, heading, inCar: inCarView, speed: car.speed, mdx: input.mdx, mdy: input.mdy, padX: pad ? pad.rx : 0, padY: pad ? pad.ry : 0, now: performance.now() });

    // --- world systems
    const focus = inCarView ? car.pos : player.pos;
    this.E.followShadow(focus);
    this.E.updateLampPool(this.E.camera.position);
    car.engineOn = player.inCar;
    const camF = new THREE.Vector3(); this.E.camera.getWorldDirection(camF);
    const s = shoreS(this.E.camera.position.x, this.E.camera.position.z);
    this.audio.update(dt, {
      listener: { position: this.E.camera.position, forward: camF },
      seaNear: clamp(1 - s / 90, 0, 1), engine: player.inCar, rpm: clamp(Math.abs(car.speed) / 33, 0, 1) * 0.8 + 0.15,
      throttle: player.inCar && input.down('KeyW', 'ArrowUp') ? 1 : 0,
      skid: player.inCar ? Math.abs(car.vel.dot(new THREE.Vector2(-car.forward.y, car.forward.x))) - 2 : 0,
      windBoost: this.nearLookout(focus, 60) ? 0.05 : 0,
    });
    ui.prompt(prompt);
    ui.drawMinimap(player.inCar ? car.pos : player.pos, player.inCar ? null : car.pos, this.cam.yaw, this.pufflings.active(), this.lookout, this.boxWhere === 'car' ? null : null);
    ui.update(dt);
    input.endFrame();
  }
  nearLookout(p, d = 7) { return Math.hypot(p.x - this.lookout.x, p.z - this.lookout.z) < d; }

  interactions(interact, carKey) {
    const { player, car, pufflings, ui } = this;
    const P = player.pos;
    const holding = this.boxWhere === 'hands';
    const nearCar = Math.hypot(P.x - car.pos.x, P.z - car.pos.z) < 3.4;
    const lines = [];
    // throw from the lookout
    if (holding && this.nearLookout(P, 7.5)) {
      if (this.boxCount > 0) {
        lines.push('E  Throw a puffling out to sea');
        if (interact) { this.throwOne(); return ''; }
      } else lines.push('The box is empty. Find more pufflings in town');
    } else {
      const p = pufflings.nearestCatchable(P.x, P.z, holding ? 1.7 : 2.6);
      if (p) {
        if (!holding) lines.push(this.boxWhere === 'car' ? 'You need the box. It\'s in the car' : '');
        else if (this.boxCount >= this.box.capacity) lines.push('The box is full. Take them to the cliff');
        else {
          lines.push('E  Catch the puffling');
          if (interact) { this.catchOne(p); return ''; }
        }
      } else if (nearCar) {
        if (holding) {
          lines.push('E  Put the box in the car');
          if (interact) { this.putBoxInCar(); return ''; }
        } else if (this.boxWhere === 'car') {
          lines.push('E  Take the box');
          if (interact) { this.takeBox(); return ''; }
        }
      }
    }
    if (nearCar || Math.hypot(P.x - car.doorSpot().x, P.z - car.doorSpot().z) < 3.5) {
      lines.push('F  Get in' + (holding ? ' (the box comes too)' : ''));
      if (carKey) {
        if (holding) this.putBoxInCar();
        player.enterCar(car, () => { car.engineOn = true; this.audio.thump(0.2, 60, 0.05); });
        return '';
      }
    }
    return lines.filter(Boolean).join('   ·   ');
  }
  catchOne(p) {
    const { player } = this;
    p.state = 'idle'; p.timer = 5; // it freezes for a moment
    player.heading = Math.atan2(p.pos.z - player.pos.z, p.pos.x - player.pos.x);
    player.startAction('grab', 0.85, 0.5, () => {
      if (!['idle', 'waddle', 'flee'].includes(p.state)) return;
      if (Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z) > 2.2) return;
      this.pufflings.catch(p);
      this.boxCount++; this.audio.rustle();
      this.ui.setBox(this.boxCount, 'hands');
      if (this.boxCount === 1 && !this.toldCliff) { this.toldCliff = true; this.ui.toast('Got one! Catch a few more, then take them to the cliff', 3.5); }
    });
  }
  throwOne() {
    const { player, lookout } = this;
    player.heading = Math.atan2(lookout.seaDir.z, lookout.seaDir.x);
    player.startAction('throw', 1.0, 0.62, () => {
      const p = this.pufflings.list.find(q => q.state === 'caught');
      if (!p) return;
      const hand = new THREE.Vector3(); player.person.J.handR.getWorldPosition(hand);
      this.pufflings.throw(p, hand, lookout.seaDir);
      this.audio.whoosh(); this.audio.flutter(hand);
      this.boxCount--; this.saved++;
      this.ui.setBox(this.boxCount, 'hands');
      this.onSaved();
    });
  }
  onSaved() {
    const s = STAR_AT.filter(n => this.saved >= n).length;
    this.ui.setStars(s, this.saved);
    if (s > this.stars) {
      this.stars = s;
      this.audio.chime(s); this.ui.starBurst();
      const words = ['', 'One star', 'Two stars', 'Three stars', 'Four stars', 'Five stars'];
      this.ui.toast(`${'★'.repeat(s)}<br>${words[s]}` + (s === 5 ? '<br><small>The colony thanks you. Keep going as long as you like.</small>' : ''), 4);
    } else this.ui.toast('Away it goes!', 1.4);
  }
  nudgePufflingsFromCar() {
    const car = this.car;
    for (const p of this.pufflings.list) {
      if (!['idle', 'waddle', 'flee'].includes(p.state)) continue;
      for (const c of car.circles()) {
        const dx = p.pos.x - c.x, dz = p.pos.z - c.z, d = Math.hypot(dx, dz);
        if (d < c.r + 0.15 && d > 1e-3 && Math.abs(car.speed) > 0.3) { p.pos.x += dx / d * (c.r + 0.15 - d); p.pos.z += dz / d * (c.r + 0.15 - d); p.state = 'flee'; p.fleeT = 1; }
      }
    }
  }
  toggleOverlay(name) {
    const was = this.overlay;
    for (const n of ['help', 'map', 'pause']) this.ui.$(n === 'map' ? 'mapScreen' : n).hidden = true;
    this.overlay = was === name ? null : name;
    if (this.overlay) { this.ui.$(this.overlay === 'map' ? 'mapScreen' : this.overlay).hidden = false; this.input.unlock(); }
    if (this.overlay === 'map') this.drawBigMap();
  }
  drawBigMap() {
    const { player, car } = this;
    this.ui.drawBigMap(player.inCar ? car.pos : player.pos, player.inCar ? car.heading : player.heading, car.pos, this.lookout, this.pufflings.active());
  }
}
