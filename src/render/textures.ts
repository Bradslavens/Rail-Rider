import * as THREE from "three";

// CC0 PBR texture sets (ambientCG), served from /public/textures. Memoised so
// each set's images load once and are shared across materials.

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

const loader = new THREE.TextureLoader();
const cache = new Map<string, PBRSet>();

function tex(url: string, srgb: boolean): THREE.Texture {
  const t = loader.load(url);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Load (or reuse) a texture set by folder name under /textures. */
export function loadTextureSet(name: string): PBRSet {
  const hit = cache.get(name);
  if (hit) return hit;
  const base = `/textures/${name}/`;
  const set: PBRSet = {
    map: tex(`${base}color.jpg`, true),
    normalMap: tex(`${base}normal.jpg`, false),
    roughnessMap: tex(`${base}roughness.jpg`, false),
  };
  cache.set(name, set);
  return set;
}
