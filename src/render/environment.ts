import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

export interface Environment {
  /** Move the sun's shadow frustum to follow the trolley each frame. */
  update(focus: THREE.Vector3): void;
}

/**
 * Daytime lighting and atmosphere: a physical sky, a sun casting soft shadows
 * (its shadow camera follows the trolley so we get crisp shadows without
 * covering the whole 260 km network), hemisphere fill, distance fog, and a
 * ground plane. Tone mapping ties it together.
 */
export function setupEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Environment {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Physical sky + sun direction.
  const sky = new Sky();
  sky.scale.setScalar(450000);
  scene.add(sky);
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 3;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.8;
  const elevation = 48;
  const azimuth = 135;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  u.sunPosition.value.copy(sunDir);

  // Atmosphere: haze that fades distant buildings into the horizon.
  const horizon = new THREE.Color(0xc3d2dd);
  scene.fog = new THREE.Fog(horizon, 500, 5000);
  scene.background = horizon;

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

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120000, 120000),
    new THREE.MeshStandardMaterial({ color: 0x3c463a, roughness: 1 }),
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
