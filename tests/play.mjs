// Plays through the whole loop in Firefox and takes screenshots at each step.
// node tests/play.mjs <outdir> [baseUrl]
import { firefox } from 'playwright';
const out = process.argv[2] || '.';
const base = process.argv[3] || 'http://localhost:5199/';
const browser = await firefox.launch({ headless: process.env.HEADLESS === '1' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));
const G = fn => page.evaluate(fn);
const shot = async name => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const press = async (key, hold = 60) => { await page.keyboard.down(key); await page.waitForTimeout(hold); await page.keyboard.up(key); };
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) errors.push('FAIL ' + msg); };

await page.goto(base + '?play&fixed');
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
await page.waitForTimeout(2500);
await shot('01-start');

// take the box from the car
await press('e'); await page.waitForTimeout(400);
check(await G(() => __game.boxWhere === 'hands'), 'took the box from the car');
await page.keyboard.down('s'); await page.waitForTimeout(700); await page.keyboard.up('s');
await shot('02-holding-box');

// catch three pufflings: walk up close to each one
for (let k = 0; k < 3; k++) {
  await G(() => {
    const g = __game, P = g.pufflings;
    const p = P.list.find(q => ['idle', 'waddle'].includes(q.state) && q.m.root.visible);
    // put the player a metre away, facing it
    const a = Math.random() * 6.28;
    g.player.pos.set(p.pos.x + Math.cos(a) * 1.0, g.world.ground(p.pos.x, p.pos.z), p.pos.z + Math.sin(a) * 1.0);
    g.player.heading = a + Math.PI; g.player.sync(); g.cam.yaw = g.player.heading; p.state = 'idle'; p.timer = 9; p.stamina = 0;
    window.__target = p;
  });
  await page.waitForTimeout(300);
  if (k === 0) await shot('03-near-puffling');
  await press('e');
  await page.waitForTimeout(450);
  if (k === 0) await shot('04-catching');
  await page.waitForTimeout(700);
}
check(await G(() => __game.boxCount === 3), 'caught three pufflings: ' + (await G(() => __game.boxCount)));
await shot('05-box-with-pufflings');

// walk back to the car and put the box in
await G(() => { const g = __game, s = g.car.doorSpot(); g.player.pos.set(s.x, g.world.ground(s.x, s.z), s.z); g.player.sync(); });
await page.waitForTimeout(300);
await press('e'); await page.waitForTimeout(400);
check(await G(() => __game.boxWhere === 'car'), 'put the box in the car');

// get in
await press('f');
await page.waitForTimeout(700);
await shot('06-entering-car');
await page.waitForTimeout(1500);
check(await G(() => __game.player.inCar), 'got into the car');
await shot('07-in-car');

// drive
const p0 = await G(() => ({ x: __game.car.pos.x, z: __game.car.pos.z }));
await page.keyboard.down('w'); await page.waitForTimeout(2500);
await shot('08-driving');
await page.keyboard.down('d'); await page.waitForTimeout(600); await page.keyboard.up('d');
await page.keyboard.up('w');
await page.keyboard.down('s'); await page.waitForTimeout(1500); await page.keyboard.up('s');
const p1 = await G(() => ({ x: __game.car.pos.x, z: __game.car.pos.z, v: __game.car.speed }));
check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 10, `car moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m`);

// jump to the cliff car park
await G(() => {
  const g = __game, L = g.L, lk = L.lookout;
  const x = lk.x - lk.seaDir.x * 14, z = lk.z - lk.seaDir.z * 14;
  g.car.place(x, z, Math.atan2(lk.seaDir.z, lk.seaDir.x) + 1.2);
});
await page.waitForTimeout(800);
await shot('09-at-cliff-in-car');
await press('f'); await page.waitForTimeout(1800);
check(await G(() => !__game.player.inCar), 'got out of the car');
check(await G(() => __game.car.doorTarget === 0 && __game.car.doorOpen < 0.3), 'closed the door behind them');
await shot('10-out-at-cliff');
await press('e'); await page.waitForTimeout(400);
check(await G(() => __game.boxWhere === 'hands'), 'took the box at the cliff');
// walk to the lookout
await G(() => { const g = __game, lk = g.L.lookout; g.player.pos.set(lk.x - lk.seaDir.x * 1.5, g.world.ground(lk.x, lk.z), lk.z - lk.seaDir.z * 1.5); g.player.heading = Math.atan2(lk.seaDir.z, lk.seaDir.x); g.player.sync(); g.cam.yaw = g.player.heading + 0.5; g.cam.pitch = 0.15; });
await page.waitForTimeout(500);
await shot('11-at-lookout');
await press('e');
await page.waitForTimeout(650);
await shot('12-throw');
await page.waitForTimeout(900);
await shot('13-flying');
await press('e'); await page.waitForTimeout(1300);
await press('e'); await page.waitForTimeout(1300);
await shot('14-flying-more');
check(await G(() => __game.saved === 3), 'saved three: ' + (await G(() => __game.saved)));
check(await G(() => __game.stars === 1), 'one star');
await page.waitForTimeout(2000);
await shot('15-after');
// map and help
await press('m'); await page.waitForTimeout(300); await shot('16-map'); await press('m');
await press('h'); await page.waitForTimeout(300); await shot('17-help'); await press('h');
const fps = await G(() => window.__fps);
console.log('fps', fps);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
