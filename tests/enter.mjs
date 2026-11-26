// Frame-by-frame of getting into and out of the car, seen from the driver's side.
import { firefox } from 'playwright';
const out = process.argv[2] || '.';
const browser = await firefox.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/?play&fixed');
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const g = __game, c = g.car, f = c.forward, left = { x: f.y, z: -f.x };
  const P = c.pos;
  g.player.pos.set(P.x + left.x * 4 - f.x * 1.5, g.world.ground(P.x, P.z), P.z + left.z * 4 - f.y * 1.5); g.player.sync();
  window.__camOverride = { pos: [P.x + left.x * 6.5 + f.x * 3, P.y + 2.2, P.z + left.z * 6.5 + f.y * 3], look: [P.x, P.y + 0.9, P.z] };
});
await page.waitForTimeout(300);
await page.keyboard.press('f');
for (let i = 0; i < 10; i++) { await page.waitForTimeout(280); await page.screenshot({ path: `${out}/enter-${i}.png` }); }
await page.waitForTimeout(800);
await page.keyboard.press('f');
for (let i = 0; i < 8; i++) { await page.waitForTimeout(250); await page.screenshot({ path: `${out}/exit-${i}.png` }); }
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
