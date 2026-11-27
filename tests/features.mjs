// Exercises the open-world additions: jumping, falling, swimming, car physics off a cliff,
// fighting, pickpocketing, carjacking, the draugar and jail.
// node tests/features.mjs <outdir> [baseUrl]
import { firefox } from 'playwright';
const out = process.argv[2] || '.';
const base = process.argv[3] || 'http://localhost:5199/';
const browser = await firefox.launch({ headless: process.env.HEADLESS === '1' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));
const G = (fn, arg) => page.evaluate(fn, arg);
const shot = async name => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const press = async (key, hold = 60) => { await page.keyboard.down(key); await page.waitForTimeout(hold); await page.keyboard.up(key); };
const wait = ms => page.waitForTimeout(ms);
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) errors.push('FAIL ' + msg); };

await page.goto(base + '?play&fixed');
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
await wait(2500);

// ---- jumping
const y0 = await G(() => __game.player.pos.y);
await press('Space'); await wait(180);
const y1 = await G(() => __game.player.pos.y);
await shot('f01-jump');
check(y1 > y0 + 0.4, `jumped ${(y1 - y0).toFixed(2)} m`);
await wait(900);
check(await G(() => __game.player.onGround), 'landed again');

// ---- townsfolk and traffic exist
const census = await G(() => ({ peds: __game.people.list.filter(n => n.kind === 'ped' && n.state !== 'driver').length, zombies: __game.people.list.filter(n => n.kind === 'zombie').length, traffic: __game.traffic.list.length }));
console.log('census', JSON.stringify(census));
check(census.peds >= 8 && census.zombies >= 3 && census.traffic >= 4, 'people, draugar and traffic about');
// a traffic car leaving takes exactly its own driver with it
check(await G(() => {
  const g = __game, before = g.people.list.length, ai = g.traffic.list[g.traffic.list.length - 1], d = ai.driver;
  g.traffic.remove(ai);
  return g.people.list.length === before - 1 && !g.people.list.includes(d) && g.people.list.every(n => n.root.parent);
}), 'removing a traffic car removes only its driver');

// ---- punch someone until they fall over
await G(() => {
  const g = __game, P = g.player, n = g.people.list.find(n => n.kind === 'ped' && n.state !== 'driver');
  // stand them a metre in front of the player, facing away
  const fx = Math.cos(P.heading), fz = Math.sin(P.heading);
  n.place(P.pos.x + fx * 1.0, P.pos.z + fz * 1.0, P.heading); n.state = 'idle'; n.t = -60; n.hp = 3;
  window.__victim = n; g.cam.yaw = P.heading + 0.9;
  for (const p of g.pufflings.list) if (p.pos.distanceTo(P.pos) < 4) p.pos.x += 20;
});
for (let k = 0; k < 3; k++) {
  await G(() => { const g = __game, P = g.player, n = __victim; if (!n.ko) { const fx = Math.cos(P.heading), fz = Math.sin(P.heading); n.pos.set(P.pos.x + fx, n.pos.y, P.pos.z + fz); n.state = 'idle'; n.punch = null; } });
  await press('r'); await wait(420);
  if (k === 0) await shot('f02-punch');
}
await wait(300);
check(await G(() => !!__victim.ko), 'three punches knocked them down');
await shot('f03-knocked-down');

// ---- pickpocket a rescuer from behind
await wait(1500);
const pinched = await G(async () => {
  const g = __game, P = g.player;
  let n = g.people.list.find(n => n.kind === 'ped' && n.box && n.state !== 'driver' && !n.ko);
  if (!n) { n = g.people.spawnPed(5, 60); const b = g.newBox(); b.count = 3; b.toHands(n); n.box = b; }
  n.box.count = 3; n.state = 'idle'; n.t = -60;
  // away from the car, standing behind them
  const s = g.landSpot({ x: P.pos.x + 30, z: P.pos.z + 30 }, false);
  n.place(s.x + 2, s.z, 0);
  P.place(s.x + 1, s.z, 0);
  for (const z of g.people.list) if (z.kind === 'zombie') z.place(z.pos.x + 200, z.pos.z);
  window.__mark = n; return n.box.count;
});
await wait(250);
const promptTxt = await G(() => document.getElementById('prompt').textContent + ' | ' + JSON.stringify({ st: __mark.state, d: __mark.pos.distanceTo(__game.player.pos).toFixed(2), h: __mark.heading.toFixed(2) }));
console.log('prompt:', promptTxt);
await press('e'); await wait(900);
check(await G(() => __game.held && __game.held.count === 3), 'nicked a rescuer\'s box of three pufflings');
await shot('f04-pinched');
await G(() => __game.dropBox());

// ---- carjack the nearest traffic car
const jack = await G(() => {
  const g = __game, P = g.player;
  const ai = g.traffic.list[0];
  const c = ai.car;
  // bring it here and stop it
  const spot = g.landSpot(P.pos, true);
  c.kinematic = false; ai.kin = false; c.place(spot.x, spot.z, spot.h);
  const ds = c.doorSpot(); P.pos.set(ds.x, g.world.ground(ds.x, ds.z), ds.z); P.sync();
  window.__jackCar = c; return !!c.driver;
});
check(jack, 'traffic car has a driver');
await wait(300);
await press('f'); await wait(2600);
check(await G(() => __game.player.inCar && __game.car === __jackCar && !__jackCar.driver), 'took their car');
await shot('f05-carjacked');
check(await G(() => __game.people.list.some(n => n.kind === 'ped' && (n.state === 'angry' || n.state === 'flee' || n.ko) && n.pos.distanceTo(__jackCar.pos) < 8)), 'the driver was pulled out');

// ---- drive off the cliff into the sea
await G(() => {
  const g = __game, lk = g.L.lookout, c = g.car;
  const x = lk.x - lk.seaDir.x * 18, z = lk.z - lk.seaDir.z * 18;
  c.place(x, z, Math.atan2(lk.seaDir.z, lk.seaDir.x));
  g.cam.yaw = c.heading; g.cam.init = false;
});
await page.keyboard.down('w');
let fell = false, minY = 99;
for (let k = 0; k < 40; k++) {
  await wait(150);
  const s = await G(() => ({ y: __game.car.pos.y, up: __game.car.upright, w: __game.car.inWater }));
  minY = Math.min(minY, s.y);
  if (k === 12) await shot('f06-off-the-cliff');
  if (s.y < 5) fell = true;
  if (s.w > 0.3) break;
}
await page.keyboard.up('w');
check(fell, `car fell off the cliff (lowest ${minY.toFixed(1)} m)`);
await wait(1200);
await shot('f07-splashdown');
await wait(2500);
check(await G(() => __game.player.swimming && !__game.player.inCar), 'swimming after the car went in');
await shot('f08-swimming');
await press('r'); await wait(800);
check(await G(() => !__game.player.swimming && __game.world.ground(__game.player.pos.x, __game.player.pos.z) > 0.5), 'swam ashore');
await wait(9000);
check(await G(() => __game.cars.includes(__game.car) && __game.car.inWater === 0), 'a spare car is waiting');

// ---- walk off the cliff edge
await G(() => {
  const g = __game, lk = g.L.lookout, P = g.player;
  const x = lk.x + lk.seaDir.x * 0.5, z = lk.z + lk.seaDir.z * 0.5;
  P.place(x, z, Math.atan2(lk.seaDir.z, lk.seaDir.x)); g.cam.yaw = P.heading; g.cam.init = false;
});
await page.keyboard.down('w'); await wait(2500); await page.keyboard.up('w');
await shot('f09-walked-off');
await wait(2500);
check(await G(() => __game.player.swimming || __game.player.pos.y < 20), 'walked off the cliff');

// ---- draugr attack
await press('r'); await wait(600);
await G(() => {
  const g = __game, P = g.player;
  const z = g.people.list.find(n => n.kind === 'zombie') || g.people.spawnZombie(10, 40);
  z.state = 'wander'; z.ko = null; z.place(P.pos.x + Math.cos(P.heading) * 3, P.pos.z + Math.sin(P.heading) * 3, P.heading + Math.PI);
  window.__z = z; g.cam.yaw = P.heading + 0.7;
});
await wait(600); await shot('f10-draugr');
let got = false;
for (let k = 0; k < 20 && !got; k++) { await wait(200); got = await G(() => !!__game.player.ko); }
check(got, 'a draugr knocked the player down');
await G(() => { const g = __game, f = g.hitPlayer.bind(g); window.__hits = []; g.hitPlayer = (from, p) => { __hits.push(from.kind + ':' + from.state + ':' + (from === __z)); return f(from, p); }; });
await wait(3200);
// punch it back
for (let k = 0; k < 3; k++) {
  await G(() => { const g = __game, P = g.player, z = __z; z.cool = 5; z.state = 'chase'; z.pos.set(P.pos.x + Math.cos(P.heading), P.pos.y, P.pos.z + Math.sin(P.heading)); });
  await press('r'); await wait(450);
  console.log('draugr', await G(() => JSON.stringify({ hp: __z.hp, ko: !!__z.ko, st: __z.state, pko: !!__game.player.ko, act: __game.player.action?.type })));
}
await wait(1500);
console.log('hits', await G(() => JSON.stringify(__hits)));
check(await G(() => __z.dead), 'punches put the draugr back in the ground');
await wait(2500);

// ---- hitting a puffling gets you arrested
await G(() => {
  const g = __game, P = g.player, p = g.pufflings.list.find(p => ['idle', 'waddle'].includes(p.state));
  for (const z of g.people.list) if (z.kind === 'zombie' && z.pos.distanceTo(P.pos) < 30) z.place(z.pos.x + 200, z.pos.z);
  P.ko = null; P.action = null;
  p.pos.set(P.pos.x + Math.cos(P.heading) * 0.8, P.pos.y, P.pos.z + Math.sin(P.heading) * 0.8); p.state = 'idle'; p.timer = 9; p.frozen = 2;
});
await press('r'); await wait(1500);
check(await G(() => !!__game.jailed), 'arrested for hitting a puffling');
await shot('f11-jail');
await G(() => { __game.cam.yaw += 2.6; });
await wait(600); await shot('f12-jail-outside');
await wait(11500);
check(await G(() => !__game.jailed && __game.jail.open), 'released after the sentence');

// ---- tumble: roll the car and put it back on its wheels
await G(() => {
  const g = __game, c = g.car, P = g.player;
  const s = g.landSpot(P.pos, true); c.place(s.x, s.z, s.h);
  const ds = c.doorSpot(); P.place(ds.x, ds.z);
});
await press('f'); await wait(2200);
console.log('in car for the roll:', await G(() => __game.player.inCar));
await G(() => { const c = __game.car; c.wake(); c.w.set(c.forward.x * 4.2, 0, c.forward.y * 4.2); c.v.y = 4.5; });
await wait(2500);
const up = await G(() => __game.car.upright);
await shot('f13-rolled');
check(up < 0.5, `car rolled over (upright ${up.toFixed(2)})`);
await press('r'); await wait(1500);
check(await G(() => __game.car.upright > 0.9), 'R put it back on its wheels');

const fps = await G(() => window.__fps);
console.log('fps', fps);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
