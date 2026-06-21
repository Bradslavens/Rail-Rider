import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// --- Renderer -------------------------------------------------------------
const canvas = document.getElementById("app") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// --- Scene ----------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e13);

// --- Camera ---------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
camera.position.set(8, 7, 12);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

// --- Lighting -------------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(10, 18, 6);
scene.add(sun);

// --- Ground grid ----------------------------------------------------------
const grid = new THREE.GridHelper(100, 100, 0x335577, 0x1b2733);
scene.add(grid);

// --- Placeholder "trolley" ------------------------------------------------
const trolley = new THREE.Mesh(
  new THREE.BoxGeometry(2.6, 1.4, 6),
  new THREE.MeshStandardMaterial({ color: 0xda291c, roughness: 0.6 }),
);
trolley.position.y = 0.7;
scene.add(trolley);

// --- Resize handling ------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- Delta-timed render loop ---------------------------------------------
const clock = new THREE.Clock();
function frame() {
  const dt = clock.getDelta();
  // Gentle idle spin so it's visibly animating at the correct rate.
  trolley.rotation.y += dt * 0.4;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
