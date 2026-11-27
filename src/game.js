import * as THREE from 'three';
import { Car, parkedCarGeometries, carMaterials, collideCars } from './car.js';
import { Player } from './player.js';
import { Pufflings } from './puffling.js';
import { Box } from './box.js';
import { FollowCam } from './camera.js';
import { STAR_AT } from './ui.js';
import { People } from './people.js';
import { Traffic } from './traffic.js';
import { Voices } from './voice.js';
import { Splashes } from './effects.js';
import { clamp, rng } from './noise.js';
import { height, shoreS } from './world/layout.js';

const PLAYER_VOICE = { pitch: 1.0, rate: 1.05, voice: 0 };
const POLICE_VOICE = { pitch: 0.75, rate: 0.95, voice: 1 };
const ON_GROUND = ['idle', 'waddle', 'flee'];

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // E, L, world, town, input, audio, ui, sky, ocean
    const { E, L, world } = this;
    this.scene = E.scene;
    this.placeParkedCars();
    this.voices = new Voices(this.audio);
    this.cars = []; this.boxes = [];
    this.car = this.addCar(0xb3261e, L.carStart.x, L.carStart.z, L.carStart.ang, true);
    this.car.enableShadows();
    this.player = new Player(this.scene, world, this.audio);
    const ds = this.car.doorSpot();
    this.player.place(ds.x, ds.z, this.car.heading + Math.PI / 2);
    // the box starts on the passenger seat
    this.held = null;
    this.newBox().toCar(this.car);
    this.pufflings = new Pufflings(this.scene, world, L, this.audio);
    this.pufflings.populate(this.player.pos);
    this.people = new People(this);
    this.traffic = new Traffic(this);
    this.people.populate(); this.traffic.populate();
    this.splashes = new Splashes(this.scene);
    this.cam = new FollowCam(E.camera, world);
    this.cam.yaw = this.car.heading - 0.6; this.cam.pitch = 0.3;
    this.stars = 0; this.saved = 0;
    this.paused = false; this.overlay = null;
    this.time = 0; this.jailed = null; this.jail = this.town.jail; this.arrests = 0; this.fade = 0;
    this.ui.setStars(0, 0); this.updateBoxUI();
    this.lookout = L.lookout;
    this.perf = { acc: 0, n: 0, scale: E.renderer.getPixelRatio() };
  }
  focus() { return this.player.inCar ? this.car.pos : this.player.pos; }
  // where your box is, and how many are in it (used by the tests)
  get boxWhere() { return this.held ? 'hands' : this.car.box ? 'car' : null; }
  get boxCount() { return (this.held || this.car.box)?.count ?? 0; }

  // ----------------------------------------------------------------- cars and boxes
  addCar(color, x, z, h, withLights = false) {
    const c = new Car(this.scene, this.world, color, withLights);
    c.place(x, z, h);
    c.onCrash = v => { if (c.pos.distanceTo(this.E.camera.position) < 60) this.audio.crunch(v); };
    this.cars.push(c); this.world.extra.push(c);
    return c;
  }
  removeCar(c) {
    const i = this.cars.indexOf(c); if (i < 0) return;
    if (c.box) this.removeBox(c.box);
    if (c.driver) { this.people.remove(c.driver); c.driver = null; }
    if (c.ai) { const j = this.traffic.list.indexOf(c.ai); if (j >= 0) this.traffic.list.splice(j, 1); c.ai = null; }
    this.cars.splice(i, 1);
    const k = this.world.extra.indexOf(c); if (k >= 0) this.world.extra.splice(k, 1);
    c.dispose();
  }
  newBox() { const b = new Box(this.scene, this.world); this.boxes.push(b); return b; }
  removeBox(b) { b.dispose(); const i = this.boxes.indexOf(b); if (i >= 0) this.boxes.splice(i, 1); if (this.held === b) this.held = null; }
  takeBox(b) { b.toHands(this.player); this.held = b; this.audio.rustle(); this.updateBoxUI(); }
  putBoxInCar(c) { this.held.toCar(c); this.held = null; this.audio.rustle(); this.updateBoxUI(); }
  dropBox() {
    if (!this.held) return;
    const P = this.player, b = this.held; this.held = null;
    this.dropBoxAt(b, P.pos, P.heading);
    this.updateBoxUI();
  }
  // put a box down in front of someone; over the sea its pufflings swim off and the box drifts away
  dropBoxAt(b, pos, heading) {
    const W = this.world;
    let x = pos.x + Math.cos(heading) * 0.6, z = pos.z + Math.sin(heading) * 0.6;
    if (W.ground(x, z) < 0.2) { x = pos.x; z = pos.z; }
    if (W.ground(x, z) < 0.2) { this.freeBox(b, pos); this.removeBox(b); return; }
    b.toGround(x, z);
  }
  // move pufflings from one box into another
  tipInto(from, to) {
    const n = Math.min(from.count, to.room);
    from.count -= n; to.count += n;
    if (n) this.audio.rustle();
    this.updateBoxUI();
    return n;
  }
  updateBoxUI() {
    const b = this.held || (this.player?.inCar ? this.car.box : null);
    if (b) this.ui.setBox(b.count, this.held ? 'hands' : 'car');
    else if (this.car?.box) this.ui.setBox(this.car.box.count, 'car');
    else this.ui.setBox(null);
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
    for (const c of list) this.town.addBox(c.x, c.z, 2.2, 0.92, c.h, { parked: true, top: 1.45 });
  }

  // ----------------------------------------------------------------- per frame
  update(dt) {
    const { input, player, ui } = this;
    this.time += dt;
    input.pollPad();
    const pad = input.pad;
    // overlays
    if (input.hit('KeyH') || (pad && pad.hit('start'))) this.toggleOverlay('help');
    if (input.hit('KeyM', 'Tab') || (pad && pad.hit('back'))) this.toggleOverlay('map');
    if (input.hit('Escape')) { if (this.overlay) this.toggleOverlay(this.overlay); }
    if (this.overlay) {
      if (this.overlay === 'map') this.drawBigMap();
      this.audio.update(dt, { engine: false, skid: 0, seaNear: 0, throttle: 0, rpm: 0 }); // hush while paused
      input.endFrame(); return;
    }

    // --- input
    const fwd = this.cam.flatForward(), right = { x: -fwd.z, z: fwd.x };
    let my = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']), mx = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    if (pad) { mx += pad.lx; my -= pad.ly; }
    mx += input.stick.x; my -= input.stick.y;
    const interact = input.hit('KeyE') || (pad && pad.hit('a'));
    const carKey = input.hit('KeyF', 'Enter') || (pad && pad.hit('y'));
    const attackKey = input.hit('Mouse0', 'KeyR') || (pad && pad.hit('x'));
    const jumpKey = input.hit('Space') || (pad && pad.hit('b'));
    if (input.hit('KeyC') || (pad && pad.hit('rb'))) player.sneak = !player.sneak;
    ui.setTouchMode(player.inCar ? 'car' : 'foot');

    let prompt = '';
    const car = this.car;
    if (player.inCar) {
      // ---------------------------------- driving
      const thr = Math.max(input.down('KeyW', 'ArrowUp') ? 1 : 0, pad ? pad.rt : 0, -input.stick.y);
      const brk = Math.max(input.down('KeyS', 'ArrowDown') ? 1 : 0, pad ? pad.lt : 0, input.stick.y);
      let steer = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) + input.stick.x; if (pad) steer += pad.lx;
      const exiting = !!player.seq;
      car.update(dt, exiting ? { handbrake: true, parked: Math.abs(car.speed) < 1 } : { throttle: thr, brake: brk, steer: clamp(steer, -1, 1), handbrake: input.down('Space') || (pad && pad.now.b) });
      if (input.hit('KeyQ') || (pad && pad.hit('x'))) this.audio.horn();
      if (input.hit('KeyL')) car.setLights(!car.lightsOn);
      const stuck = car.upright < 0.5 && car.v.length() < 2;
      if (stuck) prompt = 'R  Put the car back on its wheels   ·   F  Get out';
      if (stuck && input.hit('KeyR')) car.rightUp();
      if (carKey && !exiting) {
        if (Math.abs(car.speed) < 4 || stuck) player.exitCar(car, () => { car.engineOn = false; });
        else { player.bailOut(car); car.engineOn = false; this.say(player, 'ouch', 1, PLAYER_VOICE); }
      }
      if (!prompt && car.box?.count > 0 && this.nearLookout(car.pos, 40)) prompt = 'Park here and take the box to the lookout';
      // in the sea: get out and swim for it
      if (player.inCar && car.inWater > 1.6 && !exiting) {
        player.detachFromCar(car); car.engineOn = false;
        ui.toast('Swim for it!', 2.5);
      }
    } else if (!player.seq) {
      if (player.ko) {
        const ev = player.updateKO(dt);
        if (ev?.splash) this.onSplash(player.pos, ev.splash);
        player.sync();
      } else {
        const move = { x: fwd.x * my + right.x * mx, z: fwd.z * my + right.z * mx };
        if (jumpKey && !player.action) player.jump(this.held ? 5.2 : 6.4);
        const ev = player.updateOnFoot(dt, move, input.down('ShiftLeft', 'ShiftRight') || (pad && pad.now.lb), !!this.held);
        if (ev.splash) this.onSplash(player.pos, ev.splash);
        if (ev.landed > 14) { // a long drop
          player.knockDown(Math.cos(player.heading) * 1.5, Math.sin(player.heading) * 1.5, 1, 1.8);
          this.say(player, 'ouch', 2, PLAYER_VOICE); this.audio.punch(true); this.dropBox();
        }
        if (attackKey && !player.action && !player.swimming && !player.ko && !this.jailed) {
          if (this.held) ui.toast('Your hands are full. G puts the box down', 1.8);
          else player.attack(() => this.resolveHit());
        }
        if ((input.hit('KeyQ') || (pad && (pad.hit('dl') || pad.hit('dr')))) && player.hasKnife) {
          player.setWeapon(player.weapon === 'knife' ? 'fists' : 'knife'); ui.setWeapon(player.weapon);
        }
        if (input.hit('KeyG') && this.held && !player.action && !player.swimming) { this.dropBox(); this.audio.rustle(); }
        if (player.swimming) {
          if (this.held?.count > 0) this.freeBox(this.held, player.pos);
          prompt = 'R  Swim ashore';
          if (input.hit('KeyR')) this.swimAshore();
        } else if (!player.action && !this.jailed) prompt = this.interactions(interact, carKey);
      }
    }
    // --- the rest of the world
    for (const c of this.cars) {
      if (c.ai || (c === car && player.inCar)) continue;
      const rolling = c.v.length() > 1.2 || c.contacts < 3;
      c.update(dt, rolling && !(c === car && player.seq) ? {} : { handbrake: true, parked: true });
    }
    this.traffic.update(dt);
    for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
      const a = this.cars[i], b = this.cars[j], v = collideCars(a, b);
      if (v > 2) this.onCarsHit(a, b, v);
    }
    this.carHits();
    this.seaAndCars(dt);
    player.updateSeq(dt);
    player.updateAction(dt);
    player.animate(dt, !!this.held);
    this.people.update(dt);
    this.pufflings.update(dt, player, this.cars, this.car);
    this.pufflingHits();
    for (const b of this.boxes) b.show(this.time);
    this.splashes.update(dt);
    this.updateJail(dt);
    this.cleanUp(dt);

    // --- camera
    const pc = this.car;
    let target, heading, inCarView = player.inCar || (player.seq && player.seq.phase !== 'walk');
    if (inCarView) { target = (player.seq?.car || pc).pos.clone(); target.y += 1.5; heading = (player.seq?.car || pc).heading; }
    else { target = player.pos.clone(); target.y += player.swimming ? 0.6 : player.ko ? 0.6 : 1.45; heading = player.heading; }
    this.cam.update(dt, { target, heading, inCar: inCarView, speed: pc.speed, mdx: input.mdx, mdy: input.mdy, padX: pad ? pad.rx : 0, padY: pad ? pad.ry : 0, now: performance.now() });
    if (window.__camOverride) { const o = window.__camOverride; this.E.camera.position.set(...o.pos); this.E.camera.lookAt(...o.look); }

    // --- world systems
    const focus = this.focus();
    this.E.followShadow(focus);
    this.E.updateLampPool(this.E.camera.position);
    pc.engineOn = player.inCar;
    const camF = new THREE.Vector3(); this.E.camera.getWorldDirection(camF);
    const s = shoreS(this.E.camera.position.x, this.E.camera.position.z);
    const lat = Math.abs(pc.vel.x * -Math.sin(pc.heading) + pc.vel.y * Math.cos(pc.heading));
    this.audio.update(dt, {
      listener: { position: this.E.camera.position, forward: camF },
      seaNear: clamp(1 - s / 90, 0, 1), engine: player.inCar, rpm: clamp(Math.abs(pc.speed) / 33, 0, 1) * 0.8 + 0.15,
      throttle: player.inCar && input.down('KeyW', 'ArrowUp') ? 1 : 0,
      skid: player.inCar && pc.contacts >= 2 ? Math.max(0, lat - 2) : 0,
      windBoost: this.nearLookout(focus, 60) ? 0.05 : 0,
    });
    if (this.jailed) prompt = `In the cells: out in ${Math.ceil(this.jailed.t)}`;
    ui.prompt(prompt);
    ui.drawMinimap(focus, player.inCar ? null : pc.pos, this.cam.yaw, this.pufflings.active(), this.lookout, this.mapMarks());
    ui.update(dt);
    if (this.fade > 0) { this.fade = Math.max(0, this.fade - dt); this.E.grade.uniforms.uFade.value = Math.min(1, this.fade / 0.5); }
    input.endFrame();
  }
  nearLookout(p, d = 7) { return Math.hypot(p.x - this.lookout.x, p.z - this.lookout.z) < d; }
  mapMarks() {
    const out = [];
    for (const b of this.boxes) {
      if (b === this.held || b.count === 0 || (b.where === 'car' && b.holder === this.car)) continue;
      const p = b.worldPos(); out.push({ x: p.x, z: p.z, r: 3.5, col: '#e8a04a' });
    }
    for (const n of this.people.list) if (n.kind === 'zombie' && n.state !== 'sink') out.push({ x: n.pos.x, z: n.pos.z, r: 2.6, col: '#7fc6ff' });
    if (this.jail) out.push({ x: this.jail.x, z: this.jail.z, r: 3.5, col: '#4a6aff', label: 'Police' });
    return out;
  }
  say(who, kind, prio = 1, voice) {
    const d = who.pos.distanceTo(this.E.camera.position);
    const t = this.voices.say(kind, voice || who.voice, d, prio);
    this.ui.say(t);
  }

  // ----------------------------------------------------------------- on foot: what E and F do
  interactions(interact, carKey) {
    const { player, pufflings, people } = this;
    const P = player.pos;
    const holding = this.held;
    // E goes to the first thing that can use it; notes only explain why nothing can
    const actions = [], notes = [];
    const kn = this.L.knife;
    if (kn && !player.hasKnife && Math.hypot(P.x - kn.x, P.z - kn.z) < 1.9) {
      actions.push(['E  Take the fishing knife', () => {
        player.hasKnife = true; player.setWeapon('knife'); kn.mesh.visible = false; this.ui.setWeapon('knife');
        this.ui.toast('A fishing knife<br><small>Q switches between fists and the knife. Not for pufflings.</small>', 4);
      }]);
    }
    if (holding && this.nearLookout(P, 7.5)) {
      if (holding.count > 0) actions.push(['E  Throw a puffling out to sea', () => this.throwOne()]);
      else notes.push('The box is empty. Find more pufflings in town');
    }
    const p = pufflings.nearestCatchable(P.x, P.z, holding ? 1.7 : 2.6);
    if (p) {
      if (!holding) notes.push('You need a box to put it in');
      else if (holding.room <= 0) notes.push('The box is full. Take them to the cliff');
      else actions.push(['E  Catch the puffling', () => this.catchOne(p)]);
    }
    // someone else's pufflings
    const pp = people.pickpocketTarget(P);
    if (pp && pp.n.box.count > 0) {
      if (!pp.behind) notes.push('Sneak up behind them to pinch their pufflings');
      else if (holding) { if (holding.room > 0) actions.push(['E  Pinch their pufflings', () => this.pinch(pp.n)]); }
      else actions.push(['E  Nick their box', () => this.pinch(pp.n)]);
    }
    // boxes on the ground
    const gb = this.boxes.filter(b => b.where === 'ground').map(b => ({ b, d: b.worldPos().distanceTo(P) })).filter(o => o.d < 1.6).sort((a, b) => a.d - b.d)[0]?.b;
    if (gb) {
      if (!holding) actions.push(['E  Pick up the box', () => this.takeBox(gb)]);
      else if (gb.count > 0 && holding.room > 0) actions.push(['E  Tip those pufflings into your box', () => this.tipInto(gb, holding)]);
    }
    // the nearest car
    const c = this.nearestCar(P);
    if (c && !c.driver) {
      if (holding) {
        if (!c.box) actions.push(['E  Put the box in the car', () => this.putBoxInCar(c)]);
        else if (c.box.count > 0 && holding.room > 0) actions.push(["E  Take the pufflings from this car's box", () => this.tipInto(c.box, holding)]);
      } else if (c.box) actions.push(['E  Take the box', () => this.takeBox(c.box)]);
    }
    if (interact && actions.length) { actions[0][1](); return ''; }
    const lines = [actions.length ? actions[0][0] : (notes[0] || '')];
    if (actions.length && notes.length) lines.push(notes[0]);
    if (c) {
      const moving = c.driver && Math.abs(c.speed) > 3;
      lines.push(c.driver ? (moving ? '' : 'F  Take this car') : 'F  Get in' + (holding ? ' (the box comes too)' : ''));
      if (carKey && !moving) { this.getIn(c); return ''; }
    }
    return lines.filter(Boolean).join('   ·   ');
  }
  nearestCar(P) {
    let best = null, bd = Infinity;
    for (const c of this.cars) {
      if (c.inWater > 0.5 || c.kinematic) continue;
      const ds = c.doorSpot();
      const d = Math.min(Math.hypot(P.x - c.pos.x, P.z - c.pos.z) - 0.1, Math.hypot(P.x - ds.x, P.z - ds.z));
      if (d < 3.4 && d < bd && Math.abs(P.y - c.pos.y) < 2) { bd = d; best = c; }
    }
    return best;
  }
  getIn(c) {
    const { player } = this;
    if (this.held) {
      if (!c.box) this.held.toCar(c);
      else { this.tipInto(this.held, c.box); this.dropBox(); }
      this.held = null; this.audio.rustle();
    }
    player.enterCar(c, () => {
      this.car.moveLightsTo(c);
      this.car = c; c.engineOn = true; c.setLights(true);
      this.audio.thump(0.2, 60, 0.05); this.updateBoxUI();
    }, () => {
      // pulling the driver out
      this.traffic.eject(c, 'jacked'); this.audio.punch();
      this.people.alarm(c.pos, null);
    });
  }
  catchOne(p) {
    const { player } = this;
    p.state = 'idle'; p.timer = 5; p.frozen = 1.0; // it freezes while you scoop it up
    player.heading = Math.atan2(p.pos.z - player.pos.z, p.pos.x - player.pos.x);
    player.startAction('grab', 0.85, 0.5, () => {
      if (!ON_GROUND.includes(p.state) || !this.held) return;
      if (Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z) > 2.6) { this.ui.toast('Missed! Try sneaking up (C)', 1.6); return; }
      this.pufflings.catch(p);
      this.held.count++; this.audio.rustle();
      this.updateBoxUI();
      if (Math.random() < 0.3) this.say(player, 'catch', 1, PLAYER_VOICE);
      if (this.held.count === 1 && !this.toldCliff) { this.toldCliff = true; this.ui.toast('Got one! Catch a few more, then take them to the cliff', 3.5); }
    });
  }
  pinch(n) {
    const { player } = this;
    player.heading = Math.atan2(n.pos.z - player.pos.z, n.pos.x - player.pos.x);
    player.startAction('grab', 0.6, 0.45, () => {
      if (!n.box || Math.hypot(n.pos.x - player.pos.x, n.pos.z - player.pos.z) > 2.2) return;
      let got;
      if (this.held) got = this.tipInto(n.box, this.held);
      else { this.takeBox(n.box); got = 1; }
      if (n.state === 'hunt') { n.state = 'idle'; n.t = 0; n.target = null; }
      if (got) setTimeout(() => {
        if (n.ko || !this.people.list.includes(n)) return;
        this.people.say(n, 'pinched', 2);
        if (Math.random() < 0.5) { n.state = 'angry'; n.t = 0; } else this.people.flee(n, player.pos, null);
      }, 700);
    });
  }
  throwOne() {
    const { player, lookout } = this;
    player.heading = Math.atan2(lookout.seaDir.z, lookout.seaDir.x);
    player.startAction('throw', 1.0, 0.62, () => {
      if (!this.held || this.held.count <= 0) return;
      const hand = new THREE.Vector3(); player.person.J.handR.getWorldPosition(hand);
      this.pufflings.launch(hand, lookout.seaDir);
      this.audio.whoosh(); this.audio.flutter(hand);
      this.held.count--; this.updateBoxUI();
      if (Math.random() < 0.35) this.say(player, 'toss', 1, PLAYER_VOICE);
      this.onSaved(1);
    });
  }
  onSaved(n, note) {
    this.saved += n;
    const s = STAR_AT.filter(k => this.saved >= k).length;
    this.ui.setStars(s, this.saved);
    if (s > this.stars) {
      this.stars = s;
      this.audio.chime(s); this.ui.starBurst();
      const words = ['', 'One star', 'Two stars', 'Three stars', 'Four stars', 'Five stars'];
      this.ui.toast(`${'★'.repeat(s)}<br>${words[s]}` + (s === 5 ? '<br><small>The colony thanks you. Keep going as long as you like.</small>' : ''), 4);
    } else this.ui.toast(note || 'Away it goes!', note ? 3 : 1.4);
  }
  // a box in the sea: the pufflings swim off, which is all they wanted
  freeBox(b, at) {
    const n = b.count; if (!n) return;
    b.count = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      this.pufflings.launch(new THREE.Vector3(at.x, Math.max(at.y, 0.3), at.z), { x: Math.cos(a) * 0.4, z: Math.sin(a) * 0.4 }, 3 + Math.random() * 2, 3);
    }
    this.onSaved(n, n === 1 ? 'A puffling swam off. That counts!' : `${n} pufflings swam off. That counts!`);
    this.updateBoxUI();
  }

  // ----------------------------------------------------------------- fighting
  resolveHit() {
    const { player, people } = this;
    const P = player.pos, h = player.heading, fx = Math.cos(h), fz = Math.sin(h);
    const knife = player.weapon === 'knife', reach = knife ? 1.75 : 1.5;
    // a puffling in reach: that's the end of that
    for (const p of this.pufflings.list) {
      if (!ON_GROUND.includes(p.state)) continue;
      const dx = p.pos.x - P.x, dz = p.pos.z - P.z, d = Math.hypot(dx, dz);
      if (d < reach && (dx * fx + dz * fz) / (d || 1) > 0.3) { this.goToJail(); return; }
    }
    const n = people.meleeTarget(P, h, reach);
    if (n) {
      people.hurt(n, knife ? 3 : 1, { x: fx, z: fz }, knife);
      if (knife) this.audio.swish();
      this.audio.punch(knife);
      return;
    }
    const c = this.nearestCar(P);
    if (c && Math.hypot(c.pos.x - P.x, c.pos.z - P.z) < 2.6) {
      this.audio.thump(0.3, 90, 0.1);
      if (c.driver) this.people.say(c.driver, 'crashed', 1);
      return;
    }
    if (knife) this.audio.swish(); else this.audio.noiseBurst(0.04, 900, 0.1);
  }
  hitPlayer(from, power) {
    const { player } = this;
    if (player.inCar || player.seq || player.ko || this.jailed || this.time < (player.safeUntil ?? 0)) return;
    this.audio.punch(power > 1);
    const dx = player.pos.x - from.pos.x, dz = player.pos.z - from.pos.z, d = Math.hypot(dx, dz) || 1;
    player.hurt += power;
    if (power >= 2 || player.hurt >= 3) {
      player.knockDown(dx / d * 3.5, dz / d * 3.5, 2.5, 1.6); player.hurt = 0;
      player.action = null; player.safeUntil = this.time + 5.5; // a moment to get up and get away
      if (from.kind === 'zombie') from.cool = 4;
      this.dropBox();
      if (from.kind === 'zombie') this.ui.toast('A draugr got you!', 1.8);
    } else { player.pos.x += dx / d * 0.35; player.pos.z += dz / d * 0.35; }
    this.say(player, 'ouch', 1, PLAYER_VOICE);
  }
  // fast cars knock people flying; slow ones just shove (the world's collision does that)
  carHits() {
    const walkers = this.people.list.filter(n => n.state !== 'driver' && n.state !== 'rise' && n.state !== 'sink' && !(n.ko && n.ko.phase === 'fly'));
    const { player } = this;
    if (!player.inCar && !player.seq && !this.jailed && !(player.ko && player.ko.phase === 'fly')) walkers.push(player);
    for (const c of this.cars) {
      const v = c.v.length(); if (v < 3.5 || c.kinematic) continue;
      for (const w of walkers) {
        if (Math.abs(w.pos.y - c.pos.y) > 1.6) continue;
        if (Math.abs(w.pos.x - c.pos.x) > 4 || Math.abs(w.pos.z - c.pos.z) > 4) continue;
        if (!c.circles().some(k => Math.hypot(w.pos.x - k.x, w.pos.z - k.z) < k.r + 0.3)) continue;
        w.knockDown(c.v.x * 0.85, c.v.z * 0.85, 2 + v * 0.18, 2.5);
        c.v.multiplyScalar(0.93);
        this.audio.crunch(v);
        if (w === player) { player.action = null; this.dropBox(); this.say(player, 'ouch', 2, PLAYER_VOICE); }
        else {
          if (w.kind === 'zombie') w.dead = true;
          else { this.people.dropBox(w); if (w.talkCool < 2) this.people.say(w, 'hit', 2); w.wasHit = c === this.car; }
          if (c === this.car && player.inCar) this.people.alarm(w.pos, w);
        }
      }
    }
  }
  onCarsHit(a, b, v) {
    for (const [c, o] of [[a, b], [b, a]]) {
      if (!c.driver || !c.ai) continue;
      if (!(o === this.car && this.player.inCar)) continue;
      if ((c.ai.crashT ?? 0) > this.time) continue;
      c.ai.crashT = this.time + 5;
      if (v > 4 && Math.random() < 0.3) this.traffic.eject(c, 'angry');
      else this.people.say(c.driver, 'crashed', 2);
    }
  }
  // running a puffling over (not that they make it easy)
  pufflingHits() {
    for (const c of this.cars) {
      const sp = c.v.length();
      if (sp < 0.3) continue;
      for (const p of this.pufflings.list) {
        if (!ON_GROUND.includes(p.state)) continue;
        if (Math.abs(p.pos.x - c.pos.x) > 3.5 || Math.abs(p.pos.z - c.pos.z) > 3.5) continue;
        for (const k of c.circles()) {
          const dx = p.pos.x - k.x, dz = p.pos.z - k.z, d = Math.hypot(dx, dz);
          if (d >= k.r + 0.15 || d < 1e-3) continue;
          if (sp > 6 && c === this.car && this.player.inCar && !(p.dodgeT > 0)) { this.goToJail(); return; }
          p.pos.x += dx / d * (k.r + 0.15 - d); p.pos.z += dz / d * (k.r + 0.15 - d); p.state = 'flee'; p.fleeT = 1;
        }
      }
    }
  }

  // ----------------------------------------------------------------- the police
  goToJail() {
    if (this.jailed || !this.jail) return;
    const { player, jail } = this;
    this.arrests++;
    this.audio.siren(); jail.alarm(true);
    if (player.inCar) { player.detachFromCar(this.car); this.car.engineOn = false; }
    player.seq = null; player.action = null; player.ko = null; player.fall = 0; player.spin = 0; player.swimming = false;
    if (this.held) { if (!this.car.box) this.held.toCar(this.car); else this.dropBox(); this.held = null; this.updateBoxUI(); }
    jail.setDoor(false);
    player.place(jail.cell.x, jail.cell.z, jail.ang + Math.PI / 2);
    this.cam.yaw = jail.ang - Math.PI / 2; this.cam.init = false;
    this.fade = 0.8;
    this.jailed = { t: 12 };
    const line = "You're nicked, sunshine. Pufflings are not for hitting.";
    this.voices.say(line, POLICE_VOICE, 0, 5); this.ui.say(line);
    this.ui.toast('Arrested<br><small>Violence against pufflings is not tolerated</small>', 4);
  }
  updateJail(dt) {
    const j = this.jailed; if (!j) return;
    j.t -= dt;
    if (j.t <= 0) {
      this.jailed = null; this.jail.setDoor(true); this.jail.alarm(false);
      const line = 'Go on then, off you go. And leave the pufflings alone.';
      this.voices.say(line, POLICE_VOICE, 0, 5); this.ui.say(line);
      this.ui.toast('Released', 1.6);
    }
  }

  // ----------------------------------------------------------------- the sea
  onSplash(at, v) {
    this.splashes.burst(at.x, at.z, Math.min(3, v / 6));
    this.audio.splash(Math.min(4, v / 5));
    if (this.held?.count > 0) this.freeBox(this.held, at);
  }
  seaAndCars(dt) {
    for (const c of [...this.cars]) {
      if (c.splash) { this.splashes.burst(c.pos.x, c.pos.z, 3); if (c.pos.distanceTo(this.E.camera.position) < 120) this.audio.splash(4); }
      if (c.inWater > 2 && c.box?.count > 0) this.freeBox(c.box, c.pos);
      if (c.inWater > 9 && !(c === this.car && this.player.inCar) && !c.ai) {
        if (c === this.car) this.spareCar();
        this.removeCar(c);
      }
    }
  }
  // a spare car by the nearest road, with a fresh box if you have none in hand
  spareCar() {
    const spot = this.landSpot(this.player.pos, true);
    const c = this.addCar(0xb3261e, spot.x, spot.z, spot.h);
    this.car.moveLightsTo(c); this.car = c;
    if (!this.held) this.newBox().toCar(c);
    this.ui.toast('A spare car is waiting by the road<br><small>It is blue on the map</small>', 3.5);
    this.updateBoxUI();
  }
  // the nearest dry, open spot on a road
  landSpot(P, forCar) {
    let best = null, bd = Infinity;
    for (const r of this.L.roads) for (let i = 1; i < r.pts.length - 1; i++) {
      const p = r.pts[i], d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d >= bd || this.world.ground(p.x, p.z) < 1) continue;
      if (this.world.blocked(p.x, p.z, forCar ? 1.3 : 0.4)) continue;
      if (forCar && this.cars.some(c => Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 6)) continue;
      bd = d; const q = r.pts[i + 1]; best = { x: p.x, z: p.z, h: Math.atan2(q.z - p.z, q.x - p.x) };
    }
    return best || { x: this.L.carStart.x, z: this.L.carStart.z, h: this.L.carStart.ang };
  }
  swimAshore() {
    const s = this.landSpot(this.player.pos, false);
    this.player.place(s.x, s.z, s.h);
    this.fade = 0.7; this.cam.init = false;
    this.ui.toast('You dragged yourself ashore', 2);
  }
  // abandoned cars pile up when you keep stealing new ones
  cleanUp(dt) {
    if ((this.cleanT = (this.cleanT ?? 0) - dt) > 0) return;
    this.cleanT = 2;
    const P = this.focus();
    const spare = this.cars.filter(c => !c.ai && c !== this.car && !(c.box && c.box.count > 0) && !c.driver);
    if (spare.length > 3) {
      const far = spare.map(c => ({ c, d: Math.hypot(c.pos.x - P.x, c.pos.z - P.z) })).sort((a, b) => b.d - a.d)[0];
      if (far.d > 70) this.removeCar(far.c);
    }
    for (const b of [...this.boxes]) if (b.where === 'ground' && b.count === 0 && b.worldPos().distanceTo(P) > 120) this.removeBox(b);
    // and boxes left lying about far away eventually get tidied up
    const ground = this.boxes.filter(b => b.where === 'ground').map(b => ({ b, d: b.worldPos().distanceTo(P) })).sort((a, b) => b.d - a.d);
    if (ground.length > 6 && ground[0].d > 150) this.removeBox(ground[0].b);
  }
  toggleOverlay(name) {
    const was = this.overlay;
    for (const n of ['help', 'map', 'pause']) this.ui.$(n === 'map' ? 'mapScreen' : n).hidden = true;
    this.overlay = was === name ? null : name;
    if (this.overlay) { this.ui.$(this.overlay === 'map' ? 'mapScreen' : this.overlay).hidden = false; this.input.unlock(); this.voices.hush(); }
    if (this.overlay === 'map') this.drawBigMap();
  }
  drawBigMap() {
    const { player, car } = this;
    this.ui.drawBigMap(this.focus(), player.inCar ? car.heading : player.heading, car.pos, this.lookout, this.pufflings.active(), this.mapMarks());
  }
}
