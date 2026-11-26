import * as THREE from 'three';

// Accumulates triangles (with a current transform) and turns them into one BufferGeometry.
export class GeoBuilder {
  constructor(uvScale = 1) {
    this.p = []; this.n = []; this.uv = []; this.c = [];
    this.M = new THREE.Matrix4(); this.N = new THREE.Matrix3();
    this.uvScale = uvScale;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
  }
  setMatrix(m) { this.M.copy(m); this.N.getNormalMatrix(m); return this; }
  identity() { this.M.identity(); this.N.identity(); return this; }
  vert(x, y, z, nx, ny, nz, u, v, col) {
    const p = this._v.set(x, y, z).applyMatrix4(this.M), n = this._w.set(nx, ny, nz).applyMatrix3(this.N).normalize();
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.c.push(col.r, col.g, col.b);
  }
  // a,b,c,d: [x,y,z] counter-clockwise seen from the front. UVs are metric along ab and ad.
  quad(a, b, c, d, col, uv0 = [0, 0], scale = this.uvScale, uvRect = null) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ad = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = ab[1] * ad[2] - ab[2] * ad[1], ny = ab[2] * ad[0] - ab[0] * ad[2], nz = ab[0] * ad[1] - ab[1] * ad[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let U, V, u0, v0;
    if (uvRect) { [u0, v0, U, V] = uvRect; }
    else { U = Math.hypot(...ab) / scale; V = Math.hypot(...ad) / scale; u0 = uv0[0]; v0 = uv0[1]; }
    this.vert(...a, nx, ny, nz, u0, v0, col); this.vert(...b, nx, ny, nz, u0 + U, v0, col); this.vert(...c, nx, ny, nz, u0 + U, v0 + V, col);
    this.vert(...a, nx, ny, nz, u0, v0, col); this.vert(...c, nx, ny, nz, u0 + U, v0 + V, col); this.vert(...d, nx, ny, nz, u0, v0 + V, col);
  }
  tri(a, b, c, col, scale = this.uvScale) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = ab[1] * ac[2] - ab[2] * ac[1], ny = ab[2] * ac[0] - ab[0] * ac[2], nz = ab[0] * ac[1] - ab[1] * ac[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // planar uv: horizontal distance along ab, height
    const ux = ab[0] / (Math.hypot(ab[0], ab[2]) || 1), uz = ab[2] / (Math.hypot(ab[0], ab[2]) || 1);
    const uv = p => [((p[0] - a[0]) * ux + (p[2] - a[2]) * uz) / scale, (p[1] - a[1]) / scale];
    this.vert(...a, nx, ny, nz, ...uv(a), col); this.vert(...b, nx, ny, nz, ...uv(b), col); this.vert(...c, nx, ny, nz, ...uv(c), col);
  }
  // axis-aligned box in the current frame
  box(cx, cy, cz, sx, sy, sz, col, opts = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const s = opts.scale ?? this.uvScale;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, [0, 0], s); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, [0, 0], s); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, [0, 0], s); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, [0, 0], s); // -x
    if (!opts.noTop) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col, [0, 0], s);
    if (!opts.noBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, [0, 0], s);
  }
  get count() { return this.p.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export const col = (hex) => new THREE.Color(hex);
