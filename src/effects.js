import * as THREE from 'three';

// White water thrown up when something falls into the sea.
export class Splashes {
  constructor(scene, max = 600) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float life; varying float vL; uniform float uScale;
        void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = life > 0.0 ? uScale * (0.12 + 0.18 * (1.0 - life)) / -mv.z : 0.0; }`,
      fragmentShader: `varying float vL; void main(){ vec2 q = gl_PointCoord - 0.5; float d = dot(q, q);
        if (d > 0.25) discard; gl_FragColor = vec4(vec3(0.5, 0.56, 0.62), (1.0 - d * 4.0) * 0.4 * clamp(vL * 2.0, 0.0, 1.0)); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = g;
  }
  burst(x, z, size = 1) {
    const k = Math.min(this.max, Math.round(60 + 90 * size));
    for (let i = 0; i < k; i++) {
      const j = this.n; this.n = (this.n + 1) % this.max;
      const a = Math.random() * 6.28, r = Math.random() * 0.8 * size, up = (3 + Math.random() * 6) * Math.sqrt(size);
      this.pos.set([x + Math.cos(a) * r, 0.1, z + Math.sin(a) * r], j * 3);
      this.vel.set([Math.cos(a) * (1 + Math.random() * 2.5) * size, up, Math.sin(a) * (1 + Math.random() * 2.5) * size], j * 3);
      this.life[j] = 1;
    }
    this.active = true;
  }
  update(dt) {
    if (!this.active) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt * 0.9;
      this.vel[i * 3 + 1] -= 12 * dt;
      for (let c = 0; c < 3; c++) this.pos[i * 3 + c] += this.vel[i * 3 + c] * dt;
      if (this.pos[i * 3 + 1] < -0.2) this.life[i] = 0;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.life.needsUpdate = true;
    this.active = any;
  }
}
