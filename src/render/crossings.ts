import * as THREE from "three";
import type { LandmarkPoint, TrackPoint } from "../core/types.ts";
import type { TrackPath } from "../sim/trackPath.ts";
import { nearestOnPath } from "../edit/signalEdits.ts";
import { gateClosed, DEFAULT_CROSSING, type CrossingParams } from "../sim/crossings.ts";

const HALF_PI = Math.PI / 2;
const POST_OFFSET = 7; // posts sit this far either side of the track centre
const ARM_LEN = 6;

interface Gate {
  pivot: THREE.Group;
  side: number; // +1 / -1
}

interface CrossingNode {
  group: THREE.Group;
  gates: Gate[];
  lights: THREE.MeshStandardMaterial[];
  onLine: boolean;
  distM: number;
  closure: number; // 0 open .. 1 closed
}

/**
 * Renders level crossings and animates their gates: when the train comes within
 * the approach window of a crossing on the active line, the striped arms lower
 * and the red lights flash. Crossings not on the active line are hidden.
 */
export class CrossingsController {
  readonly group = new THREE.Group();
  private readonly nodes: CrossingNode[] = [];
  private readonly armMat = new THREE.MeshStandardMaterial({ color: 0xd33a2c, roughness: 0.6 });
  private readonly postMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.7 });

  constructor(
    crossings: LandmarkPoint[],
    private readonly params: CrossingParams = DEFAULT_CROSSING,
  ) {
    for (const c of crossings) this.nodes.push(this.build(c));
  }

  private build(c: LandmarkPoint): CrossingNode {
    const group = new THREE.Group();
    group.position.set(c.x, 0, c.z);
    group.visible = false;

    const postGeo = new THREE.BoxGeometry(0.3, 3, 0.3);
    const armGeo = new THREE.BoxGeometry(ARM_LEN, 0.3, 0.3);
    const lightGeo = new THREE.SphereGeometry(0.22, 8, 8);
    const lights: THREE.MeshStandardMaterial[] = [];
    const gates: Gate[] = [];

    for (const side of [1, -1]) {
      const post = new THREE.Mesh(postGeo, this.postMat);
      post.position.set(side * POST_OFFSET, 1.5, 0);
      group.add(post);

      // Pivot at the top of the post; arm extends toward the track centre.
      const pivot = new THREE.Group();
      pivot.position.set(side * POST_OFFSET, 3, 0);
      const arm = new THREE.Mesh(armGeo, this.armMat);
      arm.position.x = -side * (ARM_LEN / 2);
      pivot.add(arm);
      group.add(pivot);
      gates.push({ pivot, side });

      // Flashing light on the post.
      const mat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 0.1 });
      const lamp = new THREE.Mesh(lightGeo, mat);
      lamp.position.set(side * POST_OFFSET, 3.4, 0);
      group.add(lamp);
      lights.push(mat);
    }

    this.group.add(group);
    return { group, gates, lights, onLine: false, distM: 0, closure: 0 };
  }

  /** Re-anchor crossings to the active line and orient their gates across it. */
  setActiveTrack(points: TrackPoint[], path: TrackPath): void {
    for (const n of this.nodes) {
      const p = n.group.position;
      const near = nearestOnPath(points, p.x, p.z);
      n.onLine = near.offset <= this.params.onlineOffsetM;
      n.distM = near.distM;
      n.group.visible = n.onLine;
      if (n.onLine) n.group.rotation.y = path.headingAt(near.distM);
    }
  }

  /** Animate gates toward their target each frame. */
  update(trainS: number, dt: number, now: number): void {
    const flash = Math.floor(now / 350) % 2 === 0;
    for (const n of this.nodes) {
      if (!n.onLine) continue;
      const target = gateClosed(trainS, n.distM, this.params.approachM) ? 1 : 0;
      n.closure += (target - n.closure) * Math.min(1, dt * 3.5);
      for (const g of n.gates) g.pivot.rotation.z = (1 - n.closure) * (-g.side * HALF_PI);
      const active = n.closure > 0.05;
      n.lights[0].emissiveIntensity = active && flash ? 2.2 : 0.1;
      n.lights[1].emissiveIntensity = active && !flash ? 2.2 : 0.1;
    }
  }
}
