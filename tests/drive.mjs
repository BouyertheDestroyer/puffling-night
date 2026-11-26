// Drives the car into a house and off towards the sea, checking it never ends up inside anything.
import { firefox } from 'playwright';
const out = process.argv[2] || '.';
const browser = await firefox.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/?play&fixed');
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const G = fn => page.evaluate(fn);
// get in
await G(() => { const g = __game; g.player.inCar = true; g.player.attachToCar(g.car); g.player.root.position.set(0.38, 0.6, 0.02); g.player.root.rotation.set(0, 0, 0); });
async function run(setup, ms, label) {
  await G(setup);
  await page.keyboard.down('w');
  let worst = 0;
  for (let t = 0; t < ms; t += 250) {
    await page.waitForTimeout(250);
    const pen = await G(() => { const g = __game, c = g.car; let m = 0; for (const k of c.circles()) { const p = g.world.pushOut(k.x, k.z, k.r * 0.6, { car: c }); m = Math.max(m, Math.hypot(p.x, p.z)); } return m; });
    worst = Math.max(worst, pen);
  }
  await page.keyboard.up('w');
  const st = await G(() => ({ v: __game.car.speed.toFixed(1), y: __game.car.pos.y.toFixed(1), g: __game.world.ground(__game.car.pos.x, __game.car.pos.z).toFixed(1) }));
  await page.screenshot({ path: `${out}/drive-${label}.png` });
  console.log(label, 'worst penetration', worst.toFixed(2), JSON.stringify(st));
}
// aim at the nearest building
await run(() => {
  const g = __game, c = g.car, b = g.L.buildings.find(b => b.type === 'house' && Math.hypot(b.x - c.pos.x, b.z - c.pos.z) > 25 && Math.hypot(b.x - c.pos.x, b.z - c.pos.z) < 60);
  c.heading = Math.atan2(b.z - c.pos.z, b.x - c.pos.x); c.vel.set(0, 0);
}, 5000, 'house');
// aim at the sea
await run(() => {
  const g = __game, c = g.car;
  c.place(c.pos.x, c.pos.z, Math.PI); // west, towards the coast
}, 9000, 'sea');
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
