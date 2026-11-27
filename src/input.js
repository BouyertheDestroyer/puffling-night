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
    addEventListener('pointerdown', e => { if (this.locked && e.pointerType === 'mouse') this.pressed.add('Mouse' + e.button); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    this.pad = null; this.padPrev = {};
    this.stick = { x: 0, y: 0 };
    // touch controls appear the first time the screen is touched
    this.touch = false; this.touchWanted = false;
    addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && !this.touch) {
        this.touch = true;
        if (!this.touchEl) this.setupTouch();
        document.body.classList.add('touch'); this.showTouch(this.touchWanted);
      } else if (e.pointerType === 'mouse' && this.touch) {
        // back on the mouse (a touch-screen laptop): hide the touch controls again
        this.touch = false; document.body.classList.remove('touch');
        if (this.touchEl) this.touchEl.hidden = true;
      }
    }, true);
  }
  // On-screen controls: a stick wherever the left thumb lands, drag on the right to look, buttons.
  setupTouch() {
    document.body.classList.add('touch');
    const el = document.createElement('div'); el.id = 'touch'; el.hidden = true;
    el.innerHTML = `<div id="stickBase"><div id="stickKnob"></div></div>
      <div id="tbtns"><button data-k="KeyE" class="big">E</button><button data-k="KeyF">Car</button>
      <button data-k="Space" data-hold="1">Brake</button><button data-k="ShiftLeft" data-hold="1">Run</button><button data-k="KeyM">Map</button></div>`;
    document.body.appendChild(el);
    this.touchEl = el;
    const base = el.querySelector('#stickBase'), knob = el.querySelector('#stickKnob');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const R = 55;
    addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || el.hidden || e.target.closest('button, .screen, #tools, #skip')) return;
      if (e.clientX < innerWidth * 0.45 && stickId === null) {
        stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
        base.style.left = sx + 'px'; base.style.top = sy + 'px'; base.classList.add('on');
      } else if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; }
    });
    addEventListener('pointermove', e => {
      if (e.pointerId === stickId) {
        let dx = e.clientX - sx, dy = e.clientY - sy; const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.stick.x = dx / R; this.stick.y = dy / R;
      } else if (e.pointerId === lookId) {
        this.mdx += (e.clientX - lx) * 1.6; this.mdy += (e.clientY - ly) * 1.6; lx = e.clientX; ly = e.clientY;
        this.lastMouse = performance.now();
      }
    });
    const up = e => {
      if (e.pointerId === stickId) { stickId = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; base.classList.remove('on'); }
      if (e.pointerId === lookId) lookId = null;
    };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
    for (const b of el.querySelectorAll('button')) {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.pressed.add(k); this.keys.add(k); b.classList.add('on'); });
      const rel = () => { this.keys.delete(k); b.classList.remove('on'); };
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
    }
  }
  showTouch(on) { this.touchWanted = on; if (this.touchEl) this.touchEl.hidden = !on || !this.touch; }
  lock() { if (!this.locked && !this.touch) { try { this.canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} } }
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
