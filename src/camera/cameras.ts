import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Meta } from "../core/types.ts";

export type CameraMode = "3d" | "map";

/**
 * Two framings of the whole network: an orbitable 3D perspective view and a
 * top-down orthographic "map" view. Press the toggle to switch between them.
 */
export class CameraRig {
  readonly perspective: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  mode: CameraMode = "3d";

  private readonly center: THREE.Vector3;
  private readonly spanX: number;
  private readonly spanZ: number;
  private readonly margin = 1.1;

  constructor(meta: Meta, canvas: HTMLCanvasElement) {
    const { bbox } = meta;
    this.spanX = bbox.maxX - bbox.minX;
    this.spanZ = bbox.maxZ - bbox.minZ;
    this.center = new THREE.Vector3(
      (bbox.minX + bbox.maxX) / 2,
      0,
      (bbox.minZ + bbox.maxZ) / 2,
    );
    const maxSpan = Math.max(this.spanX, this.spanZ);

    this.perspective = new THREE.PerspectiveCamera(60, 1, 5, 400000);
    this.perspective.position.set(
      this.center.x,
      maxSpan * 0.6,
      this.center.z + maxSpan * 0.9,
    );

    this.controls = new OrbitControls(this.perspective, canvas);
    this.controls.enableDamping = true;
    this.controls.target.copy(this.center);
    this.controls.update();

    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200000);
    this.ortho.position.set(this.center.x, maxSpan, this.center.z);
    this.ortho.up.set(0, 0, -1); // North (-Z) points up on screen
    this.ortho.lookAt(this.center.x, 0, this.center.z);
  }

  get active(): THREE.Camera {
    return this.mode === "3d" ? this.perspective : this.ortho;
  }

  toggle(): CameraMode {
    this.mode = this.mode === "3d" ? "map" : "3d";
    return this.mode;
  }

  resize(width: number, height: number): void {
    const aspect = width / height;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();

    // Fit the network to the viewport without distortion.
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

  update(): void {
    if (this.mode === "3d") this.controls.update();
  }
}
