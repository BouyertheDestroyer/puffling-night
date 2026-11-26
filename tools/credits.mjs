// Writes CREDITS.md from Poly Haven's asset metadata.
import fs from 'node:fs/promises';
import { TEXTURES, MODELS, HDRIS } from './fetch-assets.mjs';
const UA = { 'User-Agent': 'puffling-night-asset-fetch' };
const rows = [];
for (const [kind, ids] of [['Model', MODELS], ['Texture', TEXTURES], ['HDRI', HDRIS]]) {
  for (const id of ids) {
    const info = await (await fetch(`https://api.polyhaven.com/info/${id}`, { headers: UA })).json();
    rows.push(`| ${kind} | [${info.name}](https://polyhaven.com/a/${id}) | ${Object.keys(info.authors).join(', ')} | CC0 1.0 |`);
  }
}
const md = `# Credits

## Third-party assets

All third-party assets come from [Poly Haven](https://polyhaven.com) and are released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain): free to use, modify and
redistribute, attribution not required but given here with thanks. They were downloaded with
\`tools/fetch-assets.mjs\` and shrunk (meshopt geometry, WebP textures) with \`tools/optimize-assets.mjs\`.

| Kind | Asset | Author(s) | Licence |
| --- | --- | --- | --- |
${rows.join('\n')}

## Made for this game

Everything else was made for Puffling Night and is part of this repository:

- The town, terrain, roads, houses, church, harbour, lighthouse and cliff lookout (generated in code).
- The car, the player character, the caveman, the pufflings and the cardboard box (modelled in code).
- The sky: stars, moon, Milky Way and aurora (shaders), and the sea (shader, generated wave normals).
- All animation (procedural), all sound and music (synthesised live with WebAudio), the interface.

## Libraries

- [three.js](https://threejs.org) (MIT licence), including its post-processing, GLTF and meshopt loaders.
`;
await fs.writeFile('CREDITS.md', md);
console.log(md);
