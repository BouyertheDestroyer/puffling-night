import * as THREE from 'three';
import { height, WORLD } from './layout.js';
import { A } from '../assets.js';

// Height texture of the whole world, used by the sea (depth, foam) and the map.
export function makeHeightTexture(res = 512) {
  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = WORLD.minX + (i + 0.5) / res * (WORLD.maxX - WORLD.minX);
    const z = WORLD.minZ + (j + 0.5) / res * (WORLD.maxZ - WORLD.minZ);
    data[j * res + i] = height(x, z);
  }
  const t = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.FloatType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  t.userData.data = data; t.userData.res = res;
  return t;
}

export function buildTerrain() {
  const step = 2.5;
  const nx = Math.round((WORLD.maxX - WORLD.minX) / step) + 1, nz = Math.round((WORLD.maxZ - WORLD.minZ) / step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = WORLD.minX + i * step, z = WORLD.minZ + j * step, o = (j * nx + i) * 3;
    pos[o] = x; pos[o + 1] = height(x, z); pos[o + 2] = z;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    // pick the diagonal that follows the surface better
    if (Math.abs(pos[a * 3 + 1] - pos[d * 3 + 1]) < Math.abs(pos[b * 3 + 1] - pos[c * 3 + 1])) {
      idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b;
    } else { idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const T = A.tex;
  const uniforms = {
    tGrassD: { value: T.aerial_grass_rock.map }, tGrassN: { value: T.aerial_grass_rock.normalMap }, tGrassR: { value: T.aerial_grass_rock.arm },
    tRockD: { value: T.cliff_side.map }, tRockN: { value: T.cliff_side.normalMap }, tRockR: { value: T.cliff_side.arm },
    tSandD: { value: T.coast_sand_rocks_02.map }, tSandN: { value: T.coast_sand_rocks_02.normalMap }, tSandR: { value: T.coast_sand_rocks_02.arm },
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWP; varying vec3 vWN;
uniform sampler2D tGrassD, tGrassN, tGrassR, tRockD, tRockN, tRockR, tSandD, tSandN, tSandR;
vec3 tW; vec3 tNW; float tRough;
vec3 triNormal(sampler2D t, vec3 p, vec3 n, vec3 b){
  vec3 nx = texture2D(t, p.zy).xyz*2.0-1.0, ny = texture2D(t, p.xz).xyz*2.0-1.0, nz = texture2D(t, p.xy).xyz*2.0-1.0;
  nx = vec3(nx.xy + n.zy, abs(nx.z) * n.x);
  ny = vec3(ny.xy + n.xz, abs(ny.z) * n.y);
  nz = vec3(nz.xy + n.xy, abs(nz.z) * n.z);
  return normalize(nx.zyx * b.x + ny.xzy * b.y + nz.xyz * b.z);
}
vec4 tri(sampler2D t, vec3 p, vec3 b){ return texture2D(t,p.zy)*b.x + texture2D(t,p.xz)*b.y + texture2D(t,p.xy)*b.z; }
`)
      .replace('#include <map_fragment>', `
vec3 n0 = normalize(vWN);
float slope = 1.0 - n0.y;
float macro = texture2D(tGrassD, vWP.xz/173.0).g;
float rockW = smoothstep(0.30, 0.52, slope + (macro-0.35)*0.4);
float sandW = (1.0 - rockW) * smoothstep(3.2, 1.2, vWP.y + (macro-0.35)*3.0);
float grassW = max(0.0, 1.0 - rockW - sandW);
vec3 bl = pow(abs(n0), vec3(4.0)); bl /= (bl.x+bl.y+bl.z);
vec3 pr = vWP / 9.0;
vec2 pg = vWP.xz / 7.0, ps = vWP.xz / 6.0;
vec3 cG = texture2D(tGrassD, pg).rgb * mix(0.75, 1.15, macro);
vec3 cR = tri(tRockD, pr, bl).rgb;
vec3 cS = texture2D(tSandD, ps).rgb;
vec3 col = cG*grassW + cR*rockW + cS*sandW;
col *= mix(0.55, 1.0, smoothstep(-6.0, 0.0, vWP.y)); // darker under water
diffuseColor.rgb *= col;
// detail normals in world space
vec3 nG = texture2D(tGrassN, pg).xyz*2.0-1.0; nG = normalize(vec3(nG.x, 0.0, -nG.y) * 0.9 + n0 * nG.z);
vec3 nS = texture2D(tSandN, ps).xyz*2.0-1.0; nS = normalize(vec3(nS.x, 0.0, -nS.y) + n0 * nS.z);
vec3 nR = triNormal(tRockN, pr, n0, bl);
tNW = normalize(nG*grassW + nR*rockW + nS*sandW);
tRough = texture2D(tGrassR, pg).g*grassW + tri(tRockR, pr, bl).g*rockW + texture2D(tSandR, ps).g*sandW;
tRough = mix(tRough*0.55, tRough, smoothstep(0.2, 1.5, vWP.y)); // wet near the water
`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNW, 0.0)).xyz);');
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
