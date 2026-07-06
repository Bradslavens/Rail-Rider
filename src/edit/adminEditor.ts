import * as THREE from "three";
import type {
  Signal,
  SignalSet,
  PlacedSignal,
  SignalAspect,
  SignalSide,
  TrackPoint,
  Track,
  TrackStation,
  LandmarkPoint,
  StationEdit,
  StationEditSet,
  CrossingEdit,
  CrossingEditSet,
} from "../core/types.ts";
import type { TrackPath } from "../sim/trackPath.ts";
import { placeSignals } from "../sim/signals.ts";
import { buildSignals } from "../render/signals.ts";
import {
  nearestOnPath,
  nextSignalId,
  addSignal,
  updateSignal,
  deleteSignal,
} from "./signalEdits.ts";
import {
  round1,
  parseSignalNames,
  importSignals,
  upsertStationEdit,
  upsertCrossingEdit,
  originalCrossings,
} from "./adminEdits.ts";

export type AdminMode = "signals" | "stations" | "crossings";

export interface AdminEditorDeps {
  scene: THREE.Scene;
  domElement: HTMLCanvasElement;
  panel: HTMLElement;
  getCamera: () => THREE.Camera;
  pathsByShape: Map<string, TrackPath>;
  pointsByShape: Map<string, TrackPoint[]>;
  getActiveShapeId: () => string;
  set: SignalSet;
  /** Tracks with station overrides already applied (from loadNetwork). */
  tracks: Track[];
  /** The saved station override set, so re-saving keeps earlier edits. */
  stationEdits: StationEditSet;
  /** Crossings with overrides already applied (from loadLandmarks). */
  crossings: LandmarkPoint[];
  /** The saved crossing override set, so re-saving keeps earlier edits. */
  crossingEdits: CrossingEditSet;
}

const ASPECTS: SignalAspect[] = ["green", "yellow", "red"];
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const MODES: { id: AdminMode; label: string }[] = [
  { id: "signals", label: "Signals" },
  { id: "stations", label: "Stations" },
  { id: "crossings", label: "Crossings" },
];

type Drag =
  | { kind: "station"; stationId: string }
  | { kind: "crossing"; index: number };

/**
 * In-app admin editor (E key) for everything hand-placed along the network:
 * wayside signals, station platforms, and level crossings, on separate tabs.
 *
 * Signals: same CRUD as before (click to select, click the ground to move
 * along the track) plus a bulk import that spreads a pasted list of names
 * evenly along the active line. Stations: blue discs on the active line;
 * drag one along the track to fix its distAlong. Crossings: orange discs
 * anywhere on the map; drag freely in the ground plane. Each tab's Save
 * persists via its dev-server endpoint (/api/signals|stations|crossings);
 * station/crossing edits are override files applied at load, so they take
 * effect in the sim after a reload.
 *
 * The editor owns the rendered signal group even while closed (the sim's HUD
 * reads `placed` from it); station/crossing markers only exist in admin mode.
 */
export class AdminEditor {
  enabled = false;
  private mode: AdminMode = "signals";
  private readonly raycaster = new THREE.Raycaster();
  private drag: Drag | null = null;

  // Signals working state.
  private signals: Signal[];
  private selectedId: string | null = null;
  private group: THREE.Group | null = null;
  private placedSignals: PlacedSignal[] = [];

  // Stations: a mutable copy per shape, plus the pending override list.
  private readonly stationsByShape = new Map<string, TrackStation[]>();
  private stationEdits: StationEdit[];
  private selectedStationId: string | null = null;
  private stationGroup: THREE.Group | null = null;

  // Crossings: working positions (index-aligned with landmarks.json) plus
  // their original coordinates, which key the override file.
  private readonly crossings: { x: number; z: number }[];
  private readonly crossingOrig: { x: number; z: number }[];
  private crossingEdits: CrossingEdit[];
  private selectedCrossing: number | null = null;
  private crossingGroup: THREE.Group | null = null;

  constructor(private readonly deps: AdminEditorDeps) {
    this.signals = deps.set.signals.map((s) => ({ ...s }));
    this.stationEdits = deps.stationEdits.edits.map((e) => ({ ...e }));
    for (const t of deps.tracks) {
      this.stationsByShape.set(t.shapeId, t.stations.map((st) => ({ ...st })));
    }
    this.crossings = deps.crossings.map((c) => ({ x: c.x, z: c.z }));
    this.crossingOrig = originalCrossings(deps.crossings, deps.crossingEdits.edits);
    this.crossingEdits = deps.crossingEdits.edits.map((e) => ({ ...e }));

    this.rebuildSignals();
    deps.domElement.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    deps.domElement.addEventListener("pointermove", (e) => this.onPointerMove(e));
    deps.domElement.addEventListener("pointerup", (e) => this.onPointerUp(e));
  }

  /** Resolved signal positions, for the HUD's "next signal" readout. */
  get placed(): PlacedSignal[] {
    return this.placedSignals;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.selectedId = null;
      this.selectedStationId = null;
      this.selectedCrossing = null;
      this.drag = null;
    }
    this.deps.panel.style.display = this.enabled ? "block" : "none";
    this.rebuildSignals();
    this.rebuildMarkers();
    this.renderPanel();
  }

  /** Re-sync markers/panel after the active line changes. */
  refresh(): void {
    if (!this.enabled) return;
    this.selectedStationId = null;
    this.rebuildMarkers();
    this.renderPanel();
  }

  private setMode(mode: AdminMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.drag = null;
    this.rebuildSignals();
    this.rebuildMarkers();
    this.renderPanel();
  }

  // --- rendering ----------------------------------------------------------
  private rebuildSignals(): void {
    this.placedSignals = placeSignals(this.signals, this.deps.pathsByShape);
    if (this.group) {
      this.deps.scene.remove(this.group);
      disposeGroup(this.group);
    }
    const highlight = this.enabled && this.mode === "signals" ? this.selectedId : null;
    this.group = buildSignals(this.placedSignals, highlight);
    this.deps.scene.add(this.group);
  }

  /** (Re)build the draggable station/crossing markers for the current tab. */
  private rebuildMarkers(): void {
    if (this.stationGroup) {
      this.deps.scene.remove(this.stationGroup);
      disposeGroup(this.stationGroup);
      this.stationGroup = null;
    }
    if (this.crossingGroup) {
      this.deps.scene.remove(this.crossingGroup);
      disposeGroup(this.crossingGroup);
      this.crossingGroup = null;
    }
    if (!this.enabled) return;
    if (this.mode === "stations") {
      this.stationGroup = this.buildStationMarkers();
      this.deps.scene.add(this.stationGroup);
    } else if (this.mode === "crossings") {
      this.crossingGroup = this.buildCrossingMarkers();
      this.deps.scene.add(this.crossingGroup);
    }
  }

  /** Blue disc + name sprite per station on the active line. */
  private buildStationMarkers(): THREE.Group {
    const group = new THREE.Group();
    const shapeId = this.deps.getActiveShapeId();
    const path = this.deps.pathsByShape.get(shapeId);
    const stations = this.stationsByShape.get(shapeId);
    if (!path || !stations) return group;

    const discGeo = new THREE.CircleGeometry(5, 24).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.75 });
    const selMat = new THREE.MeshBasicMaterial({ color: 0x9ecbff, transparent: true, opacity: 0.95 });

    for (const st of stations) {
      const p = path.positionAt(st.distAlong);
      const marker = new THREE.Group();
      marker.position.set(p.x, 0, p.z);
      marker.userData.stationId = st.stationId;

      const disc = new THREE.Mesh(discGeo, st.stationId === this.selectedStationId ? selMat : mat);
      disc.position.y = 0.3;
      marker.add(disc);

      const label = nameSprite(st.name);
      label.position.y = 9;
      marker.add(label);

      group.add(marker);
    }
    return group;
  }

  /** Orange disc per crossing (all of them; drag is free in the ground plane). */
  private buildCrossingMarkers(): THREE.Group {
    const group = new THREE.Group();
    const discGeo = new THREE.CircleGeometry(4, 24).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf0842c, transparent: true, opacity: 0.75 });
    const selMat = new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.95 });

    this.crossings.forEach((c, i) => {
      const marker = new THREE.Group();
      marker.position.set(c.x, 0, c.z);
      marker.userData.crossingIndex = i;

      const disc = new THREE.Mesh(discGeo, i === this.selectedCrossing ? selMat : mat);
      disc.position.y = 0.3;
      marker.add(disc);

      group.add(marker);
    });
    return group;
  }

  // --- picking / dragging ---------------------------------------------------
  private setRay(ev: PointerEvent): void {
    const el = this.deps.domElement;
    const ndc = new THREE.Vector2(
      (ev.offsetX / el.clientWidth) * 2 - 1,
      -(ev.offsetY / el.clientHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.deps.getCamera());
  }

  /** Walk a raycast hit up to the marker group carrying the given userData key. */
  private pick(group: THREE.Group | null, key: string): THREE.Object3D | null {
    if (!group) return null;
    const hits = this.raycaster.intersectObjects(group.children, true);
    if (hits.length === 0) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && o.userData[key] === undefined) o = o.parent;
    return o;
  }

  private groundPoint(): THREE.Vector3 | null {
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(GROUND, p) ? p : null;
  }

  private onPointerDown(ev: PointerEvent): void {
    if (!this.enabled) return;
    this.setRay(ev);
    if (this.mode === "signals") return this.onSignalPointerDown();

    if (this.mode === "stations") {
      const hit = this.pick(this.stationGroup, "stationId");
      if (hit) {
        this.selectedStationId = hit.userData.stationId as string;
        this.drag = { kind: "station", stationId: this.selectedStationId };
        this.deps.domElement.setPointerCapture(ev.pointerId);
        this.rebuildMarkers();
        this.renderPanel();
      }
      return;
    }

    // Crossings tab.
    const hit = this.pick(this.crossingGroup, "crossingIndex");
    if (hit) {
      this.selectedCrossing = hit.userData.crossingIndex as number;
      this.drag = { kind: "crossing", index: this.selectedCrossing };
      this.deps.domElement.setPointerCapture(ev.pointerId);
      this.rebuildMarkers();
      this.renderPanel();
    }
  }

  private onPointerMove(ev: PointerEvent): void {
    if (!this.enabled || !this.drag) return;
    this.setRay(ev);
    const p = this.groundPoint();
    if (!p) return;

    if (this.drag.kind === "station") {
      // Slide along the active track: project the pointer onto the centreline.
      const shapeId = this.deps.getActiveShapeId();
      const pts = this.deps.pointsByShape.get(shapeId);
      const path = this.deps.pathsByShape.get(shapeId);
      const st = this.stationsByShape
        .get(shapeId)
        ?.find((s) => s.stationId === (this.drag as { stationId: string }).stationId);
      if (!pts || !path || !st) return;
      const near = nearestOnPath(pts, p.x, p.z);
      st.distAlong = near.distM;
      const pos = path.positionAt(near.distM);
      this.moveMarker(this.stationGroup, "stationId", st.stationId, pos.x, pos.z);
    } else {
      // Crossings move freely in the ground plane.
      const c = this.crossings[this.drag.index];
      c.x = p.x;
      c.z = p.z;
      this.moveMarker(this.crossingGroup, "crossingIndex", this.drag.index, p.x, p.z);
    }
  }

  private onPointerUp(ev: PointerEvent): void {
    if (!this.drag) return;
    if (this.deps.domElement.hasPointerCapture(ev.pointerId)) {
      this.deps.domElement.releasePointerCapture(ev.pointerId);
    }

    // Commit the drop as a pending override (written to file on Save).
    if (this.drag.kind === "station") {
      const shapeId = this.deps.getActiveShapeId();
      const st = this.stationsByShape
        .get(shapeId)
        ?.find((s) => s.stationId === (this.drag as { stationId: string }).stationId);
      if (st) {
        this.stationEdits = upsertStationEdit(this.stationEdits, {
          shapeId,
          stationId: st.stationId,
          distAlong: round1(st.distAlong),
        });
      }
    } else {
      const i = this.drag.index;
      const c = this.crossings[i];
      const orig = this.crossingOrig[i];
      this.crossingEdits = upsertCrossingEdit(this.crossingEdits, {
        index: i,
        origX: round1(orig.x),
        origZ: round1(orig.z),
        x: round1(c.x),
        z: round1(c.z),
      });
    }
    this.drag = null;
    this.renderPanel();
  }

  /** Reposition one marker in place (cheaper than rebuilding mid-drag). */
  private moveMarker(
    group: THREE.Group | null,
    key: string,
    value: unknown,
    x: number,
    z: number,
  ): void {
    const m = group?.children.find((o) => o.userData[key] === value);
    if (m) m.position.set(x, 0, z);
  }

  private onSignalPointerDown(): void {
    const hit = this.pick(this.group, "signalId");
    if (hit) {
      this.select(hit.userData.signalId as string);
      return;
    }

    // Empty ground click: move the selected signal here (snapped to its track).
    if (this.selectedId) {
      const sel = this.signals.find((s) => s.id === this.selectedId);
      const pts = sel && this.deps.pointsByShape.get(sel.shapeId);
      if (sel && pts) {
        const p = this.groundPoint();
        if (p) {
          const near = nearestOnPath(pts, p.x, p.z);
          this.signals = updateSignal(this.signals, sel.id, {
            distM: near.distM,
            side: near.side,
          });
          this.rebuildSignals();
          this.renderPanel();
        }
      }
    }
  }

  private select(id: string): void {
    this.selectedId = id;
    this.rebuildSignals();
    this.renderPanel();
  }

  // --- signal CRUD actions --------------------------------------------------
  private add(): void {
    const shapeId = this.deps.getActiveShapeId();
    const pts = this.deps.pointsByShape.get(shapeId);
    const distM = pts ? pts[Math.floor(pts.length / 2)].dist : 0;
    const sig: Signal = {
      id: nextSignalId(this.signals, shapeId),
      name: "NEW",
      shapeId,
      distM,
      side: "R",
      aspect: "green",
    };
    this.signals = addSignal(this.signals, sig);
    this.select(sig.id);
  }

  private remove(): void {
    if (!this.selectedId) return;
    this.signals = deleteSignal(this.signals, this.selectedId);
    this.selectedId = null;
    this.rebuildSignals();
    this.renderPanel();
  }

  private patch(patch: Partial<Signal>): void {
    if (!this.selectedId) return;
    this.signals = updateSignal(this.signals, this.selectedId, patch);
    this.rebuildSignals();
    this.renderPanel();
  }

  /** Bulk import: pasted names -> evenly spaced green signals on this line. */
  private importNames(text: string): void {
    const names = parseSignalNames(text);
    if (names.length === 0) {
      this.status("Nothing to import — paste comma/newline-separated names.");
      return;
    }
    const shapeId = this.deps.getActiveShapeId();
    const path = this.deps.pathsByShape.get(shapeId);
    if (!path) return;
    const result = importSignals(this.signals, names, shapeId, path.length);
    this.signals = result.list;
    this.rebuildSignals();
    this.renderPanel();
    const skipped =
      result.skipped.length > 0 ? ` (skipped ${result.skipped.length} duplicates)` : "";
    this.status(`Imported ${result.added} signals${skipped}. Drag each into place, then Save.`);
  }

  // --- persistence ----------------------------------------------------------
  private async post(url: string, body: unknown, what: string): Promise<void> {
    this.status("Saving…");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      this.status(out.ok ? `Saved ${out.count} ${what}` : `Error: ${out.error}`);
    } catch (err) {
      this.status(`Save failed (dev server only): ${String(err)}`);
    }
  }

  private save(): void {
    if (this.mode === "signals") {
      const body: SignalSet = { note: this.deps.set.note, signals: this.signals };
      void this.post("/api/signals", body, "signals to data/signals.json");
    } else if (this.mode === "stations") {
      const body: StationEditSet = { note: this.deps.stationEdits.note, edits: this.stationEdits };
      void this.post("/api/stations", body, "station edits to data/stationEdits.json");
    } else {
      const body: CrossingEditSet = { note: this.deps.crossingEdits.note, edits: this.crossingEdits };
      void this.post("/api/crossings", body, "crossing edits to data/crossingEdits.json");
    }
  }

  private status(msg: string): void {
    const el = this.deps.panel.querySelector("#editor-status");
    if (el) el.textContent = msg;
  }

  // --- panel UI -----------------------------------------------------------
  private renderPanel(): void {
    if (!this.enabled) return;
    const tabs = MODES.map(
      (m) =>
        `<button class="etab${m.id === this.mode ? " active" : ""}" data-mode="${m.id}">${m.label}</button>`,
    ).join("");

    const content =
      this.mode === "signals"
        ? this.signalsPanel()
        : this.mode === "stations"
          ? this.stationsPanel()
          : this.crossingsPanel();

    this.deps.panel.innerHTML = `
      <h2>ADMIN EDITOR <span class="hint">(E to close)</span></h2>
      <div class="etabs">${tabs}</div>
      ${content}
      <div id="editor-status" class="hint"></div>
    `;

    this.deps.panel.querySelectorAll<HTMLElement>(".etab").forEach((tab) => {
      tab.addEventListener("click", () => this.setMode(tab.dataset.mode as AdminMode));
    });
    this.bind("#ed-save", "click", () => this.save());
    if (this.mode === "signals") this.bindSignalsPanel();
    else this.bindMarkerRows();
  }

  private signalsPanel(): string {
    const sel = this.signals.find((s) => s.id === this.selectedId);
    const rows = this.signals
      .map(
        (s) =>
          `<div class="erow${s.id === this.selectedId ? " sel" : ""}" data-id="${s.id}">
             <span class="dot ${s.aspect}"></span>${s.name}
             <span class="meta">${(s.distM / 1000).toFixed(2)}km · ${s.side}</span>
           </div>`,
      )
      .join("");

    const editor = sel
      ? `<div class="efields">
           <label>Name <input id="ed-name" value="${sel.name}"></label>
           <label>Aspect
             <select id="ed-aspect">${ASPECTS.map((a) => `<option ${a === sel.aspect ? "selected" : ""}>${a}</option>`).join("")}</select>
           </label>
           <label>Side
             <select id="ed-side">${(["L", "R"] as SignalSide[]).map((sd) => `<option ${sd === sel.side ? "selected" : ""}>${sd}</option>`).join("")}</select>
           </label>
           <label>Dist (m) <input id="ed-dist" type="number" step="10" value="${sel.distM.toFixed(0)}"></label>
           <button id="ed-delete">Delete</button>
           <div class="hint">Click the ground to move it along its track.</div>
         </div>`
      : `<div class="hint">Click a signal in the world, or a row below, to edit it.</div>`;

    return `
      ${editor}
      <div class="erows">${rows}</div>
      <div class="ebtns"><button id="ed-add">+ Add on current line</button><button id="ed-save">Save to file</button></div>
      <div class="eimport">
        <textarea id="ed-import" rows="3" placeholder='Bulk import: paste names as CSV cells, one per line, or ["S154","S16RA",…]'></textarea>
        <button id="ed-import-btn">Import onto current line</button>
      </div>
    `;
  }

  private stationsPanel(): string {
    const shapeId = this.deps.getActiveShapeId();
    const stations = this.stationsByShape.get(shapeId) ?? [];
    const edited = new Set(
      this.stationEdits.filter((e) => e.shapeId === shapeId).map((e) => e.stationId),
    );
    const rows = stations
      .map(
        (st) =>
          `<div class="erow${st.stationId === this.selectedStationId ? " sel" : ""}" data-id="${st.stationId}">
             ${st.name}
             <span class="meta">${(st.distAlong / 1000).toFixed(2)}km${edited.has(st.stationId) ? " ✎" : ""}</span>
           </div>`,
      )
      .join("");
    return `
      <div class="hint">Drag a blue disc along the active line to fix a station's position (✎ = pending edit). Save, then reload to apply in the sim.</div>
      <div class="erows">${rows}</div>
      <div class="ebtns"><button id="ed-save">Save to file</button></div>
    `;
  }

  private crossingsPanel(): string {
    const edited = new Set<number>();
    this.crossingEdits.forEach((e) => {
      if (e.index >= 0) edited.add(e.index);
    });
    const rows = this.crossings
      .map(
        (c, i) =>
          `<div class="erow${i === this.selectedCrossing ? " sel" : ""}" data-id="${i}">
             Crossing ${i + 1}
             <span class="meta">${c.x.toFixed(0)}, ${c.z.toFixed(0)}${edited.has(i) ? " ✎" : ""}</span>
           </div>`,
      )
      .join("");
    return `
      <div class="hint">Drag an orange disc anywhere in the ground plane (✎ = pending edit). Save, then reload to apply in the sim.</div>
      <div class="erows">${rows}</div>
      <div class="ebtns"><button id="ed-save">Save to file</button></div>
    `;
  }

  private bindSignalsPanel(): void {
    this.deps.panel.querySelectorAll<HTMLElement>(".erow").forEach((row) => {
      row.addEventListener("click", () => this.select(row.dataset.id as string));
    });
    this.bind("#ed-name", "input", (el) => this.patch({ name: (el as HTMLInputElement).value }));
    this.bind("#ed-aspect", "change", (el) => this.patch({ aspect: (el as HTMLSelectElement).value as SignalAspect }));
    this.bind("#ed-side", "change", (el) => this.patch({ side: (el as HTMLSelectElement).value as SignalSide }));
    this.bind("#ed-dist", "change", (el) => this.patch({ distM: Number((el as HTMLInputElement).value) }));
    this.bind("#ed-delete", "click", () => this.remove());
    this.bind("#ed-add", "click", () => this.add());
    this.bind("#ed-import-btn", "click", () => {
      const ta = this.deps.panel.querySelector<HTMLTextAreaElement>("#ed-import");
      if (ta) this.importNames(ta.value);
    });
  }

  /** Row click = select the matching marker on the stations/crossings tabs. */
  private bindMarkerRows(): void {
    this.deps.panel.querySelectorAll<HTMLElement>(".erow").forEach((row) => {
      row.addEventListener("click", () => {
        if (this.mode === "stations") this.selectedStationId = row.dataset.id as string;
        else this.selectedCrossing = Number(row.dataset.id);
        this.rebuildMarkers();
        this.renderPanel();
      });
    });
  }

  private bind(sel: string, ev: string, fn: (el: HTMLElement) => void): void {
    const el = this.deps.panel.querySelector<HTMLElement>(sel);
    if (el) el.addEventListener(ev, () => fn(el));
  }
}

/** Dispose all geometries (and label textures) under a group. */
function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const sprite = o as THREE.Sprite;
    if (sprite.isSprite) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
  });
}

/** A billboard sprite with the station name on a translucent dark plate. */
function nameSprite(text: string): THREE.Sprite {
  const pad = 12;
  const fontPx = 36;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.height = fontPx + pad * 2;
  // Resizing the canvas resets the context state; set the font again.
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(12, 16, 22, 0.8)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e6eaf0";
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
  );
  // ~0.1 m per canvas pixel keeps labels readable from the chase camera.
  sprite.scale.set(canvas.width * 0.1, canvas.height * 0.1, 1);
  return sprite;
}
