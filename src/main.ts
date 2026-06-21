import * as THREE from "three";
import { loadNetwork } from "./core/load.ts";
import { buildNetwork } from "./render/network.ts";
import { TrackPath } from "./sim/trackPath.ts";
import { stepTrolley, DEFAULT_PARAMS, type TrolleyState } from "./sim/trolley.ts";
import { buildTrolley } from "./render/trolley.ts";
import { CameraDirector } from "./camera/driveCamera.ts";
import { InputManager } from "./input/input.ts";

// --- Renderer & scene -----------------------------------------------------
const canvas = document.getElementById("app") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e13);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(500, 1000, 300);
scene.add(sun);

// --- Load network ---------------------------------------------------------
const data = await loadNetwork();
scene.add(buildNetwork(data).group);

// Reference grid sized to the network (1 km cells).
const span = Math.max(
  data.meta.bbox.maxX - data.meta.bbox.minX,
  data.meta.bbox.maxZ - data.meta.bbox.minZ,
);
const gridSize = Math.ceil(span / 1000) * 1000;
const grid = new THREE.GridHelper(gridSize, gridSize / 1000, 0x1b2733, 0x141b24);
grid.position.set(
  (data.meta.bbox.minX + data.meta.bbox.maxX) / 2,
  -2,
  (data.meta.bbox.minZ + data.meta.bbox.maxZ) / 2,
);
scene.add(grid);

// --- Trolley + driving state ---------------------------------------------
const director = new CameraDirector(data.meta);
const input = new InputManager();
const trolley = buildTrolley(data.tracks[0].colorHex);
scene.add(trolley.group);

let trackIndex = 0;
let path = new TrackPath(data.tracks[0].points);
let state: TrolleyState = { s: 0, v: 0 };
let reverse = false;

function selectTrack(i: number): void {
  const n = data.tracks.length;
  trackIndex = ((i % n) + n) % n;
  const t = data.tracks[trackIndex];
  path = new TrackPath(t.points);
  state = { s: 0, v: 0 };
  reverse = false;
  trolley.setColor(t.colorHex);
}

input.onReverse = () => {
  reverse = !reverse;
};
input.onCameraToggle = () => director.cycleDriveView();
input.onMapToggle = () => director.toggleMap();
input.onPrevLine = () => selectTrack(trackIndex - 1);
input.onNextLine = () => selectTrack(trackIndex + 1);

// --- HUD ------------------------------------------------------------------
const hud = document.getElementById("hud") as HTMLDivElement;
hud.innerHTML = `
  <h1>RAIL RIDER</h1>
  <div id="hud-line"></div>
  <div id="hud-speed"></div>
  <div id="hud-next"></div>
  <div class="hint" id="hud-view"></div>
  <div class="hint">↑/W throttle · ↓/S brake · R reverse · C cab/chase · M map · [ ] change line · Space horn</div>
`;
const elLine = document.getElementById("hud-line") as HTMLDivElement;
const elSpeed = document.getElementById("hud-speed") as HTMLDivElement;
const elNext = document.getElementById("hud-next") as HTMLDivElement;
const elView = document.getElementById("hud-view") as HTMLDivElement;

function fmtMeters(m: number): string {
  return m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(2)} km`;
}

function updateHud(): void {
  const t = data.tracks[trackIndex];
  elLine.textContent = `${t.shortName} — ${t.directionName || "dir " + t.directionId} (${(t.lengthM / 1000).toFixed(1)} km)`;
  elSpeed.textContent = `${(Math.abs(state.v) * 3.6).toFixed(0)} km/h${reverse ? "  ◀ REV" : ""}`;

  let next: { name: string; distAlong: number } | undefined;
  if (reverse) {
    for (const st of t.stations) if (st.distAlong < state.s - 1) next = st;
  } else {
    next = t.stations.find((st) => st.distAlong > state.s + 1);
  }
  elNext.textContent = next
    ? `Next: ${next.name} (${fmtMeters(Math.abs(next.distAlong - state.s))})`
    : "Next: — end of line";

  elView.textContent = `View: ${director.view}`;
}

// --- Resize ---------------------------------------------------------------
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  director.resize(w, h);
}
window.addEventListener("resize", resize);

// --- Main loop ------------------------------------------------------------
const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  input.update();

  state = stepTrolley(
    state,
    DEFAULT_PARAMS,
    { throttle: input.throttle, brake: input.brake, reverse },
    dt,
    path.length,
  );

  const pos = path.positionAt(state.s);
  const heading = path.tangentAt(state.s);
  trolley.group.position.set(pos.x, 0, pos.z);
  trolley.group.rotation.y = Math.atan2(heading.x, heading.z);

  director.follow(pos, heading);
  updateHud();
  renderer.render(scene, director.active);
  requestAnimationFrame(frame);
}

selectTrack(0);
resize();
frame();
