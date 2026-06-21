import * as THREE from "three";
import { loadNetwork } from "./core/load.ts";
import { buildNetwork } from "./render/network.ts";
import { CameraRig } from "./camera/cameras.ts";

// --- Renderer -------------------------------------------------------------
const canvas = document.getElementById("app") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e13);

// --- Load the network and build the scene --------------------------------
const data = await loadNetwork();
const { group, legend } = buildNetwork(data);
scene.add(group);

const rig = new CameraRig(data.meta, canvas);

// Reference grid sized to the network (1 km cells).
const maxSpan = Math.max(
  data.meta.bbox.maxX - data.meta.bbox.minX,
  data.meta.bbox.maxZ - data.meta.bbox.minZ,
);
const gridSize = Math.ceil(maxSpan / 1000) * 1000;
const grid = new THREE.GridHelper(gridSize, gridSize / 1000, 0x1b2733, 0x141b24);
grid.position.set(
  (data.meta.bbox.minX + data.meta.bbox.maxX) / 2,
  -2,
  (data.meta.bbox.minZ + data.meta.bbox.maxZ) / 2,
);
scene.add(grid);

// --- HUD ------------------------------------------------------------------
const hud = document.getElementById("hud") as HTMLDivElement;
function renderHud(): void {
  const m = data.meta;
  const swatches = legend
    .map(
      (l) =>
        `<div><span class="swatch" style="background:${l.colorHex}"></span>${l.shortName}</div>`,
    )
    .join("");
  hud.innerHTML = `
    <h1>RAIL RIDER</h1>
    <div>${m.trackCount} tracks · ${m.stationCount} stations · ${m.totalTrackKm} km</div>
    <div class="legend">${swatches}</div>
    <div class="hint">View: <strong>${rig.mode === "3d" ? "3D" : "Map (top-down)"}</strong> — press M to toggle</div>
  `;
}
renderHud();

// --- Input ----------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "m") {
    rig.toggle();
    renderHud();
  }
});

// --- Resize ---------------------------------------------------------------
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  rig.resize(w, h);
}
window.addEventListener("resize", resize);
resize();

// --- Render loop ----------------------------------------------------------
function frame(): void {
  rig.update();
  renderer.render(scene, rig.active);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
