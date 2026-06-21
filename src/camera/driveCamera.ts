import * as THREE from "three";
import type { Meta } from "../core/types.ts";
import type { Vec2 } from "../sim/trackPath.ts";

export type DriveView = "chase" | "cab" | "map";

/**
 * Camera director for driving: a perspective camera that follows the trolley in
 * either a chase or cab framing, plus a top-down orthographic map. The map
 * toggles on/off and remembers the last driving view.
 */
export class CameraDirector {
  readonly perspective: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  view: DriveView = "chase";
  private lastDrive: DriveView = "chase";

  private readonly spanX: number;
  private readonly spanZ: number;
  private readonly margin = 1.1;
  private readonly target = new THREE.Vector3();

  constructor(meta: Meta) {
    const { bbox } = meta;
    this.spanX = bbox.maxX - bbox.minX;
    this.spanZ = bbox.maxZ - bbox.minZ;
    const maxSpan = Math.max(this.spanX, this.spanZ);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cz = (bbox.minZ + bbox.maxZ) / 2;

    this.perspective = new THREE.PerspectiveCamera(65, 1, 1, 400000);

    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200000);
    this.ortho.position.set(cx, maxSpan, cz);
    this.ortho.up.set(0, 0, -1);
    this.ortho.lookAt(cx, 0, cz);
  }

  get active(): THREE.Camera {
    return this.view === "map" ? this.ortho : this.perspective;
  }

  /** Switch between chase and cab (and back out of map if needed). */
  cycleDriveView(): DriveView {
    this.view = this.view === "cab" ? "chase" : "cab";
    this.lastDrive = this.view;
    return this.view;
  }

  /** Toggle the top-down map on/off. */
  toggleMap(): DriveView {
    if (this.view === "map") {
      this.view = this.lastDrive;
    } else {
      this.lastDrive = this.view;
      this.view = "map";
    }
    return this.view;
  }

  /** Position the chase/cab camera from the trolley's pose. */
  follow(pos: Vec2, heading: Vec2): void {
    const fx = heading.x;
    const fz = heading.z;
    if (this.view === "cab") {
      // Just ahead of the nose (body spans ±12 m), at driver eye height.
      this.perspective.position.set(pos.x + fx * 13.5, 3.0, pos.z + fz * 13.5);
      this.target.set(pos.x + fx * 120, 2.6, pos.z + fz * 120);
    } else {
      // Well back and above so the whole car sits in frame.
      this.perspective.position.set(pos.x - fx * 48, 19, pos.z - fz * 48);
      this.target.set(pos.x + fx * 20, 3, pos.z + fz * 20);
    }
    this.perspective.lookAt(this.target);
  }

  resize(width: number, height: number): void {
    const aspect = width / height;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();

    const worldAspect = this.spanX / this.spanZ;
    let halfW: number;
    let halfH: number;
    if (aspect > worldAspect) {
      halfH = (this.spanZ * this.margin) / 2;
      halfW = halfH * aspect;
    } else {
      halfW = (this.spanX * this.margin) / 2;
      halfH = halfW / aspect;
    }
    this.ortho.left = -halfW;
    this.ortho.right = halfW;
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.updateProjectionMatrix();
  }
}
