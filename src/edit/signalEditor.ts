import * as THREE from "three";
import type {
  Signal,
  SignalSet,
  PlacedSignal,
  SignalAspect,
  SignalSide,
  TrackPoint,
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

export interface SignalEditorDeps {
  scene: THREE.Scene;
  domElement: HTMLCanvasElement;
  panel: HTMLElement;
  getCamera: () => THREE.Camera;
  pathsByShape: Map<string, TrackPath>;
  pointsByShape: Map<string, TrackPoint[]>;
  getActiveShapeId: () => string;
  set: SignalSet;
}

const ASPECTS: SignalAspect[] = ["green", "yellow", "red"];
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * In-app CRUD editor for wayside signals. Owns the rendered signal group: it
 * (re)places signals from the working list and rebuilds the meshes on every
 * change. When enabled, clicking a signal selects it and clicking the ground
 * moves the selected signal to the nearest point on its track. Edits persist to
 * data/signals.json via the dev-server POST /api/signals endpoint.
 */
export class SignalEditor {
  enabled = false;
  private signals: Signal[];
  private selectedId: string | null = null;
  private group: THREE.Group | null = null;
  private placedSignals: PlacedSignal[] = [];
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly deps: SignalEditorDeps) {
    this.signals = deps.set.signals.map((s) => ({ ...s }));
    this.rebuild();
    deps.domElement.addEventListener("pointerdown", (e) => this.onPointerDown(e));
  }

  /** Resolved signal positions, for the HUD's "next signal" readout. */
  get placed(): PlacedSignal[] {
    return this.placedSignals;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (!this.enabled) this.selectedId = null;
    this.deps.panel.style.display = this.enabled ? "block" : "none";
    this.rebuild();
    this.renderPanel();
  }

  // --- rendering ----------------------------------------------------------
  private rebuild(): void {
    this.placedSignals = placeSignals(this.signals, this.deps.pathsByShape);
    if (this.group) {
      this.deps.scene.remove(this.group);
      this.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.group = buildSignals(this.placedSignals, this.enabled ? this.selectedId : null);
    this.deps.scene.add(this.group);
  }

  // --- picking / moving ---------------------------------------------------
  private onPointerDown(ev: PointerEvent): void {
    if (!this.enabled || !this.group) return;
    const el = this.deps.domElement;
    const ndc = new THREE.Vector2(
      (ev.offsetX / el.clientWidth) * 2 - 1,
      -(ev.offsetY / el.clientHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.deps.getCamera());

    const hits = this.raycaster.intersectObjects(this.group.children, true);
    if (hits.length > 0) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && o.userData.signalId === undefined) o = o.parent;
      if (o) {
        this.select(o.userData.signalId as string);
        return;
      }
    }

    // Empty ground click: move the selected signal here (snapped to its track).
    if (this.selectedId) {
      const sel = this.signals.find((s) => s.id === this.selectedId);
      const pts = sel && this.deps.pointsByShape.get(sel.shapeId);
      if (sel && pts) {
        const p = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(GROUND, p)) {
          const near = nearestOnPath(pts, p.x, p.z);
          this.signals = updateSignal(this.signals, sel.id, {
            distM: near.distM,
            side: near.side,
          });
          this.rebuild();
          this.renderPanel();
        }
      }
    }
  }

  private select(id: string): void {
    this.selectedId = id;
    this.rebuild();
    this.renderPanel();
  }

  // --- CRUD actions -------------------------------------------------------
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
    this.rebuild();
    this.renderPanel();
  }

  private patch(patch: Partial<Signal>): void {
    if (!this.selectedId) return;
    this.signals = updateSignal(this.signals, this.selectedId, patch);
    this.rebuild();
    this.renderPanel();
  }

  private async save(): Promise<void> {
    const body: SignalSet = { note: this.deps.set.note, signals: this.signals };
    this.status("Saving…");
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      this.status(out.ok ? `Saved ${out.count} signals to data/signals.json` : `Error: ${out.error}`);
    } catch (err) {
      this.status(`Save failed (dev server only): ${String(err)}`);
    }
  }

  private status(msg: string): void {
    const el = this.deps.panel.querySelector("#editor-status");
    if (el) el.textContent = msg;
  }

  // --- panel UI -----------------------------------------------------------
  private renderPanel(): void {
    if (!this.enabled) return;
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

    this.deps.panel.innerHTML = `
      <h2>SIGNAL EDITOR <span class="hint">(E to close)</span></h2>
      ${editor}
      <div class="erows">${rows}</div>
      <div class="ebtns"><button id="ed-add">+ Add on current line</button><button id="ed-save">Save to file</button></div>
      <div id="editor-status" class="hint"></div>
    `;

    this.deps.panel.querySelectorAll<HTMLElement>(".erow").forEach((row) => {
      row.addEventListener("click", () => this.select(row.dataset.id as string));
    });
    this.bind("#ed-name", "input", (el) => this.patch({ name: (el as HTMLInputElement).value }));
    this.bind("#ed-aspect", "change", (el) => this.patch({ aspect: (el as HTMLSelectElement).value as SignalAspect }));
    this.bind("#ed-side", "change", (el) => this.patch({ side: (el as HTMLSelectElement).value as SignalSide }));
    this.bind("#ed-dist", "change", (el) => this.patch({ distM: Number((el as HTMLInputElement).value) }));
    this.bind("#ed-delete", "click", () => this.remove());
    this.bind("#ed-add", "click", () => this.add());
    this.bind("#ed-save", "click", () => void this.save());
  }

  private bind(sel: string, ev: string, fn: (el: HTMLElement) => void): void {
    const el = this.deps.panel.querySelector<HTMLElement>(sel);
    if (el) el.addEventListener(ev, () => fn(el));
  }
}
