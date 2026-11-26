import * as THREE from 'three';
import { GeoBuilder, col } from '../geo.js';

// A small Icelandic fishing boat: lofted hull, wheelhouse, mast. Local +x is the bow.
export function buildBoat(hullHex = 0x2a4a7a, seed = 1) {
  const L = 13, B = 2.1; // length, half beam
  const N = 18;
  const pos = [], colr = [];
  const hullC = new THREE.Color(hullHex), white = new THREE.Color(0xeeeeea), anti = new THREE.Color(0x7a1a14), black = new THREE.Color(0x1a1a1a);
  // section half-width and sheer (deck height) along the hull, t = 0 stern .. 1 bow
  const halfW = t => (t < 0.55 ? B * (0.82 + 0.18 * Math.sin(t / 0.55 * Math.PI / 2)) : B * Math.cos((t - 0.55) / 0.45 * Math.PI / 2) ** 0.8);
  const deckY = t => 1.2 + 0.7 * Math.max(0, t - 0.6) ** 2 * 6;
  const keelY = t => -1.0 + 0.6 * Math.max(0, t - 0.75) * 4;
  // cross-section: from deck edge down to the keel, as fractions
  const prof = [[1, 1], [1.0, 0.75], [0.97, 0.45], [0.85, 0.2], [0.55, 0.05], [0.0, 0]];
  const sec = t => {
    const w = halfW(t), dy = deckY(t), ky = keelY(t);
    return prof.map(([fw, fy]) => [w * fw, ky + (dy - ky) * fy]);
  };
  const colorAt = y => (y > 0.95 ? white : y > 0.15 ? hullC : y > -0.05 ? black : anti);
  const push = (p, c) => { pos.push(...p); colr.push(c.r, c.g, c.b); };
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, x0 = (t0 - 0.5) * L, x1 = (t1 - 0.5) * L;
    const s0 = sec(t0), s1 = sec(t1);
    for (let k = 0; k < prof.length - 1; k++) {
      for (const side of [1, -1]) {
        const a = [x0, s0[k][1], side * s0[k][0]], b = [x1, s1[k][1], side * s1[k][0]];
        const c = [x1, s1[k + 1][1], side * s1[k + 1][0]], d = [x0, s0[k + 1][1], side * s0[k + 1][0]];
        const cc = colorAt((a[1] + c[1]) / 2);
        if (side > 0) { push(a, cc); push(d, cc); push(c, cc); push(a, cc); push(c, cc); push(b, cc); }
        else { push(a, cc); push(c, cc); push(d, cc); push(a, cc); push(b, cc); push(c, cc); }
      }
    }
    // deck
    const deckC = new THREE.Color(0x8a8678);
    const a = [x0, s0[0][1] - 0.15, s0[0][0] * 0.96], b = [x1, s1[0][1] - 0.15, s1[0][0] * 0.96];
    const c = [x1, s1[0][1] - 0.15, -s1[0][0] * 0.96], d = [x0, s0[0][1] - 0.15, -s0[0][0] * 0.96];
    push(a, deckC); push(b, deckC); push(c, deckC); push(a, deckC); push(c, deckC); push(d, deckC);
  }
  // transom
  const s0 = sec(0);
  for (let k = 0; k < prof.length - 1; k++) {
    const x = -L / 2;
    const a = [x, s0[k][1], s0[k][0]], b = [x, s0[k + 1][1], s0[k + 1][0]], c = [x, s0[k + 1][1], -s0[k + 1][0]], d = [x, s0[k][1], -s0[k][0]];
    const cc = colorAt((a[1] + b[1]) / 2);
    push(a, cc); push(b, cc); push(c, cc); push(a, cc); push(c, cc); push(d, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.computeVertexNormals();
  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide });
  const group = new THREE.Group();
  const hull = new THREE.Mesh(g, hullMat); hull.castShadow = true; hull.receiveShadow = true; group.add(hull);
  // wheelhouse, mast, rails
  const W = new GeoBuilder(1);
  const wx = -L * 0.18, wy = deckY(0.32) - 0.15;
  W.box(wx, wy + 1.1, 0, 3.0, 2.2, 2.6, white);
  W.box(wx + 0.1, wy + 2.3, 0, 3.4, 0.18, 2.9, col(0x3a3a3a));
  W.box(wx + 1.0, wy + 4.5, 0, 0.14, 4.4, 0.14, white);
  W.box(wx + 1.0, wy + 5.6, 0, 0.1, 0.1, 2.2, white);
  W.box(wx - 2.6, wy + 0.5, 0, 1.6, 1.0, 1.6, col(0x5a5a52));
  for (const z of [-1, 1]) W.box(0.5, deckY(0.55) + 0.35, z * (B - 0.08), L * 0.55, 0.06, 0.06, col(0xd0d0c8));
  const wh = new THREE.Mesh(W.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
  wh.castShadow = true; wh.receiveShadow = true; group.add(wh);
  // wheelhouse windows, lit on some boats
  const lit = seed % 3 === 0;
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.05, emissive: lit ? 0xffc890 : 0x000000, emissiveIntensity: lit ? 1.4 : 0 });
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 2.2), glass); win.position.set(wx + 1.53, wy + 1.6, 0); group.add(win);
  for (const z of [-1, 1]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 0.05), glass); sw.position.set(wx + 0.1, wy + 1.6, z * 1.32); group.add(sw); }
  // mast-head light
  const ml = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff4e0, emissiveIntensity: 8 }));
  ml.position.set(wx + 1.0, wy + 6.8, 0); group.add(ml);
  group.userData.phase = seed * 1.7;
  return group;
}
