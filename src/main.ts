import * as THREE from "three";
import { loadNetwork, loadSignals } from "./core/load.ts";
import { buildNetwork } from "./render/network.ts";
import { SignalEditor } from "./edit/signalEditor.ts";
import { TrackPath } from "./sim/trackPath.ts";
import type { TrackPoint } from "./core/types.ts";
import { stepTrolley, DEFAULT_PARAMS, type TrolleyState } from "./sim/trolley.ts";
import { planSubsteps, FIXED_DT, TIME_SCALES } from "./sim/clock.ts";
import { SpeedLimitProfile, DEFAULT_SPEED_LIMIT } from "./sim/speedLimit.ts";
import {
  updateStop,
  INITIAL_STOP,
  DEFAULT_STOP_PARAMS,
  type StopState,
} from "./sim/stops.ts";
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
let limits = new SpeedLimitProfile(data.tracks[0].points, DEFAULT_SPEED_LIMIT);
let state: TrolleyState = { s: 0, v: 0 };
let stop: StopState = INITIAL_STOP;
let reverse = false;
let scaleIndex = 0;
let timeScale = TIME_SCALES[scaleIndex];

function selectTrack(i: number): void {
  const n = data.tracks.length;
  trackIndex = ((i % n) + n) % n;
  const t = data.tracks[trackIndex];
  path = new TrackPath(t.points);
  limits = new SpeedLimitProfile(t.points, DEFAULT_SPEED_LIMIT);
  state = { s: 0, v: 0 };
  stop = INITIAL_STOP;
  reverse = false;
  trolley.setColor(t.colorHex);
  renderPicker();
}

input.onReverse = () => {
  reverse = !reverse;
};
input.onCameraToggle = () => director.cycleDriveView();
input.onMapToggle = () => director.toggleMap();
input.onPrevLine = () => selectTrack(trackIndex - 1);
input.onNextLine = () => selectTrack(trackIndex + 1);
input.onSpeedUp = () => {
  scaleIndex = Math.min(scaleIndex + 1, TIME_SCALES.length - 1);
  timeScale = TIME_SCALES[scaleIndex];
};
input.onSpeedDown = () => {
  scaleIndex = Math.max(scaleIndex - 1, 0);
  timeScale = TIME_SCALES[scaleIndex];
};

// --- Signals + in-app editor ---------------------------------------------
// The editor owns the rendered signal group (placing them from the working
// list and rebuilding on edits). One TrackPath/points map per shape lets
// signals be moved/added on any line.
const signalSet = await loadSignals();
const pathsByShape = new Map<string, TrackPath>();
const pointsByShape = new Map<string, TrackPoint[]>();
for (const t of data.tracks) {
  pathsByShape.set(t.shapeId, new TrackPath(t.points));
  pointsByShape.set(t.shapeId, t.points);
}
const editor = new SignalEditor({
  scene,
  domElement: canvas,
  panel: document.getElementById("editor") as HTMLDivElement,
  getCamera: () => director.active,
  pathsByShape,
  pointsByShape,
  getActiveShapeId: () => data.tracks[trackIndex].shapeId,
  set: signalSet,
});
input.onEditToggle = () => editor.toggle();

// --- Line picker ----------------------------------------------------------
const picker = document.getElementById("picker") as HTMLDivElement;
const pickerButtons: HTMLButtonElement[] = data.tracks.map((t, i) => {
  const btn = document.createElement("button");
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = t.colorHex;
  const label = document.createElement("span");
  label.textContent = `${t.shortName} · ${t.directionName || "dir " + t.directionId}`;
  btn.append(dot, label);
  btn.addEventListener("click", () => {
    if (i !== trackIndex) selectTrack(i);
  });
  picker.appendChild(btn);
  return btn;
});
function renderPicker(): void {
  pickerButtons.forEach((b, i) => b.classList.toggle("active", i === trackIndex));
}

// --- HUD ------------------------------------------------------------------
const hud = document.getElementById("hud") as HTMLDivElement;
hud.innerHTML = `
  <h1>RAIL RIDER</h1>
  <div id="hud-line"></div>
  <div id="hud-speed"></div>
  <div id="hud-next"></div>
  <div id="hud-signal"></div>
  <div class="doors" id="hud-doors"></div>
  <div class="hint" id="hud-view"></div>
  <div class="hint">↑/W throttle · ↓/S brake · R reverse · C cab/chase · M map · [ ] line · , . sim speed · E edit signals</div>
`;
const elLine = document.getElementById("hud-line") as HTMLDivElement;
const elSpeed = document.getElementById("hud-speed") as HTMLDivElement;
const elNext = document.getElementById("hud-next") as HTMLDivElement;
const elSignal = document.getElementById("hud-signal") as HTMLDivElement;
const elDoors = document.getElementById("hud-doors") as HTMLDivElement;

const ASPECT_GLYPH: Record<string, string> = { red: "🔴", yellow: "🟡", green: "🟢" };
const elView = document.getElementById("hud-view") as HTMLDivElement;

function fmtMeters(m: number): string {
  return m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(2)} km`;
}

function updateHud(limit: number): void {
  const t = data.tracks[trackIndex];
  elLine.textContent = `${t.shortName} — ${t.directionName || "dir " + t.directionId} (${(t.lengthM / 1000).toFixed(1)} km)`;

  const kmh = (Math.abs(state.v) * 3.6).toFixed(0);
  const restricted = limit < DEFAULT_PARAMS.maxSpeed - 0.1;
  const limitTag = restricted
    ? ` <span class="limit">⚠ limit ${(limit * 3.6).toFixed(0)} km/h</span>`
    : "";
  elSpeed.innerHTML = `${kmh} km/h${reverse ? "  ◀ REV" : ""}${limitTag}`;

  let next: { name: string; distAlong: number } | undefined;
  if (reverse) {
    for (const st of t.stations) if (st.distAlong < state.s - 1) next = st;
  } else {
    next = t.stations.find((st) => st.distAlong > state.s + 1);
  }
  elNext.textContent = next
    ? `Next: ${next.name} (${fmtMeters(Math.abs(next.distAlong - state.s))})`
    : "Next: — end of line";

  // Nearest signal ahead on the current shape (signals only face forward travel).
  let sig: { name: string; aspect: string; distM: number } | undefined;
  if (!reverse) {
    for (const s of editor.placed) {
      if (s.shapeId !== t.shapeId || s.distM <= state.s + 1) continue;
      if (!sig || s.distM < sig.distM) sig = s;
    }
  }
  elSignal.textContent = sig
    ? `Signal ${sig.name} ${ASPECT_GLYPH[sig.aspect] ?? ""} ${sig.aspect} (${fmtMeters(sig.distM - state.s)})`
    : "";

  if (stop.doorsOpen) {
    const at = t.stations[stop.stationIndex];
    elDoors.textContent = `● DOORS OPEN — ${at ? at.name : ""} (${stop.dwellRemaining.toFixed(0)}s)`;
  } else {
    elDoors.textContent = "";
  }

  elView.textContent = `View: ${director.view} · Sim ×${timeScale}`;
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
let accumulator = 0;
function frame(): void {
  const realDt = Math.min(clock.getDelta(), 0.05);
  input.update();

  // Consume the (time-scaled) frame in fixed sub-steps so fast-forward never
  // skips platform zones, signals, or the end of the line.
  const { steps, remainder } = planSubsteps(accumulator, realDt * timeScale);
  accumulator = remainder;
  const stations = data.tracks[trackIndex].stations;
  let limit = limits.limitAt(state.s);
  for (let i = 0; i < steps; i++) {
    limit = limits.limitAt(state.s);
    // Hold the trolley while the doors are open (dwelling at a platform).
    const throttle = stop.doorsOpen ? 0 : input.throttle;
    const brake = stop.doorsOpen ? 1 : input.brake;
    state = stepTrolley(
      state,
      DEFAULT_PARAMS,
      { throttle, brake, reverse },
      FIXED_DT,
      path.length,
      limit,
    );
    stop = updateStop(stop, state, stations, DEFAULT_STOP_PARAMS, FIXED_DT);
  }

  const pos = path.positionAt(state.s);
  const heading = path.tangentAt(state.s);
  trolley.group.position.set(pos.x, 0, pos.z);
  trolley.group.rotation.y = Math.atan2(heading.x, heading.z);

  director.follow(pos, heading);
  updateHud(limit);
  renderer.render(scene, director.active);
  requestAnimationFrame(frame);
}

selectTrack(0);
resize();
frame();
