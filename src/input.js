// Keyboard, mouse (pointer lock) and gamepad.
export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.pressed = new Set();
    this.mdx = 0; this.mdy = 0; this.locked = false; this.canvas = canvas;
    this.lastMouse = 0; this.enabled = true;
    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.pressed.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mdx += e.movementX; this.mdy += e.movementY; this.lastMouse = performance.now();
    });
    addEventListener('mousedown', e => { if (this.locked) this.pressed.add('Mouse' + e.button); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    this.pad = null; this.padPrev = {};
  }
  lock() { if (!this.locked) this.canvas.requestPointerLock?.()?.catch?.(() => {}); }
  unlock() { if (this.locked) document.exitPointerLock?.(); }
  down(...codes) { return codes.some(c => this.keys.has(c)); }
  hit(...codes) { return codes.some(c => this.pressed.has(c)); }
  axis(neg, pos) { return (this.down(...pos) ? 1 : 0) - (this.down(...neg) ? 1 : 0); }
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = [...pads].find(Boolean);
    this.pad = null;
    if (!p) return;
    const dz = v => (Math.abs(v) < 0.15 ? 0 : v);
    const b = i => !!p.buttons[i]?.pressed;
    const now = { a: b(0), b: b(1), x: b(2), y: b(3), lb: b(4), rb: b(5), start: b(9), back: b(8) };
    const hit = k => now[k] && !this.padPrev[k];
    this.pad = { lx: dz(p.axes[0]), ly: dz(p.axes[1]), rx: dz(p.axes[2]), ry: dz(p.axes[3]), rt: p.buttons[7]?.value ?? 0, lt: p.buttons[6]?.value ?? 0, now, hit };
    this.padPrev = now;
  }
  endFrame() { this.pressed.clear(); this.mdx = 0; this.mdy = 0; }
}
