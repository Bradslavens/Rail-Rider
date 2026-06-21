import * as THREE from "three";
import { loadTextureSet } from "./textures.ts";

export interface Environment {
  /** Move the sun's shadow frustum to follow the trolley each frame. */
  update(focus: THREE.Vector3): void;
}

const SKY_VERT = `
  varying vec3 vWorldPosition;
  void main() {
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform float exponent;
  varying vec3 vWorldPosition;
  void main() {
    float h = normalize(vWorldPosition).y;
    float t = pow(max(h, 0.0), exponent);
    gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
  }
`;

/**
 * Daytime lighting and atmosphere: a vivid gradient sky dome, a sun casting
 * soft shadows (its shadow camera follows the trolley so we get crisp shadows
 * without covering the whole 260 km network), hemisphere fill, distance fog,
 * and a ground plane. Tone mapping ties it together.
 */
export function setupEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Environment {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Sun direction (also drives the sky-gradient lean and the shadow light).
  const elevation = 48;
  const azimuth = 135;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

  // Vivid gradient sky dome (deep blue zenith -> pale horizon).
  const topColor = new THREE.Color(0x2f7ff0);
  const horizon = new THREE.Color(0xcfe6f7);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: topColor },
      horizonColor: { value: horizon },
      exponent: { value: 0.55 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(120000, 32, 16), skyMat);
  scene.add(skyDome);

  // Distance haze fades buildings into the horizon colour.
  scene.fog = new THREE.Fog(horizon, 600, 5500);
  scene.background = horizon.clone();

  // Lights.
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x47433a, 0.85));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const half = 180;
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = 1400;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  // Ground (tiled grass texture).
  const GROUND_SIZE = 120000;
  const grass = loadTextureSet("grass");
  const TILE = 8; // meters per texture tile
  for (const t of [grass.map, grass.normalMap, grass.roughnessMap]) {
    t.repeat.set(GROUND_SIZE / TILE, GROUND_SIZE / TILE);
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({
      map: grass.map,
      normalMap: grass.normalMap,
      roughnessMap: grass.roughnessMap,
      color: 0x9aa48f,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  ground.receiveShadow = true;
  scene.add(ground);

  const SUN_DIST = 700;
  return {
    update(focus: THREE.Vector3): void {
      sun.position.copy(focus).addScaledVector(sunDir, SUN_DIST);
      sun.target.position.copy(focus);
    },
  };
}
