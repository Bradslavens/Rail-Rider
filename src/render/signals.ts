import * as THREE from "three";
import type { PlacedSignal, SignalAspect } from "../core/types.ts";
import { BLOOM_LAYER } from "./bloomLayer.ts";

const ASPECT_COLOR: Record<SignalAspect, number> = {
  red: 0xff2a2a,
  yellow: 0xf5c518,
  green: 0x2ecc52,
};

const MAST_HEIGHT = 6;

/**
 * Build a group of wayside signals: a dark mast with a single illuminated
 * aspect lamp at the top, positioned and oriented per signal. The shared mast
 * material and per-aspect lamp materials are reused across all signals.
 *
 * Each signal's sub-group is tagged with `userData.signalId` for raycast
 * picking; `selectedId` adds a highlight marker above the chosen signal.
 */
export function buildSignals(placed: PlacedSignal[], selectedId?: string | null): THREE.Group {
  const group = new THREE.Group();
  if (placed.length === 0) return group;

  const highlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.4,
  });
  const highlightGeo = new THREE.OctahedronGeometry(0.7);

  const mastMat = new THREE.MeshStandardMaterial({ color: 0x2a323c, roughness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x12161c, roughness: 0.6 });
  const lampMats: Record<SignalAspect, THREE.MeshStandardMaterial> = {
    red: lamp("red"),
    yellow: lamp("yellow"),
    green: lamp("green"),
  };

  const mastGeo = new THREE.CylinderGeometry(0.15, 0.18, MAST_HEIGHT, 8);
  const headGeo = new THREE.BoxGeometry(0.9, 1.6, 0.6);
  const lampGeo = new THREE.SphereGeometry(0.32, 12, 12);

  for (const s of placed) {
    const sig = new THREE.Group();
    sig.position.set(s.x, 0, s.z);
    sig.rotation.y = s.headingRad;
    sig.userData.signalId = s.id;

    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.y = MAST_HEIGHT / 2;
    sig.add(mast);

    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = MAST_HEIGHT;
    sig.add(head);

    const lamp = new THREE.Mesh(lampGeo, lampMats[s.aspect]);
    lamp.position.set(0, MAST_HEIGHT, 0.4); // on the face that looks at the train
    lamp.layers.enable(BLOOM_LAYER);
    sig.add(lamp);

    if (s.id === selectedId) {
      const marker = new THREE.Mesh(highlightGeo, highlightMat);
      marker.position.y = MAST_HEIGHT + 2;
      sig.add(marker);
    }

    group.add(sig);
  }
  return group;
}

function lamp(aspect: SignalAspect): THREE.MeshStandardMaterial {
  const color = ASPECT_COLOR[aspect];
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.1,
  });
}
